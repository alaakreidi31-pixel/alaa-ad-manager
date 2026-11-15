import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { CampaignMetricsView } from '../../components/CampaignMetricsView';
import { DateRange } from '../../components/DateRange';
import { PlatformBadge } from '../../components/PlatformBadge';
import { StatusBadge } from '../../components/StatusBadge';
import { ui } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import {
  getMyCampaignMetrics,
  lastDays,
  listMyCampaigns,
  type ClientCampaign,
  type MetricsReport,
} from '../../lib/campaigns-api';

// /campaigns/:campaignId in the client portal: one campaign, read only.
export function ClientCampaignPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const { campaignId = '' } = useParams();
  const [campaign, setCampaign] = useState<ClientCampaign | null>(null);
  const [range, setRange] = useState(() => lastDays(30));
  const [report, setReport] = useState<MetricsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listMyCampaigns(api)
      .then((items) => {
        if (!active) return;
        const found = items.find((item) => item.id === campaignId);
        if (found) setCampaign(found);
        else setError('campaign_not_found');
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api, campaignId]);

  useEffect(() => {
    let active = true;
    getMyCampaignMetrics(api, campaignId, range)
      .then((data) => {
        if (active) setReport(data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api, campaignId, range]);

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 self-start">
      <Link to="/campaigns" className="text-sm text-gold-300 hover:underline">
        {t('common.back')}
      </Link>
      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      {campaign && (
        <div className="flex flex-wrap items-end gap-4">
          <div className="me-auto">
            <div className="flex items-center gap-2">
              <PlatformBadge platform={campaign.platform} />
              <StatusBadge status={campaign.status} kind="campaigns" />
            </div>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{campaign.name}</h1>
            {campaign.objective && (
              <p className="mt-1 text-sm text-ink-400">{campaign.objective}</p>
            )}
          </div>
          <DateRange value={range} onChange={setRange} />
        </div>
      )}
      {campaign && report && <CampaignMetricsView report={report} />}
    </section>
  );
}
