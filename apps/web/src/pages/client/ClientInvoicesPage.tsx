import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { InvoiceBadge } from '../../components/InvoiceBadge';
import { ui } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { invoiceLabel, listMyInvoices, type ClientInvoice } from '../../lib/invoices-api';

// /invoices in the client portal (step 6.3): its own issued invoices.
export function ClientInvoicesPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [items, setItems] = useState<ClientInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listMyInvoices(api)
      .then((data) => {
        if (active) setItems(data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api]);

  const language = i18n.resolvedLanguage ?? 'en';
  const monthName = new Intl.DateTimeFormat(language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' });

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 self-start">
      <h1 className="text-2xl font-bold sm:text-3xl">{t('clientInvoices.title')}</h1>
      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      <div className={`${ui.card} overflow-x-auto p-0`}>
        <table className="w-full text-sm">
          <thead className="border-b border-ink-700 text-ink-400">
            <tr>
              <th className="px-4 py-3 text-start font-semibold">{t('invoices.number')}</th>
              <th className="px-4 py-3 text-start font-semibold">{t('invoices.month')}</th>
              <th className="px-4 py-3 text-end font-semibold">{t('invoices.total')}</th>
              <th className="px-4 py-3 text-end font-semibold">{t('invoices.balance')}</th>
              <th className="px-4 py-3 text-start font-semibold">{t('invoices.dueOn')}</th>
              <th className="px-4 py-3 text-start font-semibold">{t('clients.fields.status')}</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((invoice) => (
              <tr
                key={invoice.id}
                className="border-b border-ink-800 last:border-0 hover:bg-ink-800/60"
              >
                <td className="px-4 py-3">
                  <Link
                    to={`/invoices/${invoice.id}`}
                    dir="ltr"
                    className="font-semibold text-gold-300 hover:underline"
                  >
                    {invoice.number}
                  </Link>
                </td>
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
        {items?.length === 0 && (
          <p className="px-4 py-8 text-center text-ink-400">{t('clientInvoices.empty')}</p>
        )}
        {!items && !error && (
          <p className="px-4 py-8 text-center text-ink-400">{t('common.loading')}</p>
        )}
      </div>
    </section>
  );
}
