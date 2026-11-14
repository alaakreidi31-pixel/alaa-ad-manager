// Talks to the API's /api/auth endpoints (see apps/api/src/auth/auth.controller.ts).
//
// Security rules (ADR 0011, 0013):
// - The access token is kept in memory only (never localStorage), so a
//   malicious script cannot find it in the browser storage.
// - The refresh token is an httpOnly cookie: this code never sees it.

export type UserRole = 'SUPER_ADMIN' | 'CLIENT_USER';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  // The client of a CLIENT_USER account, null for the administration.
  clientId?: string | null;
}

export interface Session {
  accessToken: string;
  expiresIn: number; // seconds
  user: AuthUser;
}

// Codes, not sentences: the UI translates them (Arabic / English).
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'invalid_session'
  | 'login_step_expired'
  | 'invalid_code'
  | 'account_locked'
  | 'account_suspended'
  | 'two_factor_setup_required'
  | 'client_inactive'
  | 'password_change_expired'
  | 'weak_password'
  | 'password_reused'
  | 'password_mismatch' // checked in the browser: the two new passwords differ
  | 'too_many_requests'
  | 'invalid_input'
  | 'server_unreachable';

export class AuthApiError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
  }
}

export type LoginResult =
  | { status: 'authenticated'; session: Session }
  | { status: 'two_factor_required'; challengeToken: string; expiresIn: number }
  | { status: 'password_change_required'; changeToken: string; expiresIn: number };

const KNOWN_CODES: readonly AuthErrorCode[] = [
  'invalid_credentials',
  'invalid_session',
  'login_step_expired',
  'invalid_code',
  'account_locked',
  'account_suspended',
  'two_factor_setup_required',
  'client_inactive',
  'password_change_expired',
  'weak_password',
  'password_reused',
];

function errorCode(status: number, body: unknown): AuthErrorCode {
  const code =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['code'] : null;
  if (typeof code === 'string' && (KNOWN_CODES as readonly string[]).includes(code)) {
    return code as AuthErrorCode;
  }
  if (status === 429) return 'too_many_requests';
  if (status === 400) return 'invalid_input';
  if (status === 401) return 'invalid_session';
  return 'server_unreachable';
}

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const user = v['user'] as Record<string, unknown> | undefined;
  return (
    typeof v['accessToken'] === 'string' &&
    typeof v['expiresIn'] === 'number' &&
    typeof user === 'object' &&
    user !== null &&
    typeof user['id'] === 'string' &&
    typeof user['email'] === 'string'
  );
}

// POST to the API; throws AuthApiError with a code on any failure.
async function post(path: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      credentials: 'same-origin', // sends the httpOnly refresh cookie
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new AuthApiError('server_unreachable');
  }
  const data: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new AuthApiError(errorCode(response.status, data));
  return data;
}

function toSession(data: unknown): Session {
  if (!isSession(data)) throw new AuthApiError('server_unreachable');
  return { accessToken: data.accessToken, expiresIn: data.expiresIn, user: data.user };
}

// The API answers a login step with a session, or with the next step to do.
function toLoginResult(data: unknown): LoginResult {
  const v = (data ?? {}) as Record<string, unknown>;
  if (v['status'] === 'password_change_required' && typeof v['changeToken'] === 'string') {
    return {
      status: 'password_change_required',
      changeToken: v['changeToken'],
      expiresIn: typeof v['expiresIn'] === 'number' ? v['expiresIn'] : 600,
    };
  }
  if (v['status'] === 'two_factor_required' && typeof v['challengeToken'] === 'string') {
    return {
      status: 'two_factor_required',
      challengeToken: v['challengeToken'],
      expiresIn: typeof v['expiresIn'] === 'number' ? v['expiresIn'] : 300,
    };
  }
  return { status: 'authenticated', session: toSession(data) };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  return toLoginResult(await post('login', { email, password }));
}

// After a temporary password: the user's own new password (ADR 0016).
export async function changeTemporaryPassword(
  changeToken: string,
  newPassword: string,
): Promise<LoginResult> {
  return toLoginResult(await post('password/change', { changeToken, newPassword }));
}

export async function verifyTwoFactor(challengeToken: string, code: string): Promise<Session> {
  return toSession(await post('2fa/verify', { challengeToken, code }));
}

// Every refresh token works only ONCE (rotation, ADR 0011). Two refreshes at the
// same time would send the same cookie twice, and the API would treat that as
// a stolen token and close every session. So only one refresh runs at a time:
// callers arriving meanwhile share its result.
let refreshInFlight: Promise<Session | null> | null = null;

// Returns the new session, or null when there is no valid session (signed out).
export function refreshSession(): Promise<Session | null> {
  refreshInFlight ??= post('refresh')
    .then(toSession)
    .catch((error: unknown) => {
      if (error instanceof AuthApiError && error.code !== 'server_unreachable') return null;
      throw error;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

// Never fails: the local session is cleared even if the API cannot be reached.
export async function logout(): Promise<void> {
  try {
    await post('logout');
  } catch {
    // ignore
  }
}
