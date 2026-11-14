import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { apiRequest, type Api, type RequestOptions } from '../lib/api-client';
import { logout as apiLogout, refreshSession, type AuthUser, type Session } from '../lib/auth-api';

export type AuthState =
  | { status: 'loading' } // checking the session cookie on page load
  | { status: 'signed_out' }
  | { status: 'signed_in'; user: AuthUser };

interface AuthContextValue {
  state: AuthState;
  signIn: (session: Session) => void;
  signOut: () => Promise<void>;
  // For API calls that need "Authorization: Bearer" (next phases).
  getAccessToken: () => string | null;
  // Calls a protected API route; renews an expired session once (ADR 0015).
  api: Api;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Renew the access token this long before it expires (it lives 15 minutes).
const REFRESH_MARGIN_SECONDS = 60;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  // In memory only: gone when the tab closes, never in localStorage.
  const accessToken = useRef<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clear = useCallback(() => {
    clearTimeout(refreshTimer.current);
    accessToken.current = null;
    setState({ status: 'signed_out' });
  }, []);

  const apply = useCallback(
    (session: Session) => {
      accessToken.current = session.accessToken;
      setState({ status: 'signed_in', user: session.user });

      // Silent renewal before expiry, so work is never interrupted.
      clearTimeout(refreshTimer.current);
      const delayMs = Math.max(session.expiresIn - REFRESH_MARGIN_SECONDS, 10) * 1000;
      refreshTimer.current = setTimeout(() => {
        refreshSession()
          .then((next) => (next ? apply(next) : clear()))
          .catch(clear);
      }, delayMs);
    },
    [clear],
  );

  // On page load: restore the session from the httpOnly refresh cookie.
  useEffect(() => {
    let active = true;
    refreshSession()
      .then((session) => {
        if (!active) return;
        if (session) apply(session);
        else clear();
      })
      .catch(() => {
        if (active) clear();
      });
    return () => {
      active = false;
      clearTimeout(refreshTimer.current);
    };
  }, [apply, clear]);

  const signOut = useCallback(async () => {
    await apiLogout();
    clear();
  }, [clear]);

  const api: Api = useCallback(
    <T,>(path: string, options: RequestOptions = {}) =>
      apiRequest<T>(path, options, {
        getToken: () => accessToken.current,
        renew: async () => {
          const session = await refreshSession().catch(() => null);
          if (session) apply(session);
          else clear();
          return session !== null;
        },
      }),
    [apply, clear],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn: apply, signOut, getAccessToken: () => accessToken.current, api }),
    [state, apply, signOut, api],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
