import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { InvoiceBadge } from '../../components/InvoiceBadge';
import { ui } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import {
  invoiceLabel,
  listInvoices,
  prepareDrafts,
  type InvoicePage,
  type InvoiceStatus,
} from '../../lib/invoices-api';

const PAGE_SIZE = 20;

// /admin/invoices (step 6.2, ADR 0020). Opening the page prepares the
// missing drafts first (idempotent), then lists every invoice.
// ?clientId=... shows the invoices of one client.
export function InvoicesListPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [params] = useSearchParams();
  const clientId = params.get('clientId') ?? undefined;
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [page, setPage] = useState(1);
  const [prepared, setPrepared] = useState<{ created: number; refreshed: number } | null>(null);
  const [result, setResult] = useState<InvoicePage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    prepareDrafts(api)
      .then((data) => {
        if (active) setPrepared(data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!prepared) return;
    let active = true;
    listInvoices(api, { status, clientId, page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api, prepared, status, clientId, page]);

  const language = i18n.resolvedLanguage ?? 'en';
  const monthName = new Intl.DateTimeFormat(language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' });
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <section className="mx-auto w-full max-w-6xl self-start">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="me-auto text-2xl font-bold text-white">{t('invoices.title')}</h1>
        {clientId && (
          <Link to="/admin/invoices" className={ui.secondary}>
            {t('invoices.allClients')}
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-400">{t('invoices.hint')}</p>

      {prepared && prepared.created + prepared.refreshed > 0 && (
        <p className={`${ui.success} mt-4`}>
          {t('invoices.prepared', { created: prepared.created, refreshed: prepared.refreshed })}
        </p>
      )}
      {error && (
        <p role="alert" className={`${ui.error} mt-4`}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {(['', 'DRAFT', 'ISSUED', 'VOID'] as const).map((value) => (
          <button
            key={value || 'all'}
            type="button"
            onClick={() => {
              setPage(1);
              setStatus(value);
            }}
            className={`rounded-full border px-3.5 py-1.5 text-sm ${
              status === value
                ? 'border-gold-400 font-semibold text-gold-300'
                : 'border-ink-700 text-ink-200 hover:text-white'
            }`}
          >
            {t(`invoices.filters.${value || 'ALL'}`)}
          </button>
        ))}
      </div>

      <div className={`${ui.card} mt-4 overflow-x-auto p-0`}>
        <table className="w-full text-sm">
          <thead className="border-b border-ink-700 text-ink-400">
            <tr>
              <th className="px-4 py-3 text-start font-semibold">{t('invoices.number')}</th>
              <th className="px-4 py-3 text-start font-semibold">{t('invoices.client')}</th>
              <th className="px-4 py-3 text-start font-semibold">{t('invoices.month')}</th>
              <th className="px-4 py-3 text-end font-semibold">{t('invoices.total')}</th>
              <th className="px-4 py-3 text-end font-semibold">{t('invoices.balance')}</th>
              <th className="px-4 py-3 text-start font-semibold">{t('invoices.dueOn')}</th>
              <th className="px-4 py-3 text-start font-semibold">{t('clients.fields.status')}</th>
            </tr>
          </thead>
          <tbody>
            {result?.items.map((invoice) => (
              <tr
                key={invoice.id}
                className="border-b border-ink-800 last:border-0 hover:bg-ink-800/60"
              >
                <td className="px-4 py-3">
                  <Link
                    to={`/admin/invoices/${invoice.id}`}
                    dir="ltr"
                    className="font-semibold text-gold-300 hover:underline"
                  >
                    {invoice.number ?? t('invoices.draftNumber')}
                  </Link>
                </td>
                <td className="px-4 py-3 text-white">{invoice.clientName}</td>
                <td className="px-4 py-3 text-white">
                  {monthName.format(new Date(`${invoice.month}-01T00:00:00Z`))}
                </td>
                <td dir="ltr" className="px-4 py-3 text-end text-white">
                  {invoice.total} {invoice.currency}
                </td>
                <td dir="ltr" className="px-4 py-3 text-end text-white">
                  {invoice.status === 'ISSUED' ? `${invoice.balance} ${invoice.currency}` : '—'}
                </td>
                <td className="px-4 py-3 text-ink-400">
                  {invoice.dueOn ? dateFormat.format(new Date(`${invoice.dueOn}T00:00:00Z`)) : '—'}
                </td>
                <td className="px-4 py-3">
                  <InvoiceBadge label={invoiceLabel(invoice)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && result.items.length === 0 && (
          <p className="px-4 py-8 text-center text-ink-400">{t('invoices.empty')}</p>
        )}
        {!result && !error && (
          <p className="px-4 py-8 text-center text-ink-400">{t('common.loading')}</p>
        )}
      </div>

      {result && result.total > result.pageSize && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm text-ink-400">
          <button
            type="button"
            className={ui.secondary}
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('common.previous')}
          </button>
          <span>{t('common.pageOf', { page, pages })}</span>
          <button
            type="button"
            className={ui.secondary}
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t('common.next')}
          </button>
        </div>
      )}
    </section>
  );
}
