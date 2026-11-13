// Shape returned by GET /api/health (see apps/api/src/health/health.controller.ts).
// In a later step this type moves to packages/shared, used by both API and web.
export interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  database: 'up' | 'down';
  timestamp: string;
  uptimeSeconds: number;
}

export type HealthResult =
  | { kind: 'reachable'; data: HealthResponse }
  | { kind: 'unreachable'; reason: string };

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v['status'] === 'ok' || v['status'] === 'error') &&
    (v['database'] === 'up' || v['database'] === 'down') &&
    typeof v['service'] === 'string'
  );
}

// 200 = all good, 503 = API alive but database down: both carry a JSON body.
// Anything else (network error, proxy error, non-JSON) = API unreachable.
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResult> {
  try {
    const response = await fetch('/api/health', { signal, headers: { Accept: 'application/json' } });
    const body: unknown = await response.json().catch(() => null);
    if (isHealthResponse(body)) {
      return { kind: 'reachable', data: body };
    }
    return { kind: 'unreachable', reason: `Unexpected response (HTTP ${response.status})` };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { kind: 'unreachable', reason: 'The API server is not responding' };
  }
}
