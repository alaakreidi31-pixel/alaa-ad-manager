// Calls to the protected API routes (/api/admin/..., /api/client/...).
// Adds the access token, and when it has expired (401) renews the session
// ONCE and repeats the request, so a form being typed is never lost.

export interface FieldError {
  field: string;
  message: string;
}

// "code" comes from the API (e.g. client_not_found, invalid_input), or is
// derived from the HTTP status. The UI translates codes, never English text.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: FieldError[] = [],
  ) {
    super(code);
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

export interface ApiDependencies {
  getToken: () => string | null;
  // Renews the session; false when the user is signed out.
  renew: () => Promise<boolean>;
}

export type Api = <T>(path: string, options?: RequestOptions) => Promise<T>;

const STATUS_CODES: Record<number, string> = {
  400: 'invalid_input',
  401: 'invalid_session',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'too_many_requests',
};

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return `/api${path}${search ? `?${search}` : ''}`;
}

async function send(url: string, options: RequestOptions, token: string | null) {
  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError(0, 'server_unreachable');
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions,
  deps: ApiDependencies,
): Promise<T> {
  const url = buildUrl(path, options.query);
  let response = await send(url, options, deps.getToken());
  if (response.status === 401 && (await deps.renew())) {
    response = await send(url, options, deps.getToken());
  }

  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const data = (body ?? {}) as { code?: unknown; fields?: unknown };
    const code =
      typeof data.code === 'string'
        ? data.code
        : (STATUS_CODES[response.status] ?? 'server_unreachable');
    const fields = Array.isArray(data.fields) ? (data.fields as FieldError[]) : [];
    throw new ApiError(response.status, code, fields);
  }
  return body as T;
}
