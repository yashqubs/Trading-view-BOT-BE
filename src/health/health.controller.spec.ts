import { HttpException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  function buildController(query: jest.Mock): HealthController {
    return new HealthController({ query } as unknown as DataSource);
  }

  it('returns ok when the database responds', async () => {
    const controller = buildController(jest.fn().mockResolvedValue([{ '?column?': 1 }]));

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('throws 503 when the database is unreachable', async () => {
    const controller = buildController(
      jest.fn().mockRejectedValue(new Error('connection refused')),
    );

    await expect(controller.check()).rejects.toThrow(HttpException);
  });
});
