// Task routes of the API (phase 8, ADR 0022).
import type { Api } from './api-client';

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TaskSource = 'MANUAL' | 'RECURRING' | 'SYSTEM';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueOn: string | null;
  clientId: string | null;
  clientName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  visibleToClient: boolean;
  source: TaskSource;
  systemKind: string | null;
  recurrenceId: string | null;
  occurrenceOn: string | null;
  completedAt: string | null;
  createdByName: string | null;
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetail extends Task {
  comments: { id: string; body: string; authorName: string; createdAt: string }[];
}

export interface TaskPage {
  items: Task[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<TaskStatus, number> & { overdue: number };
}

export interface TaskQuery {
  status?: string; // comma list
  priority?: TaskPriority | '';
  source?: TaskSource | '';
  clientId?: string;
  due?: 'overdue' | 'today' | 'week' | 'none' | '';
  search?: string;
  page?: number;
  pageSize?: number;
}

// Form values ("" clears an optional field on the server).
export interface TaskInput {
  title: string;
  description: string;
  priority: TaskPriority;
  dueOn: string;
  clientId: string;
  campaignId: string;
  visibleToClient: boolean;
}

export interface Recurrence {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  clientId: string | null;
  clientName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  visibleToClient: boolean;
  frequency: 'WEEKLY' | 'MONTHLY';
  day: number;
  dueAfterDays: number;
  startsOn: string;
  endsOn: string | null;
  paused: boolean;
  createdAt: string;
}

export interface RecurrenceInput extends Omit<TaskInput, 'dueOn'> {
  frequency: 'WEEKLY' | 'MONTHLY';
  day: number;
  dueAfterDays: number;
  startsOn: string;
  endsOn: string;
}

export interface ClientTask {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueOn: string | null;
  campaignName: string | null;
  completedAt: string | null;
  updatedAt: string;
}

const clean = (query: TaskQuery) =>
  Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== '' && value !== undefined),
  ) as Record<string, string | number>;

export const listTasks = (api: Api, query: TaskQuery) =>
  api<TaskPage>('/admin/tasks', { query: clean(query) });

export const getTask = (api: Api, id: string) =>
  api<TaskDetail>(`/admin/tasks/${encodeURIComponent(id)}`);

export const createTask = (api: Api, input: TaskInput) =>
  api<Task>('/admin/tasks', { method: 'POST', body: input });

export const updateTask = (
  api: Api,
  id: string,
  input: Partial<TaskInput> & { status?: TaskStatus },
) => api<Task>(`/admin/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });

export const addTaskComment = (api: Api, id: string, body: string) =>
  api<TaskDetail>(`/admin/tasks/${encodeURIComponent(id)}/comments`, {
    method: 'POST',
    body: { body },
  });

export const listRecurrences = (api: Api) => api<Recurrence[]>('/admin/task-recurrences');

export const createRecurrence = (api: Api, input: RecurrenceInput) =>
  api<Recurrence>('/admin/task-recurrences', { method: 'POST', body: input });

export const updateRecurrence = (
  api: Api,
  id: string,
  input: Partial<Omit<RecurrenceInput, 'startsOn'>> & { paused?: boolean },
) =>
  api<Recurrence>(`/admin/task-recurrences/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });

export const listMyTasks = (api: Api) => api<ClientTask[]>('/client/tasks');

// Open and due before today (UTC, like the API).
export function isOverdue(task: { status: TaskStatus; dueOn: string | null }, today = new Date()) {
  return (
    (task.status === 'TODO' || task.status === 'IN_PROGRESS') &&
    task.dueOn !== null &&
    task.dueOn < today.toISOString().slice(0, 10)
  );
}

export const emptyTaskInput = (): TaskInput => ({
  title: '',
  description: '',
  priority: 'MEDIUM',
  dueOn: '',
  clientId: '',
  campaignId: '',
  visibleToClient: false,
});
