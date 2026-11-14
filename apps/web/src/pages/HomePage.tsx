import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/auth-context';
import { SystemStatus } from '../components/SystemStatus';

// Temporary home page: replaced by the admin dashboard in phase 3.
export function HomePage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  if (state.status !== 'signed_in') return null;

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <section className="rounded-2xl border border-ink-700 bg-ink-900 p-6">
        <h1 className="text-2xl font-bold text-white">
          {t('home.welcome', { name: state.user.fullName })}
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          <span dir="ltr">{state.user.email}</span>
          {' · '}
          {t(`home.roles.${state.user.role}`)}
        </p>
      </section>
      <SystemStatus />
    </div>
  );
}
