import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { OverdueBadge, TaskPriorityBadge, TaskStatusBadge } from '../../components/TaskBadges';
import { TaskFields } from '../../components/TaskFields';
import { ui } from '../../components/ui';
import { ApiError, type FieldError } from '../../lib/api-client';
import {
  addTaskComment,
  getTask,
  isOverdue,
  updateTask,
  type TaskDetail,
  type TaskInput,
  type TaskStatus,
} from '../../lib/tasks-api';

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'];

const toInput = (task: TaskDetail): TaskInput => ({
  title: task.title,
  description: task.description ?? '',
  priority: task.priority,
  dueOn: task.dueOn ?? '',
  clientId: task.clientId ?? '',
  campaignId: task.campaignId ?? '',
  visibleToClient: task.visibleToClient,
});

// /admin/tasks/:id (step 8.3): status, edit, internal comments.
export function TaskDetailPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const { id = '' } = useParams();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [input, setInput] = useState<TaskInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getTask(api, id);
      setTask(data);
      setInput(toInput(data));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(work: () => Promise<unknown>) {
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

  async function save(event: FormEvent) {
    event.preventDefault();
    if (input && (await act(() => updateTask(api, id, input)))) setEditing(false);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (await act(() => addTaskComment(api, id, comment))) setComment('');
  }

  const language = i18n.resolvedLanguage;
  const day = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' });
  const moment = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-5 self-start">
      <Link to="/admin/tasks" className="text-sm text-sky-300 hover:underline">
        {t('common.back')}
      </Link>
      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      {!task && !error && <p className="text-ink-400">{t('common.loading')}</p>}
      {task && input && (
        <>
          <div className={`${ui.card} flex flex-col gap-4`}>
            <div className="flex flex-wrap items-center gap-2">
              <TaskStatusBadge status={task.status} />
              <TaskPriorityBadge priority={task.priority} />
              {isOverdue(task) && <OverdueBadge />}
              <span className="text-xs text-ink-400">{t(`tasks.source.${task.source}`)}</span>
              {task.visibleToClient && (
                <span className="text-xs text-sky-300">{t('tasks.shared')}</span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-white">{task.title}</h1>
            {task.description && (
              <p className="whitespace-pre-wrap text-ink-200">{task.description}</p>
            )}
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-400">{t('tasks.fields.client')}</dt>
                <dd className="text-white">
                  {task.clientId ? (
                    <Link to={`/admin/clients/${task.clientId}`} className="hover:underline">
                      {task.clientName}
                    </Link>
                  ) : (
                    '—'
                  )}
                  {task.campaignName && ` · ${task.campaignName}`}
                </dd>
              </div>
              <div>
                <dt className="text-ink-400">{t('tasks.fields.dueOn')}</dt>
                <dd className="text-white">
                  {task.dueOn ? day.format(new Date(`${task.dueOn}T00:00:00Z`)) : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-400">{t('tasks.createdBy')}</dt>
                <dd className="text-white">
                  {task.createdByName ?? t('tasks.bySystem')} ·{' '}
                  {moment.format(new Date(task.createdAt))}
                </dd>
              </div>
              {task.completedAt && (
                <div>
                  <dt className="text-ink-400">{t('tasks.completedAt')}</dt>
                  <dd className="text-white">{moment.format(new Date(task.completedAt))}</dd>
                </div>
              )}
            </dl>
            <div className="flex flex-wrap gap-2 border-t border-ink-800 pt-4" data-print-hide>
              {STATUSES.filter((status) => status !== task.status).map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={busy}
                  className={
                    status === 'DONE'
                      ? ui.primary
                      : status === 'CANCELLED'
                        ? ui.danger
                        : ui.secondary
                  }
                  onClick={() => void act(() => updateTask(api, id, { status }))}
                >
                  {t(`tasks.setStatus.${status}`)}
                </button>
              ))}
              <button
                type="button"
                className={`${ui.secondary} ms-auto`}
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? t('tasks.closeForm') : t('common.edit')}
              </button>
            </div>
          </div>

          {editing && (
            <form
              onSubmit={(e) => void save(e)}
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
                  {t('common.save')}
                </button>
              </div>
            </form>
          )}

          <section className={`${ui.card} flex flex-col gap-4`}>
            <div>
              <h2 className="text-lg font-bold text-white">{t('tasks.comments')}</h2>
              <p className="text-xs text-ink-400">{t('tasks.commentsHint')}</p>
            </div>
            {task.comments.length === 0 && (
              <p className="text-sm text-ink-400">{t('tasks.noComments')}</p>
            )}
            <ol className="flex flex-col gap-3">
              {task.comments.map((item) => (
                <li key={item.id} className="rounded-xl border border-ink-700 bg-ink-950 p-3">
                  <p className="text-xs text-ink-400">
                    {item.authorName} · {moment.format(new Date(item.createdAt))}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-white">{item.body}</p>
                </li>
              ))}
            </ol>
            <form onSubmit={(e) => void send(e)} className="flex flex-col gap-2">
              <textarea
                className={`${ui.input} min-h-20`}
                value={comment}
                maxLength={5000}
                placeholder={t('tasks.commentPlaceholder')}
                onChange={(e) => setComment(e.target.value)}
              />
              <button
                type="submit"
                className={`${ui.primary} self-end`}
                disabled={busy || comment.trim() === ''}
              >
                {t('tasks.addComment')}
              </button>
            </form>
          </section>
        </>
      )}
    </section>
  );
}
