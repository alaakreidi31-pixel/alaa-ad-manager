import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { SystemStatus } from '../components/SystemStatus';
import { ui } from '../components/ui';
import { ClientHomePage } from './client/ClientHomePage';

// Home page by role: the client portal for client accounts, and a temporary
// administration home (replaced by the dashboard in phase 3).
export function HomePage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  if (state.status !== 'signed_in') return null;
  if (state.user.role === 'CLIENT_USER') return <ClientHomePage />;

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
        <Link to="/admin/clients" className={`${ui.primary} mt-5 inline-block`}>
          {t('nav.clients')}
        </Link>
      </section>
      <SystemStatus />
    </div>
  );
}
