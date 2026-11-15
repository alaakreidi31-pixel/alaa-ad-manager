// Report routes of the API (phase 7, ADR 0021). Every number comes from the
// database. Money is TEXT in ONE currency ("150.30"); it is turned into a
// number only to place a mark on a chart, never to compute a stored amount.
import type { Api } from './api-client';
import type { CampaignPlatform } from './campaigns-api';

export type Granularity = 'day' | 'week' | 'month';

export interface PerformanceQuery {
  from: string;
  to: string;
  granularity: Granularity;
  currency?: string;
  clientId?: string;
  platform?: CampaignPlatform | '';
}

export interface PerformancePoint {
  period: string;
  spend: { meta: string; google: string; total: string };
  conversions: { meta: string; google: string; total: string };
  impressions: number;
  clicks: number;
}

export interface PerformanceReport {
  from: string;
  to: string;
  granularity: Granularity;
  currencies: string[];
  currency: string | null;
  points: PerformancePoint[];
  totals: {
    spend: string;
    impressions: number;
    clicks: number;
    conversions: string;
    ctr: string | null;
    cpc: string | null;
    cpa: string | null;
  };
}

export interface CampaignRow {
  id: string;
  name: string;
  platform: CampaignPlatform;
  clientId: string;
  clientName: string;
  spend: string;
  impressions: number;
  clicks: number;
  conversions: string;
  ctr: string | null;
  cpc: string | null;
  cpa: string | null;
}

export interface CampaignsReport {
  currency: string | null;
  currencies: string[];
  items: CampaignRow[];
}

export interface FinanceReport {
  from: string;
  to: string;
  currencies: {
    currency: string;
    months: { month: string; invoiced: string; collected: string }[];
    outstanding: string;
    overdue: number;
  }[];
}

export type ReportScope = 'admin' | 'client';

const clean = (query: PerformanceQuery) => ({
  from: query.from,
  to: query.to,
  granularity: query.granularity,
  currency: query.currency || undefined,
  clientId: query.clientId || undefined,
  platform: query.platform || undefined,
});

export const getPerformance = (api: Api, scope: ReportScope, query: PerformanceQuery) =>
  api<PerformanceReport>(`/${scope}/reports/performance`, { query: clean(query) });

export const getCampaignsReport = (api: Api, scope: ReportScope, query: PerformanceQuery) =>
  api<CampaignsReport>(`/${scope}/reports/campaigns`, { query: clean(query) });

export const getFinance = (api: Api, range: { from: string; to: string }) =>
  api<FinanceReport>('/admin/reports/finance', { query: { ...range } });

// Western digits in both languages, like the rest of the application.
const locale = (language: string | undefined) => `${language === 'ar' ? 'ar' : 'en'}-u-nu-latn`;

// "1234.5" + "USD" -> "USD 1,234.50" (decimals of the currency, from the API text).
export function formatMoney(value: string | null, currency: string | null, language?: string) {
  if (value === null || currency === null) return '—';
  const digits = value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;
  return new Intl.NumberFormat(locale(language), {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

// Short axis labels: "1.2K", "3.4M" (display only).
export function formatCompact(value: number, language?: string) {
  return new Intl.NumberFormat(locale(language), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatCount(value: number, language?: string) {
  return new Intl.NumberFormat(locale(language)).format(value);
}

// "2026-10-05" -> "5 Oct" (day/week) or "Oct 2026" (month), in UTC like the API.
export function periodLabel(period: string, granularity: Granularity, language?: string) {
  const date = new Date(`${period.length === 7 ? `${period}-01` : period}T00:00:00Z`);
  const options: Intl.DateTimeFormatOptions =
    granularity === 'month'
      ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(locale(language), options).format(date);
}

// The last N months as "YYYY-MM" (UTC), for the finance report.
export function lastMonths(count: number, now = new Date()): { from: string; to: string } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1), 1));
  return { from: from.toISOString().slice(0, 7), to: to.toISOString().slice(0, 7) };
}
