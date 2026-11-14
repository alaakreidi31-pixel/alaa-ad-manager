import type { AuthUser } from './auth.service';

// The small part of the Express request and response objects used by auth.
export interface AuthRequest {
  headers: {
    authorization?: string;
    cookie?: string;
    'user-agent'?: string;
  };
}

export interface AuthenticatedRequest extends AuthRequest {
  auth?: AuthUser & { sessionId: string };
}

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict';
  path: string;
  expires?: Date;
}

export interface AuthResponse {
  cookie(name: string, value: string, options: CookieOptions): void;
  clearCookie(name: string, options: CookieOptions): void;
}
