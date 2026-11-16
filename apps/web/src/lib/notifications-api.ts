// In-app notifications (phase 9, ADR 0023). The API sends a code ("kind")
// and its values; the sentence is written here, in the user's language.
import type { TFunction } from 'i18next';
import type { Api } from './api-client';

export interface AppNotification {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  total: number;
  unread: number;
  page: number;
  pageSize: number;
}

export const listNotifications = (
  api: Api,
  query: { unread?: boolean; page?: number; pageSize?: number },
) =>
  api<NotificationPage>('/notifications', {
    query: { unread: query.unread ? '1' : undefined, page: query.page, pageSize: query.pageSize },
  });

export const unreadCount = (api: Api) => api<{ unread: number }>('/notifications/unread-count');

export const markRead = (api: Api, id: string) =>
  api<{ unread: number }>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });

export const markAllRead = (api: Api) =>
  api<{ unread: number }>('/notifications/read-all', { method: 'POST' });

const KNOWN = new Set([
  'invoice.issued',
  'invoice.payment_recorded',
  'invoice.draft_ready',
  'invoice.overdue',
  'task.shared',
  'task.status_changed',
  'task.overdue',
  'task.system',
  'campaign.status_changed',
  'campaign.import_done',
  'campaign.stale',
  'security.account_locked',
  'security.new_device',
]);

// The sentence of a notification. Statuses are translated; any other value
// is shown as text (React escapes it).
export function notificationText(t: TFunction, notification: AppNotification): string {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(notification.params)) {
    // Values are texts and numbers; anything else is ignored.
    values[key] =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';
  }
  const status = values['status'];
  if (status) {
    values['status'] = notification.kind.startsWith('task.')
      ? t(`tasks.status.${status}`)
      : t(`campaigns.status.${status}`);
  }
  let key = KNOWN.has(notification.kind) ? notification.kind.replace('.', '_') : 'unknown';
  // The administration's copy of an overdue invoice comes from a system task.
  if (key === 'invoice_overdue' && values['title']) key = 'invoice_overdue_admin';
  return t(`notifications.kinds.${key}`, { ...values, interpolation: { escapeValue: false } });
}

// Only a path inside the application is followed (defense in depth: the
// database already refuses anything else).
export function safeLink(link: string | null): string | null {
  return link && /^\/(?!\/)/.test(link) ? link : null;
}

// "5 minutes ago", in the user's language.
export function timeAgo(iso: string, language: string | undefined, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'second');
}
