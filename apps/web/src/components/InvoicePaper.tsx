import { useTranslation } from 'react-i18next';
import { invoiceLabel, type ClientInvoiceDetail, type PaymentMethod } from '../lib/invoices-api';

// The invoice as a document (step 6.3): black on white in every theme, the
// same on screen, printed, or saved as PDF from the browser ("Print" ->
// "Save as PDF"). Used by the administration and by the client portal.
export function InvoicePaper({ invoice }: { invoice: ClientInvoiceDetail }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? 'en';
  const monthName = new Intl.DateTimeFormat(language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: 'UTC' });
  const showDay = (value: string) => dateFormat.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
  const money = (value: string) => `${value} ${invoice.currency}`;
  const label = invoiceLabel(invoice);
  const method = (value: PaymentMethod) => t(`invoices.methods.${value}`);

  const line = (name: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-6 py-2 ${strong ? 'text-base font-bold' : ''}`}>
      <span className={strong ? '' : 'text-[#52525b]'}>{name}</span>
      <span dir="ltr">{value}</span>
    </div>
  );

  return (
    <article className="mx-auto w-full max-w-3xl rounded-2xl bg-[#ffffff] p-8 text-[#18181b] shadow-2xl print:max-w-none print:rounded-none print:p-0 print:shadow-none sm:p-10">
      <div className="flex flex-wrap items-start gap-6 border-b border-[#e4e4e7] pb-6">
        <div className="me-auto">
          <p className="text-xl font-bold tracking-[0.25em] text-[#a8842f]">ALAA</p>
          <p className="text-xs font-semibold tracking-[0.3em]">MARKETING GROUP</p>
        </div>
        <div className="text-end">
          <p className="text-2xl font-bold">
            {invoice.status === 'VOID' ? t('invoices.paper.voidTitle') : t('invoices.paper.title')}
          </p>
          <p dir="ltr" className="mt-1 font-mono text-sm">
            {invoice.number ?? t('invoices.draftNumber')}
          </p>
        </div>
      </div>

      <dl className="grid gap-4 py-6 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[#71717a]">{t('invoices.paper.billTo')}</dt>
          <dd className="mt-1 text-base font-semibold">{invoice.clientName}</dd>
        </div>
        <div>
          <dt className="text-[#71717a]">{t('invoices.paper.period')}</dt>
          <dd className="mt-1 font-semibold">
            {monthName.format(new Date(`${invoice.month}-01T00:00:00Z`))}
          </dd>
        </div>
        {invoice.issuedAt && (
          <div>
            <dt className="text-[#71717a]">{t('invoices.paper.issuedOn')}</dt>
            <dd className="mt-1 font-semibold">{showDay(invoice.issuedAt)}</dd>
          </div>
        )}
        {invoice.dueOn && (
          <div>
            <dt className="text-[#71717a]">{t('invoices.dueOn')}</dt>
            <dd className="mt-1 font-semibold">{showDay(invoice.dueOn)}</dd>
          </div>
        )}
      </dl>

      <div className="divide-y divide-[#e4e4e7] border-y border-[#e4e4e7] text-sm">
        {line(t('invoices.lines.spend'), money(invoice.spend))}
        {line(t('invoices.lines.fixedFee'), money(invoice.fixedFee))}
        {line(
          `${t('invoices.lines.variableFee')} (${invoice.percent}%)`,
          money(invoice.variableFee),
        )}
        {invoice.minimumFee && line(t('invoices.lines.minimumFee'), money(invoice.minimumFee))}
        {line(t('invoices.paper.totalDue'), money(invoice.total), true)}
      </div>
      <p className="mt-2 text-xs text-[#71717a]">{t('invoices.paper.feeNote')}</p>

      {invoice.status === 'ISSUED' && (
        <div className="mt-6 text-sm">
          {invoice.payments.map((payment) => (
            <div
              key={`${payment.paidOn}-${payment.amount}-${payment.method}`}
              className="flex justify-between gap-6 py-1"
            >
              <span className="text-[#52525b]">
                {t('invoices.paper.paymentOn', {
                  date: showDay(payment.paidOn),
                  method: method(payment.method),
                })}
              </span>
              <span dir="ltr">− {money(payment.amount)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between gap-6 border-t border-[#e4e4e7] pt-3 text-base font-bold">
            <span>{t('invoices.balance')}</span>
            <span dir="ltr">{money(invoice.balance)}</span>
          </div>
          <p
            className={`mt-4 inline-block rounded-full border px-3 py-1 text-xs font-semibold ${
              label === 'paid'
                ? 'border-[#15803d] text-[#15803d]'
                : label === 'overdue'
                  ? 'border-[#b91c1c] text-[#b91c1c]'
                  : 'border-[#a8842f] text-[#8a6a1f]'
            }`}
          >
            {t(`invoices.labels.${label}`)}
          </p>
        </div>
      )}
      {invoice.status === 'VOID' && (
        <p className="mt-6 rounded-lg border border-[#b91c1c] px-3 py-2 text-sm font-semibold text-[#b91c1c]">
          {t('invoices.paper.voidNotice')}
        </p>
      )}

      <p className="mt-10 border-t border-[#e4e4e7] pt-4 text-center text-xs text-[#71717a]">
        ALAA MARKETING GROUP · {t('invoices.paper.thanks')}
      </p>
    </article>
  );
}
