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
});
