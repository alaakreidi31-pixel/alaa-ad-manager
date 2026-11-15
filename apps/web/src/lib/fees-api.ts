// Fee plan routes of the API (ADR 0019). Amounts travel as TEXT ("300.00"):
// the browser never computes a fee, PostgreSQL does.
import type { Api } from './api-client';

export type FeePlanStatus = 'active' | 'scheduled' | 'ended' | 'cancelled';

export interface FeePlan {
  id: string;
  currency: string;
  fixedFee: string;
  percent: string;
  minimumFee: string | null;
  startsOn: string;
  endsOn: string | null;
  cancelledAt: string | null;
  status: FeePlanStatus;
  createdAt: string;
}

export interface MonthFee {
  month: string;
  inProgress: boolean;
  plan: Pick<FeePlan, 'id' | 'currency' | 'fixedFee' | 'percent' | 'minimumFee'> | null;
  spend: string | null;
  fee: string | null;
  breakdown: { fixed: string; variable: string; minimumApplied: boolean } | null;
}

export interface CurrencyWarning {
  clientName: string;
  month: string;
  currency: string;
  spend: string;
}

export interface FeesReport {
  clientId: string;
  clientName: string;
  from: string;
  to: string;
  months: MonthFee[];
  warnings: CurrencyWarning[];
}

// Form values ("" = no minimum).
export interface FeePlanInput {
  currency: string;
  fixedFee: string;
  percent: string;
  minimumFee: string;
  startsOn: string; // "YYYY-MM"
}

const base = (clientId: string) => `/admin/clients/${encodeURIComponent(clientId)}`;

export const listFeePlans = (api: Api, clientId: string) =>
  api<FeePlan[]>(`${base(clientId)}/fee-plans`);

export const createFeePlan = (api: Api, clientId: string, input: FeePlanInput) =>
  api<FeePlan>(`${base(clientId)}/fee-plans`, {
    method: 'POST',
    body: {
      currency: input.currency,
      fixedFee: input.fixedFee.trim() || '0',
      percent: input.percent.trim() || '0',
      minimumFee: input.minimumFee.trim() || null,
      startsOn: input.startsOn,
    },
  });

export const cancelFeePlan = (api: Api, clientId: string, planId: string) =>
  api<FeePlan>(`${base(clientId)}/fee-plans/${encodeURIComponent(planId)}/cancel`, {
    method: 'POST',
  });

export const getClientFees = (api: Api, clientId: string, range?: { from: string; to: string }) =>
  api<FeesReport>(`${base(clientId)}/fees`, { query: { ...range } });

// "YYYY-MM" of the current month (UTC) plus an offset.
export function monthFromNow(offset: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 7);
}
