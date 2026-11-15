import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { PlatformBadge } from '../../components/PlatformBadge';
import { StatusBadge } from '../../components/StatusBadge';
import { ui } from '../../components/ui';
import { getClient, type AdminClient } from '../../lib/admin-api';
import { ApiError, type FieldError } from '../../lib/api-client';
import {
  changeCampaignStatus,
  getCampaign,
  getCampaignMetrics,
  lastDays,
  ratios,
  saveCampaignDay,
  type Campaign,
  type CampaignAction,
  type DayInput,
  type MetricsReport,
} from '../../lib/campaigns-api';

const codeOf = (error: unknown) => (error instanceof ApiError ? error.code : 'server_unreachable');
const EMPTY_DAY: DayInput = { spend: '', impressions: '', clicks: '', conversions: '' };

// Which buttons each status shows (same rules as the API, ADR 0018).
const ACTIONS: Record<Campaign['status'], CampaignAction[]> = {
  ACTIVE: ['pause', 'end', 'archive'],
  PAUSED: ['activate', 'end', 'archive'],
  ENDED: ['activate', 'archive'],
  ARCHIVED: ['activate'],
};

function Kpi({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-ink-700 border-t-2 border-t-sky-400/55 bg-ink-900 p-4">
      <p className="text-xs font-medium text-ink-400">{label}</p>
      <p dir="ltr" className="mt-2 truncate text-end text-xl font-bold text-white">
        {value}
        {unit && <span className="ms-1 text-xs font-medium text-ink-400">{unit}</span>}
      </p>
    </div>
  );
}

// /admin/clients/:id/campaigns/:campaignId: one campaign, its status, and
// its daily numbers (entered or corrected one day at a time).
export function CampaignDetailPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const { id: clientId = '', campaignId = '' } = useParams();

  const [client, setClient] = useState<AdminClient | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [range, setRange] = useState(() => lastDays(30));
  const [report, setReport] = useState<MetricsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dayDate, setDayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [day, setDay] = useState<DayInput>(EMPTY_DAY);
  const [dayErrors, setDayErrors] = useState<FieldError[]>([]);
  const [saved, setSaved] = useState(false);

  const loadCampaign = useCallback(async () => {
    try {
      const [loadedClient, loadedCampaign] = await Promise.all([
        getClient(api, clientId),
        getCampaign(api, clientId, campaignId),
      ]);
      setClient(loadedClient);
      setCampaign(loadedCampaign);
    } catch (caught) {
      setError(codeOf(caught));
    }
  }, [api, clientId, campaignId]);

  const loadReport = useCallback(async () => {
    try {
      setReport(await getCampaignMetrics(api, clientId, campaignId, range));
    } catch (caught) {
      setError(codeOf(caught));
    }
  }, [api, clientId, campaignId, range]);

  useEffect(() => {
    void loadCampaign();
  }, [loadCampaign]);
  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  async function act(action: CampaignAction) {
    if (action !== 'activate' && !window.confirm(t(`campaigns.confirm.${action}`))) return;
    setBusy(true);
    setError(null);
    try {
      setCampaign(await changeCampaignStatus(api, clientId, campaignId, action));
    } catch (caught) {
      setError(codeOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveDay(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDayErrors([]);
    setSaved(false);
    try {
      await saveCampaignDay(api, clientId, campaignId, dayDate, {
        spend: day.spend,
        impressions: day.impressions || '0',
        clicks: day.clicks || '0',
        conversions: day.conversions || '0',
      });
      setDay(EMPTY_DAY);
      setSaved(true);
      await loadReport();
    } catch (caught) {
      setError(codeOf(caught));
      if (caught instanceof ApiError) setDayErrors(caught.fields);
    } finally {
      setBusy(false);
    }
  }

  if (!campaign || !client) {
    return (
      <section className="mx-auto w-full max-w-6xl self-start">
        <Link to={`/admin/clients/${clientId}`} className="text-sm text-gold-300 hover:underline">
          {t('common.back')}
        </Link>
        <p className="mt-6 text-ink-400">
          {error ? t(`apiErrors.${error}`, t('apiErrors.server_unreachable')) : t('common.loading')}
        </p>
      </section>
    );
  }

  const readOnly = campaign.status === 'ARCHIVED' || client.status === 'ARCHIVED';
  const number = new Intl.NumberFormat('en-US');
  const money = (value: number | null) =>
    value === null
      ? '—'
      : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const shown = report ? ratios(report.totals) : null;
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
  const hasDayError = (field: string) => dayErrors.some((f) => f.field === field);

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 self-start">
      <div>
        <Link to={`/admin/clients/${clientId}`} className="text-sm text-gold-300 hover:underline">
          ← {client.name}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <PlatformBadge platform={campaign.platform} />
          <h1 className="text-2xl font-bold text-white">{campaign.name}</h1>
          <StatusBadge status={campaign.status} kind="campaigns" />
          {client.status !== 'ARCHIVED' && (
            <div className="ms-auto flex flex-wrap gap-2">
              {!readOnly && (
                <Link
                  to={`/admin/clients/${clientId}/campaigns/${campaignId}/edit`}
                  className={ui.secondary}
                >
                  {t('common.edit')}
                </Link>
              )}
              {ACTIONS[campaign.status].map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={busy}
                  className={action === 'archive' ? ui.danger : ui.secondary}
                  onClick={() => void act(action)}
                >
                  {t(`campaigns.actions.${action}`)}
                </button>
              ))}
            </div>
          )}
        </div>
        <p dir="auto" className="mt-2 text-sm text-ink-400">
          {[
            campaign.objective,
            campaign.externalId && `ID ${campaign.externalId}`,
            campaign.dailyBudget &&
              `${campaign.dailyBudget} ${campaign.currency} / ${t('campaigns.perDay')}`,
            (campaign.startDate || campaign.endDate) &&
              `${campaign.startDate ?? '…'} → ${campaign.endDate ?? '…'}`,
          ]
            .filter(Boolean)
            .join(' · ') || t('campaigns.noDetails')}
        </p>
      </div>

      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      {readOnly && <p className={ui.error}>{t('campaigns.archivedReadOnly')}</p>}

      <div className="flex flex-wrap items-end gap-3">
        <h2 className="me-auto text-xl font-bold text-white">{t('campaigns.metrics.title')}</h2>
        <label className="text-sm text-ink-400">
          {t('campaigns.metrics.from')}
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(event) =>
              event.target.value && setRange({ ...range, from: event.target.value })
            }
            className={`${ui.input} mt-1 w-auto py-2`}
          />
        </label>
        <label className="text-sm text-ink-400">
          {t('campaigns.metrics.to')}
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(event) =>
              event.target.value && setRange({ ...range, to: event.target.value })
            }
            className={`${ui.input} mt-1 w-auto py-2`}
          />
        </label>
      </div>

      {report && shown && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Kpi
            label={t('campaigns.metrics.spend')}
            value={report.totals.spend}
            unit={report.currency}
          />
          <Kpi
            label={t('campaigns.metrics.impressions')}
            value={number.format(report.totals.impressions)}
          />
          <Kpi label={t('campaigns.metrics.clicks')} value={number.format(report.totals.clicks)} />
          <Kpi
            label={t('campaigns.metrics.ctr')}
            value={shown.ctr === null ? '—' : `${shown.ctr.toFixed(2)}%`}
          />
          <Kpi
            label={t('campaigns.metrics.conversions')}
            value={number.format(Number(report.totals.conversions))}
          />
          <Kpi
            label={t('campaigns.metrics.cpa')}
            value={money(shown.cpa)}
            unit={shown.cpa === null ? undefined : report.currency}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={`${ui.card} overflow-x-auto p-0 lg:col-span-2`}>
          <table className="w-full text-sm">
            <thead className="border-b border-ink-700 text-ink-400">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">
                  {t('campaigns.metrics.date')}
                </th>
                <th className="px-4 py-3 text-end font-semibold">{t('campaigns.metrics.spend')}</th>
                <th className="px-4 py-3 text-end font-semibold">
                  {t('campaigns.metrics.impressions')}
                </th>
                <th className="px-4 py-3 text-end font-semibold">
                  {t('campaigns.metrics.clicks')}
                </th>
                <th className="px-4 py-3 text-end font-semibold">
                  {t('campaigns.metrics.conversions')}
                </th>
                <th className="px-4 py-3 text-start font-semibold">
                  {t('campaigns.metrics.source')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report?.days
                .slice()
                .reverse()
                .map((row) => (
                  <tr
                    key={row.date}
                    className={`border-b border-ink-800 last:border-0 ${
                      readOnly ? '' : 'cursor-pointer hover:bg-ink-800/60'
                    }`}
                    title={readOnly ? undefined : t('campaigns.metrics.clickToCorrect')}
                    onClick={() => {
                      if (readOnly) return;
                      setDayDate(row.date);
                      setDay({
                        spend: row.spend,
                        impressions: String(row.impressions),
                        clicks: String(row.clicks),
                        conversions: row.conversions,
                      });
                      setSaved(false);
                    }}
                  >
                    <td className="px-4 py-3 text-white">
                      {dateFormat.format(new Date(`${row.date}T00:00:00Z`))}
                    </td>
                    <td dir="ltr" className="px-4 py-3 text-end text-white">
                      {row.spend}
                    </td>
                    <td dir="ltr" className="px-4 py-3 text-end text-white">
                      {number.format(row.impressions)}
                    </td>
                    <td dir="ltr" className="px-4 py-3 text-end text-white">
                      {number.format(row.clicks)}
                    </td>
                    <td dir="ltr" className="px-4 py-3 text-end text-white">
                      {row.conversions}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-400">
                      {t(`campaigns.metrics.sources.${row.source}`)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {report?.days.length === 0 && (
            <p className="px-4 py-8 text-center text-ink-400">{t('campaigns.metrics.empty')}</p>
          )}
        </div>

        {!readOnly && (
          <form
            onSubmit={(event) => void saveDay(event)}
            className={`${ui.card} flex flex-col gap-4 self-start`}
            noValidate
          >
            <div>
              <h3 className="text-lg font-bold text-white">{t('campaigns.metrics.enterTitle')}</h3>
              <p className="mt-1 text-xs text-ink-400">{t('campaigns.metrics.enterHint')}</p>
            </div>
            <label className={ui.label}>
              {t('campaigns.metrics.date')}
              <input
                type="date"
                value={dayDate}
                onChange={(event) => setDayDate(event.target.value)}
                className={ui.input}
              />
            </label>
            {(['spend', 'impressions', 'clicks', 'conversions'] as const).map((field) => (
              <label key={field} className={ui.label}>
                {t(`campaigns.metrics.${field}`)}
                {field === 'spend' && (
                  <span className="ms-1 text-xs text-ink-400" dir="ltr">
                    ({campaign.currency})
                  </span>
                )}
                {field === 'spend' && <span className="text-gold-400"> *</span>}
                <input
                  dir="ltr"
                  inputMode={field === 'spend' || field === 'conversions' ? 'decimal' : 'numeric'}
                  value={day[field]}
                  placeholder="0"
                  aria-invalid={hasDayError(field)}
                  onChange={(event) => setDay({ ...day, [field]: event.target.value })}
                  className={`${ui.input} ${hasDayError(field) ? 'border-danger' : ''}`}
                />
              </label>
            ))}
            {saved && <p className={ui.success}>{t('campaigns.metrics.saved')}</p>}
            <button
              type="submit"
              disabled={busy || !day.spend.trim() || !dayDate}
              className={ui.primary}
            >
              {busy ? t('auth.wait') : t('campaigns.metrics.save')}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
