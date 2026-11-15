import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompact } from '../lib/reports-api';
import { ui } from './ui';

// Charts of the reports (phase 7). Colors are CSS variables (index.css):
// --chart-1 blue, --chart-2 gold, --chart-3 violet, validated for both
// themes (contrast and color-blind separation). Text always uses the text
// tokens, never a series color. Right-to-left: time runs from the right and
// the value axis sits on the right in Arabic.

export interface Series {
  key: string;
  name: string;
  color: 'var(--chart-1)' | 'var(--chart-2)' | 'var(--chart-3)';
}

// One mark per row: `values` place the marks, `texts` are the exact API
// texts shown in the tooltip and the table.
export interface ChartRow {
  label: string;
  values: Record<string, number>;
  texts: Record<string, string>;
}

const AXIS = { fill: 'var(--color-ink-400)', fontSize: 12 };

export function useRtl(): boolean {
  const { i18n } = useTranslation();
  return i18n.dir(i18n.resolvedLanguage) === 'rtl';
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null; // one series: the title names it
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-ink-400">
      {series.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm" style={{ background: item.color }} />
          {item.name}
        </li>
      ))}
    </ul>
  );
}

function TooltipBox({
  active,
  row,
  series,
  format,
}: {
  active?: boolean;
  row?: ChartRow;
  series: Series[];
  format: (text: string) => string;
}) {
  if (!active || !row) return null;
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-xs shadow-xl shadow-black/30">
      <p className="mb-1 font-semibold text-white">{row.label}</p>
      {series.map((item) => (
        <p key={item.key} className="flex items-center gap-2 text-ink-400">
          <span aria-hidden className="size-2 rounded-sm" style={{ background: item.color }} />
          <span>{item.name}</span>
          <span dir="ltr" className="ms-auto ps-3 font-semibold text-white">
            {format(row.texts[item.key] ?? '0')}
          </span>
        </p>
      ))}
    </div>
  );
}

// A card with a title, a chart/table switch, a CSV button and an empty state.
export function ChartCard({
  title,
  note,
  empty,
  onCsv,
  legend,
  chart,
  table,
}: {
  title: string;
  note?: string;
  empty?: string | false;
  onCsv?: () => void;
  legend?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
}) {
  const { t } = useTranslation();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`${ui.card} flex min-w-0 flex-col gap-4 !p-4 sm:!p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white">{title}</h2>
          {note && <p className="mt-1 text-xs text-ink-400">{note}</p>}
        </div>
        {!empty && (
          <div className="flex gap-2" data-print-hide>
            <button
              type="button"
              className={`${ui.secondary} !px-3 !py-1.5 !text-xs`}
              onClick={() => setAsTable((v) => !v)}
            >
              {asTable ? t('reports.showChart') : t('reports.showTable')}
            </button>
            {onCsv && (
              <button
                type="button"
                className={`${ui.secondary} !px-3 !py-1.5 !text-xs`}
                onClick={onCsv}
              >
                {t('reports.csv')}
              </button>
            )}
          </div>
        )}
      </div>
      {empty ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-10 text-center text-sm text-ink-400">
          {empty}
        </p>
      ) : (
        <>
          {!asTable && legend}
          {asTable ? <div className="overflow-x-auto">{table}</div> : chart}
        </>
      )}
    </section>
  );
}

// Change over time: stacked bars (amounts) or lines (counts), one axis.
export function TimeChart({
  kind,
  rows,
  series,
  format,
}: {
  kind: 'stacked' | 'line';
  rows: ChartRow[];
  series: Series[];
  format: (text: string) => string;
}) {
  const rtl = useRtl();
  const { i18n } = useTranslation();
  const tooltip = (
    <Tooltip
      cursor={
        kind === 'stacked'
          ? { fill: 'var(--color-ink-800)', opacity: 0.6 }
          : { stroke: 'var(--color-ink-700)' }
      }
      content={({ active, payload }) => (
        <TooltipBox
          active={active}
          row={payload?.[0]?.payload as ChartRow | undefined}
          series={series}
          format={format}
        />
      )}
    />
  );
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--color-ink-800)" />
      <XAxis
        dataKey="label"
        reversed={rtl}
        tick={AXIS}
        tickLine={false}
        axisLine={{ stroke: 'var(--color-ink-700)' }}
        minTickGap={16}
        interval="preserveStartEnd"
      />
      <YAxis
        orientation={rtl ? 'right' : 'left'}
        tick={AXIS}
        tickLine={false}
        axisLine={false}
        width={48}
        tickFormatter={(value: number) => formatCompact(value, i18n.resolvedLanguage)}
      />
    </>
  );
  return (
    <div dir="ltr" className="h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'stacked' ? (
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            {axes}
            {tooltip}
            {series.map((item, index) => (
              <Bar
                key={item.key}
                name={item.name}
                dataKey={(row: ChartRow) => row.values[item.key] ?? 0}
                stackId="total"
                fill={item.color}
                stroke="var(--color-ink-900)"
                strokeWidth={1}
                maxBarSize={36}
                radius={index === series.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            {axes}
            {tooltip}
            {series.map((item) => (
              <Line
                key={item.key}
                name={item.name}
                dataKey={(row: ChartRow) => row.values[item.key] ?? 0}
                type="monotone"
                stroke={item.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--color-ink-900)', strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// Grouped bars per month (finance: invoiced vs collected), one axis.
export function GroupedBars({
  rows,
  series,
  format,
}: {
  rows: ChartRow[];
  series: Series[];
  format: (text: string) => string;
}) {
  const rtl = useRtl();
  const { i18n } = useTranslation();
  return (
    <div dir="ltr" className="h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--color-ink-800)" />
          <XAxis
            dataKey="label"
            reversed={rtl}
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-ink-700)' }}
            minTickGap={8}
            interval="preserveStartEnd"
          />
          <YAxis
            orientation={rtl ? 'right' : 'left'}
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(value: number) => formatCompact(value, i18n.resolvedLanguage)}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-ink-800)', opacity: 0.6 }}
            content={({ active, payload }) => (
              <TooltipBox
                active={active}
                row={payload?.[0]?.payload as ChartRow | undefined}
                series={series}
                format={format}
              />
            )}
          />
          {series.map((item) => (
            <Bar
              key={item.key}
              name={item.name}
              dataKey={(row: ChartRow) => row.values[item.key] ?? 0}
              fill={item.color}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Horizontal bars, one series (campaign comparison): longest first.
export function RankingBars({
  rows,
  series,
  format,
}: {
  rows: ChartRow[];
  series: Series;
  format: (text: string) => string;
}) {
  const rtl = useRtl();
  const { i18n } = useTranslation();
  return (
    <div dir="ltr" className="w-full" style={{ height: Math.max(160, rows.length * 36 + 32) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="var(--color-ink-800)" />
          <XAxis
            type="number"
            reversed={rtl}
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatCompact(value, i18n.resolvedLanguage)}
          />
          <YAxis
            type="category"
            dataKey="label"
            orientation={rtl ? 'right' : 'left'}
            tick={{ ...AXIS, fill: 'var(--color-white)' }}
            tickLine={false}
            axisLine={false}
            width={130}
            tickFormatter={(value: string) =>
              value.length > 18 ? `${value.slice(0, 17)}…` : value
            }
          />
          <Tooltip
            cursor={{ fill: 'var(--color-ink-800)', opacity: 0.6 }}
            content={({ active, payload }) => (
              <TooltipBox
                active={active}
                row={payload?.[0]?.payload as ChartRow | undefined}
                series={[series]}
                format={format}
              />
            )}
          />
          <Bar
            name={series.name}
            dataKey={(row: ChartRow) => row.values[series.key] ?? 0}
            fill={series.color}
            maxBarSize={20}
            radius={rtl ? [4, 0, 0, 4] : [0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Plain table (the accessible view of every chart).
export function DataTable({ header, rows }: { header: string[]; rows: ReactNode[][] }) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-ink-700 text-ink-400">
        <tr>
          {header.map((title, index) => (
            <th
              key={title}
              className={`px-3 py-2 font-semibold ${index === 0 ? 'text-start' : 'text-end'}`}
            >
              {title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex} className="border-b border-ink-800 last:border-0">
            {row.map((value, index) => (
              <td
                key={index}
                dir={index === 0 ? undefined : 'ltr'}
                className={`px-3 py-2 text-white ${index === 0 ? 'text-start' : 'text-end'}`}
              >
                {value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
