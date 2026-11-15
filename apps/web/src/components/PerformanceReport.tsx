import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/auth-context';
import { listClients } from '../lib/admin-api';
import { ApiError } from '../lib/api-client';
import { lastDays } from '../lib/campaigns-api';
import { downloadCsv } from '../lib/csv';
import {
  formatCount,
  formatMoney,
  getCampaignsReport,
  getPerformance,
  periodLabel,
  type CampaignsReport,
  type Granularity,
  type PerformanceQuery,
  type PerformanceReport,
  type ReportScope,
} from '../lib/reports-api';
import { DateRange } from './DateRange';
import { PlatformBadge } from './PlatformBadge';
import {
  ChartCard,
  DataTable,
  Legend,
  RankingBars,
  TimeChart,
  type ChartRow,
  type Series,
} from './ReportCharts';
import { ui } from './ui';

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-ink-700 border-t-2 border-t-sky-400/55 bg-ink-900 p-4">
      <p className="text-xs font-medium text-ink-400">{label}</p>
      <p dir="ltr" className="mt-2 truncate text-end text-lg font-bold text-white sm:text-xl">
        {value}
      </p>
    </div>
  );
}

const select =
  'mt-1 block rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 text-white focus:border-gold-500 focus:outline-none';

// Campaign performance and comparison (phase 7). Admin: every client, with
// a client filter. Client portal: its own campaigns (the API decides).
export function PerformanceReportView({ scope }: { scope: ReportScope }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const language = i18n.resolvedLanguage;
  const [query, setQuery] = useState<PerformanceQuery>({
    ...lastDays(30),
    granularity: 'day',
    platform: '',
  });
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignsReport | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (scope !== 'admin') return;
    listClients(api, { pageSize: 100 })
      .then((page) => setClients(page.items.map(({ id, name }) => ({ id, name }))))
      .catch(() => setClients([]));
  }, [api, scope]);

  useEffect(() => {
    let active = true;
    setError(null);
    Promise.all([getPerformance(api, scope, query), getCampaignsReport(api, scope, query)])
      .then(([performance, compared]) => {
        if (!active) return;
        setReport(performance);
        setCampaigns(compared);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api, scope, query]);

  const currency = report?.currency ?? null;
  const money = (text: string) => formatMoney(text, currency, language);
  const conversions = (text: string) => text;
  const platforms: Series[] = [
    { key: 'meta', name: t('reports.meta'), color: 'var(--chart-1)' },
    { key: 'google', name: t('reports.google'), color: 'var(--chart-2)' },
  ];

  const spendRows = useMemo<ChartRow[]>(
    () =>
      (report?.points ?? []).map((point) => ({
        label: periodLabel(point.period, query.granularity, language),
        values: { meta: Number(point.spend.meta), google: Number(point.spend.google) },
        texts: { meta: point.spend.meta, google: point.spend.google },
      })),
    [report, query.granularity, language],
  );
  const conversionRows = useMemo<ChartRow[]>(
    () =>
      (report?.points ?? []).map((point) => ({
        label: periodLabel(point.period, query.granularity, language),
        values: { meta: Number(point.conversions.meta), google: Number(point.conversions.google) },
        texts: { meta: point.conversions.meta, google: point.conversions.google },
      })),
    [report, query.granularity, language],
  );
  const top = (campaigns?.items ?? []).slice(0, 10);
  const rankingRows: ChartRow[] = top.map((item) => ({
    label: item.name,
    values: { spend: Number(item.spend) },
    texts: { spend: item.spend },
  }));

  const noData = report !== null && currency === null ? t('reports.emptyPerformance') : false;
  const noConversions =
    noData ||
    (report !== null && report.totals.conversions === '0.00'
      ? t('reports.emptyConversions')
      : false);
  const fileName = (name: string) =>
    `${name}-${query.from}-${query.to}${currency ? `-${currency}` : ''}.csv`;

  const exportPerformance = () =>
    report &&
    downloadCsv(
      fileName('performance'),
      [
        'period',
        'currency',
        'spend_meta',
        'spend_google',
        'spend_total',
        'conversions_meta',
        'conversions_google',
        'conversions_total',
        'impressions',
        'clicks',
      ],
      report.points.map((p) => [
        p.period,
        currency,
        p.spend.meta,
        p.spend.google,
        p.spend.total,
        p.conversions.meta,
        p.conversions.google,
        p.conversions.total,
        p.impressions,
        p.clicks,
      ]),
    );
  const exportCampaigns = () =>
    campaigns &&
    downloadCsv(
      fileName('campaigns'),
      [
        'campaign',
        ...(scope === 'admin' ? ['client'] : []),
        'platform',
        'currency',
        'spend',
        'impressions',
        'clicks',
        'ctr_percent',
        'conversions',
        'cpc',
        'cpa',
      ],
      campaigns.items.map((c) => [
        c.name,
        ...(scope === 'admin' ? [c.clientName] : []),
        c.platform,
        currency,
        c.spend,
        c.impressions,
        c.clicks,
        c.ctr,
        c.conversions,
        c.cpc,
        c.cpa,
      ]),
    );

  const set = (patch: Partial<PerformanceQuery>) =>
    setQuery((current) => ({ ...current, ...patch }));
  const currencyOptions = report?.currencies ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className={`${ui.card} flex flex-wrap items-end gap-3 !p-4`} data-print-hide>
        <DateRange value={query} onChange={(range) => set(range)} />
        <label className="text-sm text-ink-400">
          {t('reports.granularity')}
          <select
            className={select}
            value={query.granularity}
            onChange={(e) => set({ granularity: e.target.value as Granularity })}
          >
            <option value="day">{t('reports.day')}</option>
            <option value="week">{t('reports.week')}</option>
            <option value="month">{t('reports.month')}</option>
          </select>
        </label>
        <label className="text-sm text-ink-400">
          {t('reports.platform')}
          <select
            className={select}
            value={query.platform}
            onChange={(e) => set({ platform: e.target.value as PerformanceQuery['platform'] })}
          >
            <option value="">{t('reports.allPlatforms')}</option>
            <option value="META">{t('reports.meta')}</option>
            <option value="GOOGLE">{t('reports.google')}</option>
          </select>
        </label>
        {scope === 'admin' && (
          <label className="text-sm text-ink-400">
            {t('reports.client')}
            <select
              className={`${select} max-w-48`}
              value={query.clientId ?? ''}
              onChange={(e) => set({ clientId: e.target.value })}
            >
              <option value="">{t('reports.allClients')}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {currencyOptions.length > 1 && (
          <label className="text-sm text-ink-400">
            {t('reports.currency')}
            <select
              className={select}
              value={currency ?? ''}
              onChange={(e) => set({ currency: e.target.value })}
            >
              {currencyOptions.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      {!report && !error && <p className="text-ink-400">{t('common.loading')}</p>}

      {report && currency && report.currencies.length > 1 && (
        <p className="text-sm text-ink-400">
          {t('reports.oneCurrency', {
            currency,
            others: report.currencies.filter((c) => c !== currency).join('، '),
          })}
        </p>
      )}

      {report && currency && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Kpi label={t('campaigns.metrics.spend')} value={money(report.totals.spend)} />
          <Kpi
            label={t('campaigns.metrics.impressions')}
            value={formatCount(report.totals.impressions, language)}
          />
          <Kpi
            label={t('campaigns.metrics.clicks')}
            value={formatCount(report.totals.clicks, language)}
          />
          <Kpi
            label={t('campaigns.metrics.ctr')}
            value={report.totals.ctr === null ? '—' : `${report.totals.ctr}%`}
          />
          <Kpi label={t('campaigns.metrics.conversions')} value={report.totals.conversions} />
          <Kpi
            label={t('campaigns.metrics.cpa')}
            value={formatMoney(report.totals.cpa, currency, language)}
          />
        </div>
      )}

      {report && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ChartCard
            title={t('reports.spendOverTime')}
            note={currency ? t('reports.inCurrency', { currency }) : undefined}
            empty={noData}
            onCsv={exportPerformance}
            legend={<Legend series={platforms} />}
            chart={<TimeChart kind="stacked" rows={spendRows} series={platforms} format={money} />}
            table={
              <DataTable
                header={[
                  t('reports.period'),
                  t('reports.meta'),
                  t('reports.google'),
                  t('reports.total'),
                ]}
                rows={report.points.map((p, index) => [
                  spendRows[index]?.label ?? p.period,
                  money(p.spend.meta),
                  money(p.spend.google),
                  money(p.spend.total),
                ])}
              />
            }
          />
          <ChartCard
            title={t('reports.conversionsOverTime')}
            empty={noConversions}
            onCsv={exportPerformance}
            legend={<Legend series={platforms} />}
            chart={
              <TimeChart
                kind="line"
                rows={conversionRows}
                series={platforms}
                format={conversions}
              />
            }
            table={
              <DataTable
                header={[
                  t('reports.period'),
                  t('reports.meta'),
                  t('reports.google'),
                  t('reports.total'),
                ]}
                rows={report.points.map((p, index) => [
                  conversionRows[index]?.label ?? p.period,
                  p.conversions.meta,
                  p.conversions.google,
                  p.conversions.total,
                ])}
              />
            }
          />
        </div>
      )}

      {report && campaigns && (
        <ChartCard
          title={t('reports.compareCampaigns')}
          note={currency ? t('reports.compareNote', { currency }) : undefined}
          empty={campaigns.items.length === 0 ? t('reports.emptyCampaigns') : false}
          onCsv={exportCampaigns}
          chart={
            <RankingBars
              rows={rankingRows}
              series={{ key: 'spend', name: t('campaigns.metrics.spend'), color: 'var(--chart-1)' }}
              format={money}
            />
          }
          table={
            <DataTable
              header={[
                t('reports.campaign'),
                ...(scope === 'admin' ? [t('reports.client')] : []),
                t('campaigns.metrics.spend'),
                t('campaigns.metrics.clicks'),
                t('campaigns.metrics.ctr'),
                t('campaigns.metrics.conversions'),
                t('reports.cpc'),
                t('campaigns.metrics.cpa'),
              ]}
              rows={campaigns.items.map((c) => [
                <span key="name" className="flex items-center gap-2">
                  <PlatformBadge platform={c.platform} />
                  {c.name}
                </span>,
                ...(scope === 'admin' ? [c.clientName] : []),
                money(c.spend),
                formatCount(c.clicks, language),
                c.ctr === null ? '—' : `${c.ctr}%`,
                c.conversions,
                formatMoney(c.cpc, currency, language),
                formatMoney(c.cpa, currency, language),
              ])}
            />
          }
        />
      )}
    </div>
  );
}
