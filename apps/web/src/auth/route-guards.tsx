import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { useAuth } from './auth-context';

function Loading() {
  const { t } = useTranslation();
  return (
    <p role="status" className="text-sm text-ink-400">
      {t('auth.loading')}
    </p>
  );
}

// Pages for signed-in users only: everyone else goes to /login.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'signed_out') return <Navigate to="/login" replace />;
  return children;
}

// The login page: a signed-in user goes straight to the home page.
export function GuestOnly({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'signed_in') return <Navigate to="/" replace />;
  return children;
}
