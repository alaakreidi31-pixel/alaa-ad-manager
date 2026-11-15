// Campaign routes of the API (ADR 0018). Money and conversions travel as
// TEXT ("150.50"): the browser never computes stored amounts.
import type { Api } from './api-client';

export type CampaignPlatform = 'META' | 'GOOGLE';
export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'ENDED' | 'ARCHIVED';
export type CampaignAction = 'pause' | 'activate' | 'end' | 'archive';

export interface Campaign {
  id: string;
  clientId: string;
  platform: CampaignPlatform;
  name: string;
  externalId: string | null;
  objective: string | null;
  status: CampaignStatus;
  currency: string;
  dailyBudget: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignWithClient extends Campaign {
  clientName: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Form values: texts ("" clears an optional field on the server).
export interface CampaignInput {
  name: string;
  externalId: string;
  objective: string;
  currency: string;
  dailyBudget: string;
  startDate: string;
  endDate: string;
}

export interface DayMetrics {
  date: string;
  spend: string;
  impressions: number;
  clicks: number;
  conversions: string;
  source: 'MANUAL' | 'CSV';
  updatedAt: string;
}

export interface MetricsReport {
  campaignId: string;
  currency: string;
  from: string;
  to: string;
  days: DayMetrics[];
  totals: { spend: string; impressions: number; clicks: number; conversions: string };
}

export interface DayInput {
  spend: string;
  impressions: string;
  clicks: string;
  conversions: string;
}

const base = (clientId: string) => `/admin/clients/${encodeURIComponent(clientId)}/campaigns`;
const one = (clientId: string, campaignId: string) =>
  `${base(clientId)}/${encodeURIComponent(campaignId)}`;

export const listAllCampaigns = (
  api: Api,
  query: { search?: string; status?: string; platform?: string; page?: number; pageSize?: number },
) => api<Page<CampaignWithClient>>('/admin/campaigns', { query: { ...query } });

export const listClientCampaigns = (api: Api, clientId: string) =>
  api<Page<Campaign>>(base(clientId), { query: { pageSize: 100 } });

export const getCampaign = (api: Api, clientId: string, campaignId: string) =>
  api<Campaign>(one(clientId, campaignId));

export const createCampaign = (
  api: Api,
  clientId: string,
  input: CampaignInput & { platform: CampaignPlatform },
) => api<Campaign>(base(clientId), { method: 'POST', body: input });

export const updateCampaign = (
  api: Api,
  clientId: string,
  campaignId: string,
  input: Partial<CampaignInput>,
) => api<Campaign>(one(clientId, campaignId), { method: 'PATCH', body: input });

export const changeCampaignStatus = (
  api: Api,
  clientId: string,
  campaignId: string,
  action: CampaignAction,
) => api<Campaign>(`${one(clientId, campaignId)}/${action}`, { method: 'POST' });

export const getCampaignMetrics = (
  api: Api,
  clientId: string,
  campaignId: string,
  range: { from: string; to: string },
) => api<MetricsReport>(`${one(clientId, campaignId)}/metrics`, { query: { ...range } });

export const saveCampaignDay = (
  api: Api,
  clientId: string,
  campaignId: string,
  date: string,
  input: DayInput,
) =>
  api<DayMetrics>(`${one(clientId, campaignId)}/metrics/${encodeURIComponent(date)}`, {
    method: 'PUT',
    body: input,
  });

// Today and N days ago, as "YYYY-MM-DD" (UTC, like the API).
export function lastDays(count: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - (count - 1) * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

// Ratios for DISPLAY only (never stored): click-through rate, cost per
// click, cost per conversion. null when dividing by zero.
export function ratios(totals: MetricsReport['totals']) {
  const spend = Number(totals.spend);
  const conversions = Number(totals.conversions);
  return {
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null,
    cpc: totals.clicks > 0 ? spend / totals.clicks : null,
    cpa: conversions > 0 ? spend / conversions : null,
  };
}

// CSV import (step 4.3): "preview" writes nothing; "commit" saves all or none.
export type ImportProblem =
  | 'bad_date'
  | 'bad_number'
  | 'missing_campaign_id'
  | 'duplicate_row'
  | 'unknown_campaign'
  | 'archived_campaign'
  | 'bad_amount'
  | 'future_day';

export interface ImportPreview {
  platform: CampaignPlatform;
  rows: {
    line: number;
    date: string;
    campaignId: string;
    campaignName: string;
    externalId: string;
    currency: string;
    spend: string;
    impressions: number;
    clicks: number;
    conversions: string;
    change: 'new' | 'correction';
  }[];
  errors: { line: number; reason: ImportProblem; externalId?: string }[];
  summary: { newDays: number; corrections: number; errors: number; campaigns: number };
}

const imports = (clientId: string) =>
  `/admin/clients/${encodeURIComponent(clientId)}/campaign-imports`;

export const previewImport = (
  api: Api,
  clientId: string,
  input: { platform: CampaignPlatform; csv: string },
) => api<ImportPreview>(`${imports(clientId)}/preview`, { method: 'POST', body: input });

export const commitImport = (
  api: Api,
  clientId: string,
  input: { platform: CampaignPlatform; csv: string },
) => api<ImportPreview>(`${imports(clientId)}/commit`, { method: 'POST', body: input });
