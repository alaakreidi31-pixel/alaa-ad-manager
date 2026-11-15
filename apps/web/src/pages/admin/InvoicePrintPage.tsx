import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { InvoicePaper } from '../../components/InvoicePaper';
import { PrintButton } from '../../components/PrintButton';
import { ui } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { getInvoice, type InvoiceDetail } from '../../lib/invoices-api';

// /admin/invoices/:id/print: the invoice as the client receives it.
export function InvoicePrintPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const { id = '' } = useParams();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getInvoice(api, id)
      .then((data) => {
        if (active) setInvoice(data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api, id]);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 self-start">
      <div data-print-hide className="flex flex-wrap items-center gap-3">
        <Link
          to={`/admin/invoices/${id}`}
          className="me-auto text-sm text-gold-300 hover:underline"
        >
          {t('common.back')}
        </Link>
        {invoice && <PrintButton />}
      </div>
      {error && (
        <p className={ui.error}>{t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}</p>
      )}
      {invoice && (
        <InvoicePaper
          invoice={{
            ...invoice,
            payments: invoice.payments.filter((payment) => !payment.voidedAt),
          }}
        />
      )}
    </section>
  );
}
