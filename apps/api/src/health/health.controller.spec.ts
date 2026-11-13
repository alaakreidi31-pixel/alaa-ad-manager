import 'reflect-metadata';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

// The real PrismaService needs a database and a .env file: replace it in unit tests.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

function createController(queryRaw: () => Promise<unknown>): HealthController {
  const fakePrisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return new HealthController(fakePrisma);
}

describe('HealthController (GET /api/health)', () => {
  beforeEach(() => {
    // Keep test output clean: the "database down" case logs a warning on purpose.
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports ok when the database answers', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const result = await createController(queryRaw).check();

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
    expect(result.database).toBe('up');
    expect(result.service).toBe('alaa-ad-manager-api');
  });

  it('answers 503 with database "down" when the database fails', async () => {
    const queryRaw = vi.fn().mockRejectedValue(new Error('connection refused'));
    const controller = createController(queryRaw);

    const error: unknown = await controller.check().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const exception = error as ServiceUnavailableException;
    expect(exception.getStatus()).toBe(503);
    expect(exception.getResponse()).toMatchObject({ status: 'error', database: 'down' });
  });
});
