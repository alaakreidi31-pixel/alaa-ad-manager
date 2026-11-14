import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, type ApiDependencies } from './api-client';

function reply(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function mockFetch(...answers: (() => Promise<Response>)[]) {
  const fn = vi.fn<typeof fetch>();
  for (const answer of answers) fn.mockImplementationOnce(answer);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function deps(renewResult = true) {
  let token = 'old-token';
  const renew = vi.fn(() => {
    token = 'new-token';
    return Promise.resolve(renewResult);
  });
  const value: ApiDependencies = { getToken: () => token, renew };
  return { value, renew };
}

function header(fn: ReturnType<typeof mockFetch>, call: number, name: string) {
  const init = fn.mock.calls[call]?.[1];
  return (init?.headers as Record<string, string> | undefined)?.[name];
}

describe('apiRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the access token and the query, and returns the JSON', async () => {
    const fetchMock = mockFetch(() => reply({ total: 1 }));
    const result = await apiRequest(
      '/admin/clients',
      { query: { search: 'cafe', page: 2, status: undefined } },
      deps().value,
    );
    expect(result).toEqual({ total: 1 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/clients?search=cafe&page=2');
    expect(header(fetchMock, 0, 'Authorization')).toBe('Bearer old-token');
  });

  it('on 401 renews the session ONCE and repeats the request', async () => {
    const fetchMock = mockFetch(
      () => reply({ code: 'invalid_session' }, 401),
      () => reply({ ok: true }),
    );
    const { value, renew } = deps();
    await expect(apiRequest('/client/profile', {}, value)).resolves.toEqual({ ok: true });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(header(fetchMock, 1, 'Authorization')).toBe('Bearer new-token');
  });

  it('does not repeat when the session cannot be renewed', async () => {
    const fetchMock = mockFetch(() => reply({ code: 'invalid_session' }, 401));
    const error = await apiRequest('/client/profile', {}, deps(false).value).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ status: 401, code: 'invalid_session' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the API error code and the wrong fields', async () => {
    mockFetch(() =>
      reply({ code: 'invalid_input', fields: [{ field: 'email', message: 'bad' }] }, 400),
    );
    const error = await apiRequest(
      '/admin/clients',
      { method: 'POST', body: {} },
      deps().value,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'invalid_input', fields: [{ field: 'email' }] });
  });

  it('derives a code from the status, and recognizes network failures', async () => {
    mockFetch(
      () => reply(null, 404),
      () => Promise.reject(new TypeError('Failed to fetch')),
    );
    expect(await apiRequest('/x', {}, deps().value).catch((e: unknown) => e)).toMatchObject({
      code: 'not_found',
    });
    expect(await apiRequest('/x', {}, deps().value).catch((e: unknown) => e)).toMatchObject({
      code: 'server_unreachable',
    });
  });
});
