import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/auth-context';
import { OverdueBadge, TaskPriorityBadge, TaskStatusBadge } from '../../components/TaskBadges';
import { ui } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { isOverdue, listMyTasks, type ClientTask } from '../../lib/tasks-api';

// /tasks in the client portal (step 8.3): the tasks the agency shares with
// this client, read only. Internal comments are never sent by the API.
export function ClientTasksPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [items, setItems] = useState<ClientTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listMyTasks(api)
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

  const day = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-5 self-start">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{t('tasks.clientTitle')}</h1>
        <p className="mt-1 text-sm text-ink-400">{t('tasks.clientHint')}</p>
      </div>
      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      {!items && !error && <p className="text-ink-400">{t('common.loading')}</p>}
      {items?.length === 0 && (
        <p className={`${ui.card} text-center text-ink-400`}>{t('tasks.clientEmpty')}</p>
      )}
      <ul className="flex flex-col gap-3">
        {items?.map((task) => (
          <li key={task.id} className={`${ui.card} flex flex-col gap-2 !p-4`}>
            <div className="flex flex-wrap items-center gap-2">
              <TaskStatusBadge status={task.status} />
              <TaskPriorityBadge priority={task.priority} />
              {isOverdue(task) && <OverdueBadge />}
            </div>
            <h2 className="text-lg font-bold text-white">{task.title}</h2>
            {task.description && (
              <p className="whitespace-pre-wrap text-sm text-ink-200">{task.description}</p>
            )}
            <p className="text-xs text-ink-400">
              {task.campaignName && `${task.campaignName} · `}
              {task.dueOn
                ? t('tasks.dueOnDate', { date: day.format(new Date(`${task.dueOn}T00:00:00Z`)) })
                : t('tasks.due.none')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
