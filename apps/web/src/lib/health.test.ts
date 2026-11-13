import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHealth, type HealthResponse } from './health';

const healthyBody: HealthResponse = {
  status: 'ok',
  service: 'alaa-ad-manager-api',
  database: 'up',
  timestamp: '2026-01-01T00:00:00.000Z',
  uptimeSeconds: 10,
};

function mockFetch(implementation: () => Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(implementation));
}

function jsonResponse(body: unknown, status: number): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('fetchHealth (system status card)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a reachable API with the database up (HTTP 200)', async () => {
    mockFetch(() => jsonResponse(healthyBody, 200));
    await expect(fetchHealth()).resolves.toEqual({ kind: 'reachable', data: healthyBody });
  });

  it('reports a reachable API with the database down (HTTP 503)', async () => {
    const downBody = { ...healthyBody, status: 'error', database: 'down' };
    mockFetch(() => jsonResponse(downBody, 503));
    await expect(fetchHealth()).resolves.toEqual({ kind: 'reachable', data: downBody });
  });

  it('reports "not responding" when the dev proxy answers 500 (API stopped)', async () => {
    mockFetch(() => Promise.resolve(new Response('proxy error', { status: 500 })));
    await expect(fetchHealth()).resolves.toEqual({
      kind: 'unreachable',
      reason: { code: 'not_responding' },
    });
  });

  it('reports "not responding" on a network failure', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(fetchHealth()).resolves.toEqual({
      kind: 'unreachable',
      reason: { code: 'not_responding' },
    });
  });

  it('reports an unexpected response with its HTTP status', async () => {
    mockFetch(() => jsonResponse({ message: 'Not Found' }, 404));
    await expect(fetchHealth()).resolves.toEqual({
      kind: 'unreachable',
      reason: { code: 'unexpected_response', httpStatus: 404 },
    });
  });

  it('lets a cancelled request stop silently (AbortError is re-thrown)', async () => {
    mockFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    await expect(fetchHealth()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
