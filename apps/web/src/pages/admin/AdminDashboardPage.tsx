import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { ComingCard, StatCard } from '../../components/DashboardCards';
import { StatusBadge } from '../../components/StatusBadge';
import { SystemStatus } from '../../components/SystemStatus';
import { ui } from '../../components/ui';
import { getAdminDashboard, type AdminDashboard } from '../../lib/admin-api';
import { ApiError } from '../../lib/api-client';

function greetingKey(hour: number): string {
  if (hour < 12) return 'dashboard.morning';
  if (hour < 18) return 'dashboard.afternoon';
  return 'dashboard.evening';
}

// The administration home page (step 3.2): real numbers from the API only.
export function AdminDashboardPage() {
  const { t, i18n } = useTranslation();
  const { state, api } = useAuth();
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getAdminDashboard(api)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api]);

  if (state.status !== 'signed_in') return null;
  const now = new Date();
  const firstName = state.user.fullName.split(/\s+/)[0] ?? state.user.fullName;
  const today = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'full' }).format(now);
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' });
  const attention = data
    ? [
        data.accounts.pendingPasswordChange > 0 && {
          tone: 'gold',
          text: t('dashboard.attention.pendingPassword', {
            count: data.accounts.pendingPasswordChange,
          }),
        },
        data.clients.SUSPENDED > 0 && {
          tone: 'danger',
          text: t('dashboard.attention.suspendedClients', { count: data.clients.SUSPENDED }),
        },
      ].filter((item): item is { tone: string; text: string } => Boolean(item))
    : [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="me-auto">
          <h1 className="text-2xl font-bold sm:text-3xl">
            {t(greetingKey(now.getHours()), { name: firstName })}
          </h1>
          <p className="mt-1 text-sm text-ink-400">{today}</p>
        </div>
        <Link to="/admin/clients/new" className={ui.primary}>
          {t('clients.add')}
        </Link>
      </div>

      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}

      <section
        aria-label={t('dashboard.indicators')}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {data ? (
          <>
            <StatCard
              label={t('dashboard.activeClients')}
              value={data.clients.ACTIVE}
              note={t('dashboard.ofTotal', { total: data.clients.total })}
              icon="clients"
              tone="gold"
            />
            <StatCard
              label={t('dashboard.suspendedClients')}
              value={data.clients.SUSPENDED}
              note={t('dashboard.archivedCount', { count: data.clients.ARCHIVED })}
              icon="clients"
            />
            <StatCard
              label={t('dashboard.accounts')}
              value={data.accounts.active}
              note={t('dashboard.accountsNote', { suspended: data.accounts.suspended })}
              icon="tasks"
            />
            <StatCard
              label={t('dashboard.pendingPassword')}
              value={data.accounts.pendingPasswordChange}
              note={t('dashboard.pendingPasswordNote')}
              icon="settings"
            />
          </>
        ) : (
          !error && <p className="text-ink-400">{t('common.loading')}</p>
        )}
      </section>

      <section
        aria-label={t('dashboard.money')}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <ComingCard label={t('dashboard.adSpend')} phase={4} icon="campaigns" />
        <ComingCard label={t('dashboard.fees')} phase={5} icon="payments" />
        <ComingCard label={t('dashboard.dueInvoices')} phase={6} icon="invoices" />
        <ComingCard label={t('dashboard.activeCampaigns')} phase={4} icon="reports" />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={`${ui.card} lg:col-span-2`}>
          <div className="flex items-center gap-3">
            <h2 className="me-auto text-lg font-bold">{t('dashboard.recentClients')}</h2>
            <Link
              to="/admin/clients"
              className="text-sm font-semibold text-sky-300 hover:underline"
            >
              {t('dashboard.viewAll')}
            </Link>
          </div>
          {data && data.recentClients.length === 0 && (
            <p className="mt-6 text-center text-ink-400">{t('clients.empty')}</p>
          )}
          <ul className="mt-4 divide-y divide-ink-800">
            {data?.recentClients.map((client) => (
              <li key={client.id} className="flex items-center gap-3 py-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-400/10 font-bold text-sky-300"
                >
                  {client.name.charAt(0)}
                </span>
                <Link
                  to={`/admin/clients/${client.id}`}
                  className="me-auto truncate font-semibold hover:text-gold-300"
                >
                  {client.name}
                </Link>
                <StatusBadge status={client.status} />
                <span className="hidden text-sm text-ink-400 sm:inline">
                  {date.format(new Date(client.createdAt))}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-4">
          <div className={ui.card}>
            <h2 className="text-lg font-bold">{t('dashboard.attention.title')}</h2>
            {data && attention.length === 0 && (
              <p className="mt-4 text-sm text-ink-400">{t('dashboard.attention.none')}</p>
            )}
            <div className="mt-4 flex flex-col gap-2">
              {attention.map((item) => (
                <Link
                  key={item.text}
                  to="/admin/clients"
                  className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-sm ${
                    item.tone === 'danger'
                      ? 'border-danger/40 bg-danger/10'
                      : 'border-gold-500/40 bg-gold-400/10'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      item.tone === 'danger' ? 'bg-danger' : 'bg-gold-400'
                    }`}
                  />
                  {item.text}
                </Link>
              ))}
            </div>
          </div>
          <SystemStatus />
        </div>
      </section>
    </div>
  );
}
