import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, login, logout, refreshSession, verifyTwoFactor } from './auth-api';

const user = { id: 'u1', email: 'owner@alaa.test', fullName: 'Alaa', role: 'SUPER_ADMIN' };
const sessionBody = { status: 'authenticated', accessToken: 'access', expiresIn: 900, user };

function reply(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));
}

function mockFetch(...answers: (() => Promise<Response>)[]) {
  const fn = vi.fn<typeof fetch>();
  for (const answer of answers) fn.mockImplementationOnce(answer);
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AuthApiError);
  return (error as AuthApiError).code;
}

describe('auth API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login without 2FA returns the session', async () => {
    const fetchMock = mockFetch(() => reply(sessionBody));
    await expect(login('owner@alaa.test', 'secret')).resolves.toEqual({
      status: 'authenticated',
      session: { accessToken: 'access', expiresIn: 900, user },
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/auth/login');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
  });

  it('login with 2FA returns the challenge for the second step', async () => {
    mockFetch(() =>
      reply({ status: 'two_factor_required', challengeToken: 'challenge', expiresIn: 300 }),
    );
    await expect(login('owner@alaa.test', 'secret')).resolves.toEqual({
      status: 'two_factor_required',
      challengeToken: 'challenge',
      expiresIn: 300,
    });
  });

  it('turns API error codes into AuthApiError codes', async () => {
    mockFetch(
      () => reply({ statusCode: 401, code: 'invalid_credentials' }, 401),
      () => reply({ statusCode: 429, code: 'account_locked' }, 429),
      () => reply({ statusCode: 403, code: 'two_factor_setup_required' }, 403),
    );
    expect(await codeOf(login('a@b.c', 'x'))).toBe('invalid_credentials');
    expect(await codeOf(login('a@b.c', 'x'))).toBe('account_locked');
    expect(await codeOf(login('a@b.c', 'x'))).toBe('two_factor_setup_required');
  });

  it('recognizes the per-IP limit and network failures', async () => {
    mockFetch(
      () => reply({ statusCode: 429, message: 'Too Many Requests' }, 429),
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => reply('proxy error', 500),
    );
    expect(await codeOf(login('a@b.c', 'x'))).toBe('too_many_requests');
    expect(await codeOf(login('a@b.c', 'x'))).toBe('server_unreachable');
    expect(await codeOf(login('a@b.c', 'x'))).toBe('server_unreachable');
  });

  it('second step sends the challenge and the code', async () => {
    const fetchMock = mockFetch(() => reply(sessionBody));
    await expect(verifyTwoFactor('challenge', '123456')).resolves.toMatchObject({ user });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/auth/2fa/verify');
    expect(JSON.parse(init?.body as string)).toEqual({
      challengeToken: 'challenge',
      code: '123456',
    });
  });

  it('refresh returns null when there is no valid session', async () => {
    mockFetch(() => reply({ statusCode: 401, code: 'invalid_session' }, 401));
    await expect(refreshSession()).resolves.toBeNull();
  });

  it('runs only ONE refresh at a time (the refresh token works once)', async () => {
    const fetchMock = mockFetch(() => reply(sessionBody));
    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);

    mockFetch(() => reply(sessionBody));
    await refreshSession(); // a later refresh is a new request
  });

  it('logout never fails, even when the API is down', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(logout()).resolves.toBeUndefined();
  });
});
