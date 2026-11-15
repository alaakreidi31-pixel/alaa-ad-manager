import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from './icons';

// Shared cards of the administration dashboard and the client portal.
export function StatCard({
  label,
  value,
  note,
  icon,
  tone = 'sky',
}: {
  label: string;
  value: number;
  note: string;
  icon: IconName;
  tone?: 'sky' | 'gold';
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-ink-700 border-t-2 border-t-sky-400/55 bg-ink-900 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-400">{label}</span>
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-xl bg-sky-400/10 ${
            tone === 'gold' ? 'text-gold-400' : 'text-sky-300'
          }`}
        >
          <Icon name={icon} className="h-[18px] w-[18px]" />
        </span>
      </div>
      <span dir="ltr" className="text-end text-3xl font-bold tracking-tight">
        {value.toLocaleString('en-US')}
      </span>
      <span className="text-xs text-ink-400">{note}</span>
    </div>
  );
}

// A card for numbers that do not exist yet: no invented figure (ADR 0017).
export function ComingCard({
  label,
  phase,
  icon,
  note,
}: {
  label: string;
  phase: number;
  icon: IconName;
  // Replaces the 'after phase N' text (a client does not know the phases).
  note?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-dashed border-ink-700 bg-ink-900/60 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-400">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-800 text-ink-400">
          <Icon name={icon} className="h-[18px] w-[18px]" />
        </span>
      </div>
      <span className="text-3xl font-bold text-ink-700" aria-hidden="true">
        —
      </span>
      <span className="text-xs text-ink-400">
        {note ?? t('dashboard.comingInPhase', { phase })}
      </span>
    </div>
  );
}
