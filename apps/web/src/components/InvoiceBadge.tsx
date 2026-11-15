import { useTranslation } from 'react-i18next';
import type { InvoiceLabel } from '../lib/invoices-api';

const TONES: Record<InvoiceLabel, string> = {
  draft: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
  unpaid: 'border-gold-500/50 bg-gold-500/10 text-gold-300',
  partial: 'border-gold-500/50 bg-gold-500/10 text-gold-300',
  overdue: 'border-danger/40 bg-danger/10 text-danger',
  paid: 'border-success/40 bg-success/10 text-success',
  void: 'border-ink-400/40 bg-ink-800 text-ink-400',
};

export function InvoiceBadge({ label }: { label: InvoiceLabel }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONES[label]}`}
    >
      {t(`invoices.labels.${label}`)}
    </span>
  );
}
