import { Inject, Injectable } from '@nestjs/common';
import { auditRow } from '../audit/audit';
import { notifyClient } from '../notifications/notify';
import type { Actor } from '../clients/clients.service';
import type { Invoice, InvoiceStatus, Payment, PaymentMethod } from '../generated/prisma/client';
import { fromMinor, MoneyFormatError, toMinor } from '../money/money';
import { PrismaService } from '../prisma/prisma.service';
import {
  InvoiceHasPaymentsError,
  InvoiceNotFoundError,
  InvoiceStateError,
  InvoiceValidationError,
  PaymentExceedsTotalError,
  PaymentNotFoundError,
} from './invoices.errors';
import {
  IdSchema,
  IssueInvoiceSchema,
  ListInvoicesQuerySchema,
  RecordPaymentSchema,
  VoidSchema,
} from './invoices.schemas';

export type PaymentState = 'unpaid' | 'partial' | 'paid';

export interface InvoiceView {
  id: string;
  clientId: string;
  clientName: string;
  month: string; // "2026-10"
  currency: string;
  spend: string;
  fixedFee: string;
  percent: string;
  minimumFee: string | null;
  variableFee: string;
  total: string;
  status: InvoiceStatus;
  number: string | null;
  issuedAt: Date | null;
  dueOn: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  // Computed from the live (not voided) payments: never stored.
  paid: string;
  balance: string;
  paymentState: PaymentState;
  overdue: boolean;
}

export interface PaymentView {
  id: string;
  amount: string;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
}

export interface InvoiceDetail extends InvoiceView {
  payments: PaymentView[];
  // Spend of that month TODAY: differs from the issued snapshot when numbers
  // were corrected after the invoice was issued (then void + issue again).
  currentSpend: string;
  spendChangedSinceIssue: boolean;
}

type InvoiceRow = Invoice & { client: { name: string }; payments: Payment[] };

const day = (date: Date) => date.toISOString().slice(0, 10);
const utcToday = () => day(new Date());
const percentText = (basisPoints: number) =>
  `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, '0')}`;
const decimalToBigInt = (value: { toFixed: (digits: number) => string }) =>
  BigInt(value.toFixed(0));

function toView(row: InvoiceRow): InvoiceView {
  const paidMinor = row.payments
    .filter((payment) => payment.voidedAt === null)
    .reduce((sum, payment) => sum + payment.amountMinor, 0n);
  const balanceMinor = row.status === 'ISSUED' ? row.totalMinor - paidMinor : 0n;
  const paymentState: PaymentState =
    paidMinor === 0n ? 'unpaid' : paidMinor >= row.totalMinor ? 'paid' : 'partial';
  const money = (minor: bigint) => fromMinor(minor, row.currency);
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    month: day(row.periodMonth).slice(0, 7),
    currency: row.currency,
    spend: money(decimalToBigInt(row.spendMinor)),
    fixedFee: money(row.fixedFeeMinor),
    percent: percentText(row.percentBasisPoints),
    minimumFee: row.minimumFeeMinor === null ? null : money(row.minimumFeeMinor),
    variableFee: money(row.variableFeeMinor),
    total: money(row.totalMinor),
    status: row.status,
    number: row.number,
    issuedAt: row.issuedAt,
    dueOn: row.dueOn ? day(row.dueOn) : null,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    paid: money(paidMinor),
    balance: money(balanceMinor),
    paymentState,
    overdue:
      row.status === 'ISSUED' &&
      paymentState !== 'paid' &&
      row.dueOn !== null &&
      day(row.dueOn) < utcToday(),
  };
}

function toPaymentView(payment: Payment, currency: string): PaymentView {
  return {
    id: payment.id,
    amount: fromMinor(payment.amountMinor, currency),
    paidOn: day(payment.paidOn),
    method: payment.method,
    reference: payment.reference,
    voidedAt: payment.voidedAt,
    voidReason: payment.voidReason,
    createdAt: payment.createdAt,
  };
}

// What a CLIENT sees of an invoice: issued ones only, no void reason.
export type ClientInvoice = Omit<InvoiceView, 'voidReason' | 'clientId'>;

export interface ClientInvoiceDetail extends ClientInvoice {
  payments: { amount: string; paidOn: string; method: PaymentMethod }[];
}

function toClientView(row: InvoiceRow): ClientInvoice {
  const view: Partial<InvoiceView> = toView(row);
  delete view.voidReason;
  delete view.clientId;
  return view as ClientInvoice;
}

// The text of a database error, whatever layer wrapped it.
function databaseMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const meta = (error as { meta?: unknown }).meta;
  const cause = (error as { cause?: unknown }).cause;
  return [
    error.message,
    JSON.stringify(meta ?? ''),
    cause instanceof Error ? cause.message : '',
  ].join(' ');
}

// PostgreSQL refusals (constraints and triggers) as expected errors.
function translate(error: unknown): unknown {
  const text = databaseMessage(error);
  if (text.includes('cannot be voided: void the payments first'))
    return new InvoiceHasPaymentsError();
  if (text.includes('would exceed the invoice total')) return new PaymentExceedsTotalError();
  if (text.includes('cannot be dated in the future')) {
    return new InvoiceValidationError({ field: 'paidOn', message: 'cannot be in the future' });
  }
  if (text.includes('due date cannot be in the past') || text.includes('invoices_due_check')) {
    return new InvoiceValidationError({ field: 'dueOn', message: 'cannot be in the past' });
  }
  for (const message of [
    'an issued invoice cannot change',
    'a voided invoice cannot change',
    'payments are only recorded on an issued invoice',
    'a payment can only be voided, once',
  ]) {
    if (text.includes(message)) return new InvoiceStateError(message);
  }
  return error;
}

const WITH_DETAILS = { client: { select: { name: true } }, payments: true } as const;

// Invoices and payments (step 6.1, ADR 0020). PostgreSQL enforces every
// financial rule (amounts, numbering, states, no delete); this service
// prepares the drafts, maps the refusals to clear errors, and writes the
// audit log in the SAME transaction.
@Injectable()
export class InvoicesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: unknown) {
    const parsed = ListInvoicesQuerySchema.safeParse(query);
    if (!parsed.success) throw new InvoiceValidationError(parsed.error);
    const { status, clientId, page, pageSize } = parsed.data;
    const where = { ...(status ? { status } : {}), ...(clientId ? { clientId } : {}) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: WITH_DETAILS,
        orderBy: [{ periodMonth: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return { items: rows.map(toView), total, page, pageSize };
  }

  async get(id: string): Promise<InvoiceDetail> {
    const row = await this.find(this.prisma, id);
    const [current] = await this.prisma.$queryRaw<{ spend: string }[]>`
      SELECT COALESCE(SUM(m.spend_minor), 0)::text AS spend
      FROM campaign_daily_metrics m
      JOIN campaigns c ON c.id = m.campaign_id
      WHERE c.client_id = ${row.clientId}::uuid AND c.currency = ${row.currency}
        AND m.date >= ${day(row.periodMonth)}::date
        AND m.date < (${day(row.periodMonth)}::date + interval '1 month')`;
    const currentSpendMinor = BigInt(current?.spend ?? '0');
    return {
      ...toView(row),
      payments: row.payments
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((payment) => toPaymentView(payment, row.currency)),
      currentSpend: fromMinor(currentSpendMinor, row.currency),
      spendChangedSinceIssue:
        row.status === 'ISSUED' && currentSpendMinor !== decimalToBigInt(row.spendMinor),
    };
  }

  // Creates the missing drafts (every client with a fee plan, for each
  // month that is over, up to 12 months back) and refreshes the spend of the
  // existing drafts. Idempotent: running it twice changes nothing.
  async prepareDrafts(actor: Actor): Promise<{ created: number; refreshed: number }> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.$executeRaw`
        INSERT INTO invoices (client_id, fee_plan_id, period_month, currency, spend_minor,
                              fixed_fee_minor, percent_basis_points, minimum_fee_minor,
                              variable_fee_minor, total_minor)
        SELECT p.client_id, p.id, months.month::date, p.currency, s.spend,
               p.fixed_fee_minor, p.percent_basis_points, p.minimum_fee_minor,
               monthly_fee_minor(s.spend, 0, p.percent_basis_points, NULL),
               monthly_fee_minor(s.spend, p.fixed_fee_minor, p.percent_basis_points, p.minimum_fee_minor)
        FROM fee_plans p
        JOIN clients cl ON cl.id = p.client_id AND cl.status <> 'ARCHIVED'
        CROSS JOIN LATERAL generate_series(
          GREATEST(p.starts_on, (date_trunc('month', now() AT TIME ZONE 'UTC') - interval '12 months')::date),
          LEAST(COALESCE(p.ends_on, '9999-12-31'::date),
                (date_trunc('month', now() AT TIME ZONE 'UTC') - interval '1 month')::date),
          interval '1 month') AS months(month)
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(m.spend_minor), 0) AS spend
          FROM campaign_daily_metrics m
          JOIN campaigns ca ON ca.id = m.campaign_id
          WHERE ca.client_id = p.client_id AND ca.currency = p.currency
            AND m.date >= months.month::date AND m.date < months.month::date + interval '1 month'
        ) s
        WHERE p.cancelled_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM invoices i
            WHERE i.client_id = p.client_id AND i.period_month = months.month::date AND i.status <> 'VOID')
        ON CONFLICT (client_id, period_month) WHERE status <> 'VOID' DO NOTHING`;

      const refreshed = await tx.$executeRaw`
        UPDATE invoices i
        SET spend_minor = s.spend,
            variable_fee_minor = monthly_fee_minor(s.spend, 0, i.percent_basis_points, NULL),
            total_minor = monthly_fee_minor(s.spend, i.fixed_fee_minor, i.percent_basis_points, i.minimum_fee_minor)
        FROM (
          SELECT d.id, COALESCE(SUM(m.spend_minor), 0) AS spend
          FROM invoices d
          JOIN campaigns ca ON ca.client_id = d.client_id AND ca.currency = d.currency
          LEFT JOIN campaign_daily_metrics m ON m.campaign_id = ca.id
            AND m.date >= d.period_month AND m.date < d.period_month + interval '1 month'
          WHERE d.status = 'DRAFT'
          GROUP BY d.id
        ) s
        WHERE i.id = s.id AND i.status = 'DRAFT' AND i.spend_minor <> s.spend`;

      if (created > 0 || refreshed > 0) {
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.invoice.drafts_prepared',
            metadata: { created, refreshed },
          }),
        });
      }
      return { created, refreshed };
    });
  }

  async issue(id: string, input: unknown, actor: Actor): Promise<InvoiceView> {
    const parsed = IssueInvoiceSchema.safeParse(input ?? {});
    if (!parsed.success) throw new InvoiceValidationError(parsed.error);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await this.find(tx, id);
        if (current.status !== 'DRAFT') throw new InvoiceStateError('Only a draft can be issued');
        // The number, the issue date and (by default) the due date are set
        // by PostgreSQL in the same statement.
        await tx.invoice.update({
          where: { id: current.id },
          data: {
            status: 'ISSUED',
            ...(parsed.data.dueOn ? { dueOn: new Date(`${parsed.data.dueOn}T00:00:00Z`) } : {}),
          },
        });
        const issued = await this.find(tx, id);
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.invoice.issued',
            metadata: {
              invoiceId: issued.id,
              clientId: issued.clientId,
              number: issued.number,
              month: day(issued.periodMonth).slice(0, 7),
              currency: issued.currency,
              totalMinor: issued.totalMinor.toString(),
              dueOn: issued.dueOn ? day(issued.dueOn) : null,
            },
          }),
        });
        // The client sees the new invoice in its portal.
        await notifyClient(tx, issued.clientId, {
          kind: 'invoice.issued',
          params: {
            number: issued.number,
            total: fromMinor(issued.totalMinor, issued.currency),
            currency: issued.currency,
            dueOn: issued.dueOn ? day(issued.dueOn) : null,
          },
          link: `/invoices/${issued.id}`,
        });
        return toView(issued);
      });
    } catch (error) {
      throw translate(error);
    }
  }

  // Voids a draft (discard) or an issued invoice without live payments.
  async void(id: string, input: unknown, actor: Actor): Promise<InvoiceView> {
    const parsed = VoidSchema.safeParse(input);
    if (!parsed.success) throw new InvoiceValidationError(parsed.error);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await this.find(tx, id);
        if (current.status === 'VOID') throw new InvoiceStateError('This invoice is already void');
        await tx.invoice.update({
          where: { id: current.id },
          // voided_at is set by the database.
          data: { status: 'VOID', voidReason: parsed.data.reason, voidedAt: new Date() },
        });
        const voided = await this.find(tx, id);
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.invoice.voided',
            metadata: {
              invoiceId: voided.id,
              clientId: voided.clientId,
              number: voided.number,
              'before.status': current.status,
              'after.status': 'VOID',
              reason: parsed.data.reason,
            },
          }),
        });
        return toView(voided);
      });
    } catch (error) {
      throw translate(error);
    }
  }

  async recordPayment(invoiceId: string, input: unknown, actor: Actor): Promise<InvoiceDetail> {
    const parsed = RecordPaymentSchema.safeParse(input);
    if (!parsed.success) throw new InvoiceValidationError(parsed.error);
    try {
      await this.prisma.$transaction(async (tx) => {
        const invoice = await this.find(tx, invoiceId);
        if (invoice.status !== 'ISSUED') {
          throw new InvoiceStateError('payments are only recorded on an issued invoice');
        }
        let amountMinor: bigint;
        try {
          amountMinor = toMinor(parsed.data.amount, invoice.currency);
        } catch (error) {
          if (error instanceof MoneyFormatError) {
            throw new InvoiceValidationError({ field: 'amount', message: error.message });
          }
          throw error;
        }
        if (amountMinor <= 0n) {
          throw new InvoiceValidationError({ field: 'amount', message: 'must be more than 0' });
        }
        const payment = await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            amountMinor,
            paidOn: new Date(`${parsed.data.paidOn}T00:00:00Z`),
            method: parsed.data.method,
            reference: parsed.data.reference ?? null,
          },
        });
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.payment.recorded',
            metadata: {
              paymentId: payment.id,
              invoiceId: invoice.id,
              clientId: invoice.clientId,
              number: invoice.number,
              amountMinor: amountMinor.toString(),
              currency: invoice.currency,
              paidOn: parsed.data.paidOn,
              method: parsed.data.method,
            },
          }),
        });
        await notifyClient(tx, invoice.clientId, {
          kind: 'invoice.payment_recorded',
          params: {
            number: invoice.number,
            amount: fromMinor(amountMinor, invoice.currency),
            currency: invoice.currency,
            paidOn: parsed.data.paidOn,
          },
          link: `/invoices/${invoice.id}`,
        });
      });
    } catch (error) {
      throw translate(error);
    }
    return this.get(invoiceId);
  }

  async voidPayment(paymentId: string, input: unknown, actor: Actor): Promise<InvoiceDetail> {
    const parsed = VoidSchema.safeParse(input);
    if (!parsed.success) throw new InvoiceValidationError(parsed.error);
    if (!IdSchema.safeParse(paymentId).success) throw new PaymentNotFoundError();
    let invoiceId = '';
    try {
      await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          include: { invoice: { select: { clientId: true, number: true, currency: true } } },
        });
        if (!payment) throw new PaymentNotFoundError();
        invoiceId = payment.invoiceId;
        await tx.payment.update({
          where: { id: payment.id },
          data: { voidedAt: new Date(), voidReason: parsed.data.reason },
        });
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.payment.voided',
            metadata: {
              paymentId: payment.id,
              invoiceId: payment.invoiceId,
              clientId: payment.invoice.clientId,
              number: payment.invoice.number,
              amountMinor: payment.amountMinor.toString(),
              currency: payment.invoice.currency,
              'before.voidedAt': payment.voidedAt?.toISOString() ?? null,
              reason: parsed.data.reason,
            },
          }),
        });
      });
    } catch (error) {
      throw translate(error);
    }
    return this.get(invoiceId);
  }

  // ---- Client portal (step 6.3): the client id ALWAYS comes from the
  // session. Drafts are never shown; voided payments and every void reason
  // stay inside the agency.

  async listForClient(clientId: string): Promise<ClientInvoice[]> {
    const rows = await this.prisma.invoice.findMany({
      where: { clientId, number: { not: null } },
      include: WITH_DETAILS,
      orderBy: [{ periodMonth: 'desc' }, { issuedAt: 'desc' }],
    });
    return rows.map((row) => toClientView(row));
  }

  async getForClient(clientId: string, id: string): Promise<ClientInvoiceDetail> {
    if (!IdSchema.safeParse(id).success) throw new InvoiceNotFoundError();
    // BOTH ids, and issued (numbered) only: anything else is "not found".
    const row = await this.prisma.invoice.findFirst({
      where: { id, clientId, number: { not: null } },
      include: WITH_DETAILS,
    });
    if (!row) throw new InvoiceNotFoundError();
    return {
      ...toClientView(row),
      payments: row.payments
        .filter((payment) => payment.voidedAt === null)
        .sort((a, b) => a.paidOn.getTime() - b.paidOn.getTime())
        .map((payment) => ({
          amount: fromMinor(payment.amountMinor, row.currency),
          paidOn: day(payment.paidOn),
          method: payment.method,
        })),
    };
  }

  private async find(db: Pick<PrismaService, 'invoice'>, id: string): Promise<InvoiceRow> {
    if (!IdSchema.safeParse(id).success) throw new InvoiceNotFoundError();
    const row = await db.invoice.findUnique({ where: { id }, include: WITH_DETAILS });
    if (!row) throw new InvoiceNotFoundError();
    return row;
  }
}
