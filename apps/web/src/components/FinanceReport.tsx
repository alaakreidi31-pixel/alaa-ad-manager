import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/auth-context';
import { ApiError } from '../lib/api-client';
import { downloadCsv } from '../lib/csv';
import {
  formatMoney,
  getFinance,
  lastMonths,
  periodLabel,
  type FinanceReport,
} from '../lib/reports-api';
import { ChartCard, DataTable, GroupedBars, Legend, type Series } from './ReportCharts';
import { ui } from './ui';

// Agency finance (phase 7, admin only): invoiced (issued invoices, by
// invoiced month) and collected (payments, by payment date), one block per
// currency; amounts in different currencies are never added.
export function FinanceReportView() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const language = i18n.resolvedLanguage;
  const [months, setMonths] = useState(13);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    getFinance(api, lastMonths(months))
      .then((data) => {
        if (active) setReport(data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api, months]);

  const series: Series[] = [
    { key: 'invoiced', name: t('reports.invoiced'), color: 'var(--chart-1)' },
    { key: 'collected', name: t('reports.collected'), color: 'var(--chart-2)' },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">{t('reports.finance')}</h2>
          <p className="mt-1 text-xs text-ink-400">{t('reports.financeNote')}</p>
        </div>
        <label className="text-sm text-ink-400" data-print-hide>
          {t('reports.months')}
          <select
            className="mt-1 block rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 text-white focus:border-gold-500 focus:outline-none"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            {[6, 13, 24, 36].map((count) => (
              <option key={count} value={count}>
                {t('reports.lastMonths', { count })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      {!report && !error && <p className="text-ink-400">{t('common.loading')}</p>}
      {report?.currencies.length === 0 && (
        <p className={`${ui.card} text-center text-sm text-ink-400`}>{t('reports.emptyFinance')}</p>
      )}
      {report?.currencies.map((block) => {
        const money = (text: string) => formatMoney(text, block.currency, language);
        const rows = block.months.map((m) => ({
          label: periodLabel(m.month, 'month', language),
          values: { invoiced: Number(m.invoiced), collected: Number(m.collected) },
          texts: { invoiced: m.invoiced, collected: m.collected },
        }));
        return (
          <div key={block.currency} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 sm:max-w-xl">
              <div className="rounded-2xl border border-ink-700 border-t-2 border-t-gold-500/60 bg-ink-900 p-4">
                <p className="text-xs font-medium text-ink-400">
                  {t('reports.outstanding', { currency: block.currency })}
                </p>
                <p dir="ltr" className="mt-2 truncate text-end text-lg font-bold text-white">
                  {money(block.outstanding)}
                </p>
              </div>
              <div className="rounded-2xl border border-ink-700 border-t-2 border-t-danger/60 bg-ink-900 p-4">
                <p className="text-xs font-medium text-ink-400">{t('reports.overdue')}</p>
                <p dir="ltr" className="mt-2 text-end text-lg font-bold text-white">
                  {block.overdue}
                </p>
              </div>
            </div>
            <ChartCard
              title={t('reports.invoicedVsCollected', { currency: block.currency })}
              empty={
                block.months.every((m) => m.invoiced === m.collected && Number(m.invoiced) === 0)
                  ? t('reports.emptyFinance')
                  : false
              }
              onCsv={() =>
                downloadCsv(
                  `finance-${report.from}-${report.to}-${block.currency}.csv`,
                  ['month', 'currency', 'invoiced', 'collected'],
                  block.months.map((m) => [m.month, block.currency, m.invoiced, m.collected]),
                )
              }
              legend={<Legend series={series} />}
              chart={<GroupedBars rows={rows} series={series} format={money} />}
              table={
                <DataTable
                  header={[t('reports.month'), t('reports.invoiced'), t('reports.collected')]}
                  rows={block.months.map((m, index) => [
                    rows[index]?.label ?? m.month,
                    money(m.invoiced),
                    money(m.collected),
                  ])}
                />
              }
            />
          </div>
        );
      })}
    </section>
  );
}
