// Access token (JWT): short-lived, sent in the Authorization header.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

// Refresh token: random, stored only in an httpOnly cookie, rotated on every use.
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const REFRESH_COOKIE_NAME = 'alaa_refresh';
// The browser sends the cookie only to the auth endpoints.
export const REFRESH_COOKIE_PATH = '/api/auth';

// Brute-force protection (ADR 0012)
// Per account: after this many consecutive wrong passwords, login is refused...
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
// ...for this long (the password is not even checked during the lock).
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Per IP address, for login and refresh: at most this many requests per window.
export const RATE_LIMIT_MAX_REQUESTS = 10;
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// Two-factor authentication (ADR 0013)
// After a correct password, the second step must be completed within this time.
export const LOGIN_CHALLENGE_TTL_SECONDS = 5 * 60;
// Name shown in the authenticator app.
export const TOTP_ISSUER = 'ALAA AD MANAGER';
