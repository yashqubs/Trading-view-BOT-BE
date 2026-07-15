import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import type { AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { Direction } from '../common/enums';
import { SecretsService } from '../secrets/secrets.service';
import { IgClientService } from './ig-client.service';

function axiosError(status: number): unknown {
  return { response: { status, data: {} }, message: `HTTP ${status}` };
}

function loginResponse(): AxiosResponse {
  return {
    headers: { cst: 'CST_TOKEN', 'x-security-token': 'SECURITY_TOKEN' },
    data: {},
  } as unknown as AxiosResponse;
}

describe('IgClientService — request retry behaviour', () => {
  let service: IgClientService;
  let requestMock: jest.Mock;

  beforeEach(async () => {
    requestMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IgClientService,
        { provide: HttpService, useValue: { post: jest.fn(), request: requestMock } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SecretsService, useValue: { get: jest.fn().mockReturnValue('secret') } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(IgClientService);

    // Establish a session first (login() calls httpService.post, not .request()).
    const httpService = module.get<{ post: jest.Mock }>(HttpService);
    httpService.post.mockReturnValueOnce(of(loginResponse()));
    await service.login();
  });

  it('retries on a transient 503 and succeeds once IG recovers', async () => {
    requestMock
      .mockReturnValueOnce(throwError(() => axiosError(503)))
      .mockReturnValueOnce(throwError(() => axiosError(503)))
      .mockReturnValueOnce(of({ data: {} } as unknown as AxiosResponse));

    await expect(service.getAccounts()).resolves.toEqual({});
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after the max number of attempts if every retry is still transient', async () => {
    requestMock.mockReturnValue(throwError(() => axiosError(503)));

    await expect(service.getAccounts()).rejects.toThrow('IG API error');
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-transient 400 — fails on the first attempt', async () => {
    requestMock.mockReturnValueOnce(throwError(() => axiosError(400)));

    await expect(service.getAccounts()).rejects.toThrow('IG API error');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 401 — fails on the first attempt', async () => {
    requestMock.mockReturnValueOnce(throwError(() => axiosError(401)));

    await expect(service.getAccounts()).rejects.toThrow('IG API error');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('sends closePosition as POST with a _method: DELETE header, never a real DELETE', async () => {
    // IG's gateway drops the body of real DELETE requests (400
    // validation.null-not-allowed.request), silently breaking every close —
    // confirmed live 2026-07-13. This pins the documented workaround.
    requestMock.mockReturnValueOnce(
      of({ data: { dealReference: 'REF-CLOSE' } } as unknown as AxiosResponse),
    );

    await service.closePosition({
      dealId: 'DEAL-1',
      direction: Direction.SELL,
      size: 2,
      orderType: 'MARKET',
    });

    const config = requestMock.mock.calls[0][0] as {
      method: string;
      headers: Record<string, string>;
      data: { dealId: string };
    };
    expect(config.method).toBe('POST');
    expect(config.headers._method).toBe('DELETE');
    expect(config.data.dealId).toBe('DEAL-1');
  });

  describe('debug recording', () => {
    it('captures nothing when not recording', async () => {
      requestMock.mockReturnValueOnce(of({ data: { ok: true } } as unknown as AxiosResponse));
      await service.getAccounts();
      expect(service.stopRecording()).toEqual([]);
    });

    it('captures request + response body while recording, excluding headers', async () => {
      service.startRecording();
      requestMock.mockReturnValueOnce(
        of({ data: { dealReference: 'REF-1' } } as unknown as AxiosResponse),
      );

      await service.closePosition({
        dealId: 'DEAL-1',
        direction: 'SELL' as never,
        size: 2,
        orderType: 'MARKET',
      });

      const entries = service.stopRecording();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        method: 'POST', // converted from DELETE — see the _method test above
        responseBody: { dealReference: 'REF-1' },
      });
      expect((entries[0].requestBody as { dealId: string }).dealId).toBe('DEAL-1');
      // No CST/X-SECURITY-TOKEN/API key anywhere in a captured entry.
      expect(JSON.stringify(entries[0])).not.toMatch(/CST|SECURITY|API-KEY|secret/i);
    });

    it('captures a failed call with its error code instead of a response body', async () => {
      service.startRecording();
      requestMock.mockReturnValueOnce(throwError(() => axiosError(400)));

      await expect(service.getAccounts()).rejects.toThrow();

      const entries = service.stopRecording();
      expect(entries).toHaveLength(1);
      expect(entries[0].errorCode).toBe('HTTP 400');
      expect(entries[0].responseBody).toBeUndefined();
    });

    it('stopRecording resets state so a later call is not captured', async () => {
      service.startRecording();
      expect(service.stopRecording()).toEqual([]);

      requestMock.mockReturnValueOnce(of({ data: {} } as unknown as AxiosResponse));
      await service.getAccounts();
      expect(service.stopRecording()).toEqual([]);
    });
  });
});
