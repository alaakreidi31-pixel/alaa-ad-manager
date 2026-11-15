import { useTranslation } from 'react-i18next';

// "From" and "to" day pickers (YYYY-MM-DD, like the API).
export function DateRange({
  value,
  onChange,
}: {
  value: { from: string; to: string };
  onChange: (value: { from: string; to: string }) => void;
}) {
  const { t } = useTranslation();
  const field =
    'mt-1 w-auto rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 text-white focus:border-gold-500 focus:outline-none';
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm text-ink-400">
        {t('campaigns.metrics.from')}
        <input
          type="date"
          value={value.from}
          max={value.to}
          onChange={(event) =>
            event.target.value && onChange({ ...value, from: event.target.value })
          }
          className={`${field} block`}
        />
      </label>
      <label className="text-sm text-ink-400">
        {t('campaigns.metrics.to')}
        <input
          type="date"
          value={value.to}
          min={value.from}
          onChange={(event) => event.target.value && onChange({ ...value, to: event.target.value })}
          className={`${field} block`}
        />
      </label>
    </div>
  );
}
