import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { OverdueBadge, TaskPriorityBadge, TaskStatusBadge } from '../../components/TaskBadges';
import { TaskFields } from '../../components/TaskFields';
import { ui } from '../../components/ui';
import { ApiError, type FieldError } from '../../lib/api-client';
import {
  createTask,
  emptyTaskInput,
  isOverdue,
  listTasks,
  updateTask,
  type Task,
  type TaskPage,
  type TaskQuery,
  type TaskStatus,
} from '../../lib/tasks-api';

const OPEN = 'TODO,IN_PROGRESS';
const BOARD: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];

// /admin/tasks (step 8.3, ADR 0022): list with filters, or board by status.
// Opening it also creates the due recurring and system tasks (API side).
export function TasksPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [view, setView] = useState<'list' | 'board'>('list');
  const [query, setQuery] = useState<TaskQuery>({
    status: OPEN,
    priority: '',
    due: '',
    search: '',
    page: 1,
  });
  const [result, setResult] = useState<TaskPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [input, setInput] = useState(emptyTaskInput());
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const effective: TaskQuery =
        view === 'board'
          ? { ...query, status: BOARD.join(','), page: 1, pageSize: 200 }
          : { ...query, pageSize: 50 };
      setResult(await listTasks(api, effective));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
    }
  }, [api, query, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (patch: Partial<TaskQuery>) =>
    setQuery((current) => ({ ...current, page: 1, ...patch }));
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
  const due = (task: Task) =>
    task.dueOn ? dateFormat.format(new Date(`${task.dueOn}T00:00:00Z`)) : '—';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFieldErrors([]);
    try {
      await createTask(api, input);
      setInput(emptyTaskInput());
      setCreating(false);
      await load();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fields);
        setError(caught.fields.length ? null : caught.code);
      } else setError('server_unreachable');
    } finally {
      setBusy(false);
    }
  }

  async function move(task: Task, status: TaskStatus) {
    try {
      await updateTask(api, task.id, { status });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
    }
  }

  const statusChips: { value: string; label: string; count?: number }[] = [
    {
      value: OPEN,
      label: t('tasks.filters.open'),
      count: result ? result.counts.TODO + result.counts.IN_PROGRESS : undefined,
    },
    { value: 'TODO', label: t('tasks.status.TODO'), count: result?.counts.TODO },
    {
      value: 'IN_PROGRESS',
      label: t('tasks.status.IN_PROGRESS'),
      count: result?.counts.IN_PROGRESS,
    },
    { value: 'DONE', label: t('tasks.status.DONE'), count: result?.counts.DONE },
    { value: 'CANCELLED', label: t('tasks.status.CANCELLED'), count: result?.counts.CANCELLED },
    { value: '', label: t('tasks.filters.all') },
  ];
  const select =
    'mt-1 block rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 text-white focus:border-gold-500 focus:outline-none';

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-5 self-start">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="me-auto text-2xl font-bold text-white sm:text-3xl">{t('tasks.title')}</h1>
        <Link to="/admin/tasks/recurring" className={ui.secondary}>
          {t('tasks.recurring.title')}
        </Link>
        <button type="button" className={ui.primary} onClick={() => setCreating((v) => !v)}>
          {creating ? t('tasks.closeForm') : t('tasks.add')}
        </button>
      </div>

      {result && result.counts.overdue > 0 && (
        <button
          type="button"
          onClick={() => set({ due: 'overdue', status: OPEN })}
          className={`${ui.error} text-start`}
        >
          {t('tasks.overdueBanner', { count: result.counts.overdue })}
        </button>
      )}
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
            <span className={ui.label}>{t('tasks.fields.dueOn')}</span>
            <input
              type="date"
              className={ui.input}
              value={input.dueOn}
              onChange={(e) => setInput({ ...input, dueOn: e.target.value })}
            />
          </label>
          <div className="flex items-end justify-end sm:col-span-2">
            <button type="submit" className={ui.primary} disabled={busy}>
              {t('tasks.create')}
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div
          className="flex rounded-full border border-ink-700 p-0.5"
          role="group"
          aria-label={t('tasks.view')}
        >
          {(['list', 'board'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={`rounded-full px-3.5 py-1.5 text-sm ${view === value ? 'bg-ink-800 font-semibold text-gold-300' : 'text-ink-200'}`}
            >
              {t(`tasks.views.${value}`)}
            </button>
          ))}
        </div>
        <label className="text-sm text-ink-400">
          {t('tasks.fields.priority')}
          <select
            className={select}
            value={query.priority}
            onChange={(e) => set({ priority: e.target.value as TaskQuery['priority'] })}
          >
            <option value="">{t('tasks.filters.all')}</option>
            {(['HIGH', 'MEDIUM', 'LOW'] as const).map((priority) => (
              <option key={priority} value={priority}>
                {t(`tasks.priority.${priority}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink-400">
          {t('tasks.fields.dueOn')}
          <select
            className={select}
            value={query.due}
            onChange={(e) => set({ due: e.target.value as TaskQuery['due'] })}
          >
            <option value="">{t('tasks.filters.all')}</option>
            {(['overdue', 'today', 'week', 'none'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`tasks.due.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink-400">
          {t('tasks.filters.source')}
          <select
            className={select}
            value={query.source ?? ''}
            onChange={(e) => set({ source: e.target.value as TaskQuery['source'] })}
          >
            <option value="">{t('tasks.filters.all')}</option>
            {(['MANUAL', 'RECURRING', 'SYSTEM'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`tasks.source.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grow text-sm text-ink-400">
          {t('clients.search')}
          <input
            className={`${select} w-full`}
            value={query.search}
            placeholder={t('tasks.searchPlaceholder')}
            onChange={(e) => set({ search: e.target.value })}
          />
        </label>
      </div>

      {view === 'list' && (
        <div className="flex flex-wrap gap-2">
          {statusChips.map((chip) => (
            <button
              key={chip.value || 'all'}
              type="button"
              onClick={() => set({ status: chip.value })}
              className={`rounded-full border px-3.5 py-1.5 text-sm ${
                query.status === chip.value
                  ? 'border-gold-400 font-semibold text-gold-300'
                  : 'border-ink-700 text-ink-200 hover:text-white'
              }`}
            >
              {chip.label}
              {chip.count !== undefined && (
                <span className="ms-1.5 text-ink-400">{chip.count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {!result && !error && <p className="text-ink-400">{t('common.loading')}</p>}

      {result && view === 'list' && (
        <div className={`${ui.card} overflow-x-auto p-0`}>
          <table className="w-full text-sm">
            <thead className="border-b border-ink-700 text-ink-400">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">{t('tasks.fields.title')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('tasks.fields.client')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('tasks.fields.priority')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('tasks.fields.dueOn')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('clients.fields.status')}</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((task) => (
                <tr
                  key={task.id}
                  className="border-b border-ink-800 last:border-0 hover:bg-ink-800/60"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/tasks/${task.id}`}
                      className="font-semibold text-white hover:text-gold-300 hover:underline"
                    >
                      {task.title}
                    </Link>
                    <span className="mt-0.5 block text-xs text-ink-400">
                      {t(`tasks.source.${task.source}`)}
                      {task.visibleToClient && ` · ${t('tasks.shared')}`}
                      {task.commentsCount > 0 &&
                        ` · ${t('tasks.commentsCount', { count: task.commentsCount })}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white">
                    {task.clientName ?? '—'}
                    {task.campaignName && (
                      <span className="block text-xs text-ink-400">{task.campaignName}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TaskPriorityBadge priority={task.priority} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-white">
                    {due(task)} {isOverdue(task) && <OverdueBadge />}
                  </td>
                  <td className="px-4 py-3">
                    <TaskStatusBadge status={task.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.items.length === 0 && (
            <p className="px-4 py-10 text-center text-ink-400">{t('tasks.empty')}</p>
          )}
          {result.total > result.pageSize && (
            <div className="flex items-center justify-center gap-3 border-t border-ink-800 p-3">
              <button
                type="button"
                className={ui.secondary}
                disabled={result.page <= 1}
                onClick={() => setQuery((q) => ({ ...q, page: (q.page ?? 1) - 1 }))}
              >
                {t('common.previous')}
              </button>
              <span className="text-sm text-ink-400">
                {result.page} / {Math.ceil(result.total / result.pageSize)}
              </span>
              <button
                type="button"
                className={ui.secondary}
                disabled={result.page * result.pageSize >= result.total}
                onClick={() => setQuery((q) => ({ ...q, page: (q.page ?? 1) + 1 }))}
              >
                {t('common.next')}
              </button>
            </div>
          )}
        </div>
      )}

      {result && view === 'board' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {BOARD.map((status, column) => {
            const items = result.items.filter((task) => task.status === status);
            return (
              <section
                key={status}
                className="flex min-w-0 flex-col gap-3 rounded-2xl border border-ink-700 bg-ink-950/40 p-3"
              >
                <h2 className="flex items-center justify-between px-1 text-sm font-bold text-white">
                  {t(`tasks.status.${status}`)}
                  <span className="text-ink-400">{items.length}</span>
                </h2>
                {items.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-ink-400">
                    {t('tasks.emptyColumn')}
                  </p>
                )}
                {items.map((task) => (
                  <article
                    key={task.id}
                    className="flex flex-col gap-2 rounded-xl border border-ink-700 bg-ink-900 p-3"
                  >
                    <Link
                      to={`/admin/tasks/${task.id}`}
                      className="font-semibold text-white hover:text-gold-300"
                    >
                      {task.title}
                    </Link>
                    {task.clientName && (
                      <p className="text-xs text-ink-400">
                        {task.clientName}
                        {task.campaignName && ` · ${task.campaignName}`}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <TaskPriorityBadge priority={task.priority} />
                      {task.dueOn && <span className="text-xs text-ink-400">{due(task)}</span>}
                      {isOverdue(task) && <OverdueBadge />}
                    </div>
                    <div className="flex justify-between gap-2 pt-1" data-print-hide>
                      {column > 0 ? (
                        <button
                          type="button"
                          className="text-xs text-sky-300 hover:underline"
                          onClick={() => void move(task, BOARD[column - 1] ?? 'TODO')}
                        >
                          {t('tasks.moveTo', {
                            status: t(`tasks.status.${BOARD[column - 1] ?? 'TODO'}`),
                          })}
                        </button>
                      ) : (
                        <span />
                      )}
                      {column < BOARD.length - 1 && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-gold-300 hover:underline"
                          onClick={() => void move(task, BOARD[column + 1] ?? 'DONE')}
                        >
                          {t('tasks.moveTo', {
                            status: t(`tasks.status.${BOARD[column + 1] ?? 'DONE'}`),
                          })}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
