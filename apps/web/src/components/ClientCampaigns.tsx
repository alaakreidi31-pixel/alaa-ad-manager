import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { ApiError } from '../lib/api-client';
import { listClientCampaigns, type Campaign } from '../lib/campaigns-api';
import { PlatformBadge } from './PlatformBadge';
import { StatusBadge } from './StatusBadge';
import { ui } from './ui';

// The campaigns of one client, on the client detail page (step 4.4).
export function ClientCampaigns({ clientId, archived }: { clientId: string; archived: boolean }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listClientCampaigns(api, clientId)
      .then((page) => {
        if (active) setItems(page.items);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api, clientId]);

  return (
    <>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <h2 className="me-auto text-xl font-bold text-white">{t('campaigns.title')}</h2>
        {!archived && (
          <>
            <Link to={`/admin/clients/${clientId}/campaigns/import`} className={ui.secondary}>
              {t('imports.button')}
            </Link>
            <Link to={`/admin/clients/${clientId}/campaigns/new`} className={ui.primary}>
              {t('campaigns.add')}
            </Link>
          </>
        )}
      </div>
      {error && (
        <p className={`${ui.error} mt-4`}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      <div className={`${ui.card} mt-4 p-0`}>
        {items?.length === 0 && (
          <p className="px-4 py-6 text-center text-ink-400">{t('campaigns.emptyClient')}</p>
        )}
        {!items && !error && (
          <p className="px-4 py-6 text-center text-ink-400">{t('common.loading')}</p>
        )}
        <ul className="divide-y divide-ink-800">
          {items?.map((campaign) => (
            <li key={campaign.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <PlatformBadge platform={campaign.platform} />
              <Link
                to={`/admin/clients/${clientId}/campaigns/${campaign.id}`}
                className="me-auto font-semibold text-gold-300 hover:underline"
              >
                {campaign.name}
              </Link>
              {campaign.dailyBudget && (
                <span dir="ltr" className="text-sm text-ink-400">
                  {campaign.dailyBudget} {campaign.currency} / {t('campaigns.perDay')}
                </span>
              )}
              <StatusBadge status={campaign.status} kind="campaigns" />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
