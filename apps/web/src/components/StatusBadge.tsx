import { useTranslation } from 'react-i18next';

const ARCHIVED_TONE = 'border-ink-400/40 bg-ink-800 text-ink-400';
const TONES: Record<string, string> = {
  ACTIVE: 'border-success/40 bg-success/10 text-success',
  SUSPENDED: 'border-gold-500/50 bg-gold-500/10 text-gold-300',
  ARCHIVED: ARCHIVED_TONE,
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONES[status] ?? ARCHIVED_TONE}`}
    >
      {t(`clients.status.${status}`)}
    </span>
  );
}
