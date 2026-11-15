import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/auth-context';
import { StatCard } from '../../components/DashboardCards';
import { StatusBadge } from '../../components/StatusBadge';
import { ui } from '../../components/ui';
import { getMyClientProfile, type ClientProfile } from '../../lib/admin-api';
import { ApiError } from '../../lib/api-client';
import {
  getMyCampaignSummary,
  lastDays,
  type ClientCampaignSummary,
} from '../../lib/campaigns-api';
import { invoiceLabel, listMyInvoices } from '../../lib/invoices-api';

// The client portal overview (step 3.3). Only the client's own company
// (the id comes from the session, never from the page), without internal
// notes. Campaign and invoice numbers appear when their phases exist:
// nothing is invented (ADR 0017).
export function ClientHomePage() {
  const { t, i18n } = useTranslation();
  const { state, api } = useAuth();
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ClientCampaignSummary | null>(null);
  const [unpaid, setUnpaid] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    getMyClientProfile(api)
      .then((data) => {
        if (active) setProfile(data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api]);

  // Its issued invoices not fully paid yet (step 6.3).
  useEffect(() => {
    let active = true;
    listMyInvoices(api)
      .then((items) => {
        if (!active) return;
        const open = items.filter((item) =>
          ['unpaid', 'partial', 'overdue'].includes(invoiceLabel(item)),
        );
        setUnpaid(open.length);
      })
      .catch(() => {
        // The company card already shows a connection problem.
      });
    return () => {
      active = false;
    };
  }, [api]);

  // The last 30 days of the client's own campaigns (step 4.5).
  useEffect(() => {
    let active = true;
    getMyCampaignSummary(api, lastDays(30))
      .then((data) => {
        if (active) setSummary(data);
      })
      .catch(() => {
        // The company card above already shows a connection problem.
      });
    return () => {
      active = false;
    };
  }, [api]);

  if (state.status !== 'signed_in') return null;
  const today = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'full' }).format(
    new Date(),
  );
  // One line per currency: amounts in different currencies are never added.
  const spendText = !summary
    ? '…'
    : summary.totals.length === 0
      ? '0'
      : summary.totals.map((total) => `${total.spend} ${total.currency}`).join(' + ');
  const conversionsText = !summary
    ? '…'
    : (
        summary.totals.reduce(
          (sum, total) => sum + Math.round(Number(total.conversions) * 100),
          0,
        ) / 100
      ).toFixed(2);
  const fields = profile
    ? ([
        ['contactName', profile.contactName, false],
        ['email', profile.email, true],
        ['phone', profile.phone, true],
        ['website', profile.website, true],
        ['country', profile.country, false],
        ['currency', profile.currency, true],
        ['timezone', profile.timezone, true],
        ['businessIndustry', profile.businessIndustry, false],
      ] as const)
    : [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">
          {t('home.welcome', { name: state.user.fullName })}
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          {profile ? t('clientPortal.subtitle', { company: profile.name }) : today}
        </p>
      </div>

      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}

      <section
        aria-label={t('clientPortal.indicators')}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label={t('clientPortal.spend')}
          value={spendText}
          note={t('clientPortal.last30')}
          icon="campaigns"
          tone="gold"
        />
        <StatCard
          label={t('clientPortal.results')}
          value={conversionsText}
          note={t('clientPortal.last30')}
          icon="reports"
        />
        <StatCard
          label={t('clientPortal.activeCampaigns')}
          value={summary?.activeCampaigns ?? '…'}
          note={t('clientPortal.seeCampaigns')}
          icon="tasks"
        />
        <StatCard
          label={t('clientPortal.dueInvoices')}
          value={unpaid ?? '…'}
          note={t('clientPortal.seeInvoices')}
          icon="invoices"
        />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={`${ui.card} lg:col-span-2`}>
          {!profile && !error && <p className="text-ink-400">{t('common.loading')}</p>}
          {profile && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-400/10 text-lg font-bold text-sky-300"
                >
                  {profile.name.charAt(0)}
                </span>
                <div className="me-auto min-w-0">
                  <p className="text-xs font-semibold text-gold-500">{t('clientPortal.company')}</p>
                  <h2 className="truncate text-xl font-bold">{profile.name}</h2>
                </div>
                <StatusBadge status={profile.status} />
              </div>
              <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                {fields.map(([field, value, ltr]) => (
                  <div key={field} className="min-w-0">
                    <dt className="text-xs font-semibold text-ink-400">
                      {t(`clients.fields.${field}`)}
                    </dt>
                    <dd
                      className={`mt-1 truncate ${ltr && value ? 'text-end' : ''}`}
                      dir={ltr && value ? 'ltr' : undefined}
                    >
                      {value ?? '—'}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className={ui.card}>
            <h2 className="text-lg font-bold">{t('clientPortal.account')}</h2>
            <dl className="mt-4 flex flex-col gap-3 text-sm">
              <div>
                <dt className="text-xs font-semibold text-ink-400">
                  {t('clientPortal.signedInAs')}
                </dt>
                <dd className="mt-1 truncate text-end" dir="ltr">
                  {state.user.email}
                </dd>
              </div>
            </dl>
          </div>
          <div className={`${ui.card} border-dashed`}>
            <h2 className="text-lg font-bold">{t('clientPortal.nextTitle')}</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-400">
              {t('clientPortal.comingSoon')}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
