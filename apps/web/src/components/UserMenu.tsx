import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/auth-context';

// Shown in the header when signed in.
export function UserMenu() {
  const { t } = useTranslation();
  const { state, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  if (state.status !== 'signed_in') return null;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signOut().finally(() => setBusy(false));
      }}
      className="rounded-full border border-ink-700 px-4 py-1.5 text-sm font-semibold text-white transition hover:border-danger hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300 disabled:opacity-60"
    >
      {t('auth.signOut')}
    </button>
  );
}
