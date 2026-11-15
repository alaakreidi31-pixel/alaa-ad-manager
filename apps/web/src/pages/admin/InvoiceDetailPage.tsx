import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { InvoiceBadge } from '../../components/InvoiceBadge';
import { ui } from '../../components/ui';
import { ApiError, type FieldError } from '../../lib/api-client';
import {
  getInvoice,
  invoiceLabel,
  issueInvoice,
  recordPayment,
  voidInvoice,
  voidPayment,
  type InvoiceDetail,
  type PaymentMethod,
} from '../../lib/invoices-api';

const METHODS: PaymentMethod[] = ['BANK_TRANSFER', 'CASH', 'CARD', 'OTHER'];
const today = () => new Date().toISOString().slice(0, 10);

// /admin/invoices/:id (step 6.2): review and issue a draft, record or void
// payments, void an invoice. Every rule is also enforced by PostgreSQL.
export function InvoiceDetailPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const { id = '' } = useParams();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [dueOn, setDueOn] = useState('');
  const [payment, setPayment] = useState({
    amount: '',
    paidOn: today(),
    method: 'BANK_TRANSFER' as PaymentMethod,
    reference: '',
  });

  const load = useCallback(async () => {
    try {
      const loaded = await getInvoice(api, id);
      setInvoice(loaded);
      setPayment((current) => ({
        ...current,
        amount: loaded.status === 'ISSUED' ? loaded.balance : '',
      }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setFieldErrors([]);
    try {
      await work();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      if (caught instanceof ApiError) setFieldErrors(caught.fields);
    } finally {
      setBusy(false);
    }
  }

  // A reason is required to void anything (kept in the history).
  function askReason(question: string): string | null {
    const reason = window.prompt(question)?.trim() ?? '';
    if (reason.length < 3) return null;
    return reason;
  }

  if (!invoice) {
    return (
      <section className="mx-auto w-full max-w-4xl self-start">
        <Link to="/admin/invoices" className="text-sm text-gold-300 hover:underline">
          {t('common.back')}
        </Link>
        <p className="mt-6 text-ink-400">
          {error ? t(`apiErrors.${error}`, t('apiErrors.server_unreachable')) : t('common.loading')}
        </p>
      </section>
    );
  }

  const language = i18n.resolvedLanguage ?? 'en';
  const monthName = new Intl.DateTimeFormat(language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' });
  const showDay = (value: string) => dateFormat.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
  const money = (value: string) => `${value} ${invoice.currency}`;
  const livePayments = invoice.payments.filter((item) => !item.voidedAt);
  const hasError = (field: string) => fieldErrors.some((f) => f.field === field);

  const submitPayment = (event: FormEvent) => {
    event.preventDefault();
    void act(() => recordPayment(api, invoice.id, payment));
  };

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 self-start">
      <div>
        <Link to="/admin/invoices" className="text-sm text-gold-300 hover:underline">
          {t('common.back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 dir="ltr" className="text-2xl font-bold text-white">
            {invoice.number ?? t('invoices.draftNumber')}
          </h1>
          <InvoiceBadge label={invoiceLabel(invoice)} />
          {invoice.status !== 'DRAFT' && (
            <Link to={`/admin/invoices/${invoice.id}/print`} className={`${ui.secondary} ms-auto`}>
              {t('invoices.paper.printLink')}
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-400">
          <Link to={`/admin/clients/${invoice.clientId}`} className="text-sky-300 hover:underline">
            {invoice.clientName}
          </Link>{' '}
          · {monthName.format(new Date(`${invoice.month}-01T00:00:00Z`))}
          {invoice.issuedAt && ` · ${t('invoices.issuedOn', { date: showDay(invoice.issuedAt) })}`}
          {invoice.dueOn && ` · ${t('invoices.dueOnDate', { date: showDay(invoice.dueOn) })}`}
        </p>
      </div>

      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      {invoice.status === 'VOID' && (
        <p className={ui.error}>
          {t('invoices.voidedBecause', { reason: invoice.voidReason ?? '' })}
        </p>
      )}
      {invoice.spendChangedSinceIssue && (
        <p className="rounded-xl border border-gold-500/50 bg-gold-500/10 px-3 py-2 text-sm text-gold-300">
          {t('invoices.spendChanged', {
            current: money(invoice.currentSpend),
            issued: money(invoice.spend),
          })}
        </p>
      )}

      <div className={ui.card}>
        <h2 className="text-lg font-bold text-white">{t('invoices.details')}</h2>
        <dl className="mt-4 flex flex-col divide-y divide-ink-800 text-sm">
          {(
            [
              ['spend', money(invoice.spend)],
              ['fixedFee', money(invoice.fixedFee)],
              ['variableFee', `${money(invoice.variableFee)} (${invoice.percent}%)`],
              ['minimumFee', invoice.minimumFee ? money(invoice.minimumFee) : '—'],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4 py-2">
              <dt className="text-ink-400">{t(`invoices.lines.${key}`)}</dt>
              <dd dir="ltr" className="text-white">
                {value}
              </dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 py-3 text-base">
            <dt className="font-bold text-white">{t('invoices.total')}</dt>
            <dd dir="ltr" className="font-bold text-gold-300">
              {money(invoice.total)}
            </dd>
          </div>
          {invoice.status === 'ISSUED' && (
            <>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-400">{t('invoices.paid')}</dt>
                <dd dir="ltr" className="text-success">
                  {money(invoice.paid)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-400">{t('invoices.balance')}</dt>
                <dd dir="ltr" className="font-semibold text-white">
                  {money(invoice.balance)}
                </dd>
              </div>
            </>
          )}
        </dl>
      </div>

      {invoice.status === 'DRAFT' && (
        <div className={`${ui.card} flex flex-col gap-4`}>
          <h2 className="text-lg font-bold text-white">{t('invoices.issueTitle')}</h2>
          <p className="text-sm text-ink-400">{t('invoices.issueHint')}</p>
          <label className={`${ui.label} max-w-xs`}>
            {t('invoices.dueOn')}
            <input
              type="date"
              min={today()}
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
              className={`${ui.input} ${hasError('dueOn') ? 'border-danger' : ''}`}
            />
            <span className="mt-1 block text-xs text-ink-400">{t('invoices.dueOnHint')}</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              className={ui.primary}
              onClick={() => {
                if (window.confirm(t('invoices.confirmIssue'))) {
                  void act(() => issueInvoice(api, invoice.id, dueOn || undefined));
                }
              }}
            >
              {t('invoices.issue')}
            </button>
            <button
              type="button"
              disabled={busy}
              className={ui.danger}
              onClick={() => {
                const reason = askReason(t('invoices.askDiscardReason'));
                if (reason) void act(() => voidInvoice(api, invoice.id, reason));
              }}
            >
              {t('invoices.discard')}
            </button>
          </div>
        </div>
      )}

      {invoice.status !== 'DRAFT' && (
        <div className={`${ui.card} overflow-x-auto p-0`}>
          <h2 className="px-4 pt-4 text-lg font-bold text-white">{t('invoices.payments')}</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="border-b border-ink-700 text-ink-400">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">{t('invoices.paidOn')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('invoices.amount')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('invoices.method')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('invoices.reference')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {invoice.payments.map((item) => (
                <tr
                  key={item.id}
                  className={`border-b border-ink-800 last:border-0 ${item.voidedAt ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-3 text-white">{showDay(item.paidOn)}</td>
                  <td
                    dir="ltr"
                    className={`px-4 py-3 text-end text-white ${item.voidedAt ? 'line-through' : ''}`}
                  >
                    {money(item.amount)}
                  </td>
                  <td className="px-4 py-3 text-white">{t(`invoices.methods.${item.method}`)}</td>
                  <td className="px-4 py-3 text-ink-400">
                    {item.voidedAt
                      ? t('invoices.paymentVoided', { reason: item.voidReason ?? '' })
                      : (item.reference ?? '—')}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {!item.voidedAt && invoice.status === 'ISSUED' && (
                      <button
                        type="button"
                        disabled={busy}
                        className={ui.danger}
                        onClick={() => {
                          const reason = askReason(t('invoices.askPaymentVoidReason'));
                          if (reason) void act(() => voidPayment(api, item.id, reason));
                        }}
                      >
                        {t('invoices.voidPayment')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {invoice.payments.length === 0 && (
            <p className="px-4 py-6 text-center text-ink-400">{t('invoices.noPayments')}</p>
          )}
        </div>
      )}

      {invoice.status === 'ISSUED' && invoice.paymentState !== 'paid' && (
        <form
          onSubmit={submitPayment}
          className={`${ui.card} grid gap-4 sm:grid-cols-2`}
          noValidate
        >
          <h2 className="text-lg font-bold text-white sm:col-span-2">
            {t('invoices.recordPayment')}
          </h2>
          <label className={ui.label}>
            {t('invoices.amount')}{' '}
            <span dir="ltr" className="text-xs text-ink-400">
              ({invoice.currency})
            </span>
            <input
              dir="ltr"
              inputMode="decimal"
              value={payment.amount}
              onChange={(event) => setPayment({ ...payment, amount: event.target.value })}
              className={`${ui.input} ${hasError('amount') ? 'border-danger' : ''}`}
            />
          </label>
          <label className={ui.label}>
            {t('invoices.paidOn')}
            <input
              type="date"
              max={today()}
              value={payment.paidOn}
              onChange={(event) => setPayment({ ...payment, paidOn: event.target.value })}
              className={`${ui.input} ${hasError('paidOn') ? 'border-danger' : ''}`}
            />
          </label>
          <label className={ui.label}>
            {t('invoices.method')}
            <select
              value={payment.method}
              onChange={(event) =>
                setPayment({ ...payment, method: event.target.value as PaymentMethod })
              }
              className={ui.input}
            >
              {METHODS.map((method) => (
                <option key={method} value={method}>
                  {t(`invoices.methods.${method}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={ui.label}>
            {t('invoices.reference')}
            <input
              value={payment.reference}
              placeholder={t('fees.optional')}
              onChange={(event) => setPayment({ ...payment, reference: event.target.value })}
              className={ui.input}
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy || !payment.amount.trim()} className={ui.primary}>
              {busy ? t('auth.wait') : t('invoices.savePayment')}
            </button>
          </div>
        </form>
      )}

      {invoice.status === 'ISSUED' && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || livePayments.length > 0}
            className={ui.danger}
            onClick={() => {
              const reason = askReason(t('invoices.askVoidReason'));
              if (reason) void act(() => voidInvoice(api, invoice.id, reason));
            }}
          >
            {t('invoices.void')}
          </button>
          <span className="text-xs text-ink-400">
            {livePayments.length > 0 ? t('invoices.voidBlocked') : t('invoices.voidHint')}
          </span>
        </div>
      )}
    </section>
  );
}
