// Invoice and payment routes of the API (ADR 0020). Amounts travel as TEXT:
// the browser never computes an invoice amount.
import type { Api } from './api-client';

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'VOID';
export type PaymentState = 'unpaid' | 'partial' | 'paid';
export type PaymentMethod = 'BANK_TRANSFER' | 'CASH' | 'CARD' | 'OTHER';

export interface Invoice {
  id: string;
  clientId: string;
  clientName: string;
  month: string;
  currency: string;
  spend: string;
  fixedFee: string;
  percent: string;
  minimumFee: string | null;
  variableFee: string;
  total: string;
  status: InvoiceStatus;
  number: string | null;
  issuedAt: string | null;
  dueOn: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  paid: string;
  balance: string;
  paymentState: PaymentState;
  overdue: boolean;
}

export interface Payment {
  id: string;
  amount: string;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface InvoiceDetail extends Invoice {
  payments: Payment[];
  currentSpend: string;
  spendChangedSinceIssue: boolean;
}

export interface InvoicePage {
  items: Invoice[];
  total: number;
  page: number;
  pageSize: number;
}

// One word for the list: what the invoice needs now.
export type InvoiceLabel = 'draft' | 'void' | 'paid' | 'partial' | 'overdue' | 'unpaid';

export function invoiceLabel(
  invoice: Pick<Invoice, 'status' | 'paymentState' | 'overdue'>,
): InvoiceLabel {
  if (invoice.status === 'DRAFT') return 'draft';
  if (invoice.status === 'VOID') return 'void';
  if (invoice.paymentState === 'paid') return 'paid';
  if (invoice.overdue) return 'overdue';
  return invoice.paymentState === 'partial' ? 'partial' : 'unpaid';
}

export const listInvoices = (
  api: Api,
  query: { status?: string; clientId?: string; page?: number; pageSize?: number },
) => api<InvoicePage>('/admin/invoices', { query: { ...query } });

export const prepareDrafts = (api: Api) =>
  api<{ created: number; refreshed: number }>('/admin/invoices/prepare', { method: 'POST' });

export const getInvoice = (api: Api, id: string) =>
  api<InvoiceDetail>(`/admin/invoices/${encodeURIComponent(id)}`);

export const issueInvoice = (api: Api, id: string, dueOn?: string) =>
  api<Invoice>(`/admin/invoices/${encodeURIComponent(id)}/issue`, {
    method: 'POST',
    body: dueOn ? { dueOn } : {},
  });

export const voidInvoice = (api: Api, id: string, reason: string) =>
  api<Invoice>(`/admin/invoices/${encodeURIComponent(id)}/void`, {
    method: 'POST',
    body: { reason },
  });

export const recordPayment = (
  api: Api,
  id: string,
  input: { amount: string; paidOn: string; method: PaymentMethod; reference: string },
) =>
  api<InvoiceDetail>(`/admin/invoices/${encodeURIComponent(id)}/payments`, {
    method: 'POST',
    body: input,
  });

export const voidPayment = (api: Api, paymentId: string, reason: string) =>
  api<InvoiceDetail>(`/admin/payments/${encodeURIComponent(paymentId)}/void`, {
    method: 'POST',
    body: { reason },
  });
