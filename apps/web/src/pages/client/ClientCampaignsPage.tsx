import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { PlatformBadge } from '../../components/PlatformBadge';
import { StatusBadge } from '../../components/StatusBadge';
import { ui } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { listMyCampaigns, type ClientCampaign } from '../../lib/campaigns-api';

// /campaigns in the client portal: the client's own campaigns (step 4.5).
export function ClientCampaignsPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [items, setItems] = useState<ClientCampaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listMyCampaigns(api)
      .then((data) => {
        if (active) setItems(data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api]);

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 self-start">
      <h1 className="text-2xl font-bold sm:text-3xl">{t('clientCampaigns.title')}</h1>
      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      {!items && !error && <p className="text-ink-400">{t('common.loading')}</p>}
      {items?.length === 0 && (
        <p className={`${ui.card} text-center text-ink-400`}>{t('clientCampaigns.empty')}</p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {items?.map((campaign) => (
          <Link
            key={campaign.id}
            to={`/campaigns/${campaign.id}`}
            className={`${ui.card} flex flex-col gap-3 transition hover:border-sky-400`}
          >
            <div className="flex items-center gap-2">
              <PlatformBadge platform={campaign.platform} />
              <StatusBadge status={campaign.status} kind="campaigns" />
            </div>
            <h2 className="text-lg font-bold text-white">{campaign.name}</h2>
            <p className="text-sm text-ink-400">
              {[
                campaign.objective,
                campaign.dailyBudget &&
                  `${campaign.dailyBudget} ${campaign.currency} / ${t('campaigns.perDay')}`,
                (campaign.startDate || campaign.endDate) &&
                  `${campaign.startDate ?? '…'} → ${campaign.endDate ?? '…'}`,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            </p>
            <span className="text-sm font-semibold text-sky-300">{t('clientCampaigns.open')}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
