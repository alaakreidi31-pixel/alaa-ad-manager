import { useTranslation } from 'react-i18next';
import type { TaskPriority, TaskStatus } from '../lib/tasks-api';

const STATUS_TONES: Record<TaskStatus, string> = {
  TODO: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
  IN_PROGRESS: 'border-gold-500/50 bg-gold-500/10 text-gold-300',
  DONE: 'border-success/40 bg-success/10 text-success',
  CANCELLED: 'border-ink-400/40 bg-ink-800 text-ink-400',
};

const PRIORITY_TONES: Record<TaskPriority, string> = {
  HIGH: 'border-danger/40 bg-danger/10 text-danger',
  MEDIUM: 'border-ink-700 bg-ink-800 text-ink-200',
  LOW: 'border-ink-700 text-ink-400',
};

const badge =
  'inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold';

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  return <span className={`${badge} ${STATUS_TONES[status]}`}>{t(`tasks.status.${status}`)}</span>;
}

// Color + word: priority is never shown by color alone.
export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const { t } = useTranslation();
  return (
    <span className={`${badge} ${PRIORITY_TONES[priority]}`}>
      {t(`tasks.priority.${priority}`)}
    </span>
  );
}

export function OverdueBadge() {
  const { t } = useTranslation();
  return (
    <span className={`${badge} border-danger/40 bg-danger/10 text-danger`}>
      {t('tasks.overdue')}
    </span>
  );
}
