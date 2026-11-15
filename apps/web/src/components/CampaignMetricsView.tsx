import { useTranslation } from 'react-i18next';
import { ratios, type MetricsReport } from '../lib/campaigns-api';

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

// Totals and days of one campaign, READ ONLY (client portal, step 4.5).
export function CampaignMetricsView({ report }: { report: MetricsReport }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat('en-US');
  const shown = ratios(report.totals);
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
  const cpa = shown.cpa === null ? '—' : shown.cpa.toFixed(2);

  return (
    <>
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
        <Kpi label={t('campaigns.metrics.conversions')} value={report.totals.conversions} />
        <Kpi
          label={t('campaigns.metrics.cpa')}
          value={cpa}
          unit={shown.cpa === null ? undefined : report.currency}
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-ink-700 bg-ink-900">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-700 text-ink-400">
            <tr>
              <th className="px-4 py-3 text-start font-semibold">{t('campaigns.metrics.date')}</th>
              <th className="px-4 py-3 text-end font-semibold">{t('campaigns.metrics.spend')}</th>
              <th className="px-4 py-3 text-end font-semibold">
                {t('campaigns.metrics.impressions')}
              </th>
              <th className="px-4 py-3 text-end font-semibold">{t('campaigns.metrics.clicks')}</th>
              <th className="px-4 py-3 text-end font-semibold">
                {t('campaigns.metrics.conversions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.days
              .slice()
              .reverse()
              .map((row) => (
                <tr key={row.date} className="border-b border-ink-800 last:border-0">
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
                </tr>
              ))}
          </tbody>
        </table>
        {report.days.length === 0 && (
          <p className="px-4 py-8 text-center text-ink-400">{t('campaigns.metrics.empty')}</p>
        )}
      </div>
    </>
  );
}
