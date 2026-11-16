import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { TaskPriorityBadge } from '../../components/TaskBadges';
import { TaskFields } from '../../components/TaskFields';
import { ui } from '../../components/ui';
import { ApiError, type FieldError } from '../../lib/api-client';
import {
  createRecurrence,
  emptyTaskInput,
  listRecurrences,
  updateRecurrence,
  type Recurrence,
  type RecurrenceInput,
} from '../../lib/tasks-api';

const today = () => new Date().toISOString().slice(0, 10);
const emptyRule = (): RecurrenceInput => {
  const fields = emptyTaskInput();
  return {
    title: fields.title,
    description: fields.description,
    priority: fields.priority,
    clientId: fields.clientId,
    campaignId: fields.campaignId,
    visibleToClient: fields.visibleToClient,
    frequency: 'MONTHLY',
    day: 1,
    dueAfterDays: 3,
    startsOn: today(),
    endsOn: '',
  };
};

// /admin/tasks/recurring (step 8.3): rules that create a task every week or
// month. Changes apply to the next occurrences; a rule is paused, never deleted.
export function TaskRecurrencesPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [rules, setRules] = useState<Recurrence[] | null>(null);
  const [input, setInput] = useState<RecurrenceInput>(emptyRule());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRules(await listRecurrences(api));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setFieldErrors([]);
    try {
      await work();
      await load();
      return true;
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fields);
        setError(caught.fields.length ? null : caught.code);
      } else setError('server_unreachable');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await run(() => createRecurrence(api, input))) {
      setInput(emptyRule());
      setCreating(false);
    }
  }

  // Monday 2026-11-16 + (day - 1): weekday names in the user's language.
  const weekday = (day: number) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 10, 15 + day)),
    );
  const schedule = (rule: Recurrence) =>
    rule.frequency === 'WEEKLY'
      ? t('tasks.recurring.everyWeek', { day: weekday(rule.day) })
      : t('tasks.recurring.everyMonth', { day: rule.day });
  const fieldError = (field: string) =>
    fieldErrors.some((item) => item.field === field) ? (
      <p className="mt-1 text-xs text-danger">{t(`tasks.errors.${field}`)}</p>
    ) : null;

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5 self-start">
      <Link to="/admin/tasks" className="text-sm text-sky-300 hover:underline">
        {t('common.back')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <div className="me-auto">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">
            {t('tasks.recurring.title')}
          </h1>
          <p className="mt-1 text-sm text-ink-400">{t('tasks.recurring.hint')}</p>
        </div>
        <button type="button" className={ui.primary} onClick={() => setCreating((v) => !v)}>
          {creating ? t('tasks.closeForm') : t('tasks.recurring.add')}
        </button>
      </div>
      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}

      {creating && (
        <form
          onSubmit={(e) => void submit(e)}
          className={`${ui.card} grid grid-cols-1 gap-4 sm:grid-cols-2`}
        >
          <TaskFields value={input} onChange={setInput} errors={fieldErrors} />
          <label className="block">
            <span className={ui.label}>{t('tasks.recurring.frequency')}</span>
            <select
              className={ui.input}
              value={input.frequency}
              onChange={(e) =>
                setInput({
                  ...input,
                  frequency: e.target.value as RecurrenceInput['frequency'],
                  day: 1,
                })
              }
            >
              <option value="WEEKLY">{t('tasks.recurring.WEEKLY')}</option>
              <option value="MONTHLY">{t('tasks.recurring.MONTHLY')}</option>
            </select>
          </label>
          <label className="block">
            <span className={ui.label}>{t('tasks.recurring.day')}</span>
            <select
              className={ui.input}
              value={input.day}
              onChange={(e) => setInput({ ...input, day: Number(e.target.value) })}
            >
              {Array.from(
                { length: input.frequency === 'WEEKLY' ? 7 : 28 },
                (_, index) => index + 1,
              ).map((day) => (
                <option key={day} value={day}>
                  {input.frequency === 'WEEKLY' ? weekday(day) : day}
                </option>
              ))}
            </select>
            {fieldError('day')}
          </label>
          <label className="block">
            <span className={ui.label}>{t('tasks.recurring.dueAfterDays')}</span>
            <input
              type="number"
              min={0}
              max={60}
              className={ui.input}
              value={input.dueAfterDays}
              onChange={(e) => setInput({ ...input, dueAfterDays: Number(e.target.value) })}
            />
          </label>
          <label className="block">
            <span className={ui.label}>{t('tasks.recurring.startsOn')}</span>
            <input
              type="date"
              required
              className={ui.input}
              value={input.startsOn}
              onChange={(e) => setInput({ ...input, startsOn: e.target.value })}
            />
          </label>
          <label className="block">
            <span className={ui.label}>{t('tasks.recurring.endsOn')}</span>
            <input
              type="date"
              className={ui.input}
              value={input.endsOn}
              min={input.startsOn}
              onChange={(e) => setInput({ ...input, endsOn: e.target.value })}
            />
            {fieldError('endsOn')}
          </label>
          <div className="flex items-end justify-end sm:col-span-2">
            <button type="submit" className={ui.primary} disabled={busy}>
              {t('tasks.recurring.create')}
            </button>
          </div>
        </form>
      )}

      {!rules && !error && <p className="text-ink-400">{t('common.loading')}</p>}
      {rules?.length === 0 && (
        <p className={`${ui.card} text-center text-ink-400`}>{t('tasks.recurring.empty')}</p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {rules?.map((rule) => (
          <article
            key={rule.id}
            className={`${ui.card} flex flex-col gap-2 ${rule.paused ? 'opacity-70' : ''}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <TaskPriorityBadge priority={rule.priority} />
              {rule.paused && (
                <span className="text-xs font-semibold text-gold-300">
                  {t('tasks.recurring.paused')}
                </span>
              )}
              {rule.visibleToClient && (
                <span className="text-xs text-sky-300">{t('tasks.shared')}</span>
              )}
            </div>
            <h2 className="text-lg font-bold text-white">{rule.title}</h2>
            <p className="text-sm text-ink-200">
              {schedule(rule)} · {t('tasks.recurring.dueAfter', { count: rule.dueAfterDays })}
            </p>
            <p className="text-xs text-ink-400">
              {rule.clientName ?? t('tasks.noClient')}
              {rule.campaignName && ` · ${rule.campaignName}`} ·{' '}
              {t('tasks.recurring.from', { date: rule.startsOn })}
              {rule.endsOn && ` ${t('tasks.recurring.until', { date: rule.endsOn })}`}
            </p>
            <button
              type="button"
              disabled={busy}
              className={`${ui.secondary} mt-2 self-start`}
              onClick={() =>
                void run(() => updateRecurrence(api, rule.id, { paused: !rule.paused }))
              }
            >
              {rule.paused ? t('tasks.recurring.resume') : t('tasks.recurring.pause')}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
