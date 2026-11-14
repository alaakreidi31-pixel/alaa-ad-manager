// Access token (JWT): short-lived, sent in the Authorization header.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

// Refresh token: random, stored only in an httpOnly cookie, rotated on every use.
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const REFRESH_COOKIE_NAME = 'alaa_refresh';
// The browser sends the cookie only to the auth endpoints.
export const REFRESH_COOKIE_PATH = '/api/auth';
