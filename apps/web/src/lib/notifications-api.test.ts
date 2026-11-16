import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { notificationText, safeLink, timeAgo, type AppNotification } from './notifications-api';

// A fake t(): returns the key and its values, to check what is asked for.
const t = ((key: string, values?: Record<string, unknown>) => {
  const shown = Object.entries(values ?? {})
    .filter(([name]) => name !== 'interpolation')
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(',');
  return shown ? `${key}(${shown})` : key;
}) as unknown as TFunction;

const note = (kind: string, params: Record<string, unknown> = {}): AppNotification => ({
  id: 'x',
  kind,
  params,
  link: null,
  readAt: null,
  createdAt: '2026-11-16T10:00:00Z',
});

describe('notificationText', () => {
  it('uses the kind as the key and passes the values', () => {
    expect(
      notificationText(t, note('invoice.issued', { number: 'AMG-2026-0001', total: '150.00' })),
    ).toBe('notifications.kinds.invoice_issued(number=AMG-2026-0001,total=150.00)');
  });
  it('translates task and campaign statuses', () => {
    expect(notificationText(t, note('task.status_changed', { title: 'A', status: 'DONE' }))).toBe(
      'notifications.kinds.task_status_changed(title=A,status=tasks.status.DONE)',
    );
    expect(
      notificationText(t, note('campaign.status_changed', { name: 'B', status: 'PAUSED' })),
    ).toBe('notifications.kinds.campaign_status_changed(name=B,status=campaigns.status.PAUSED)');
  });
  it('the administration’s overdue invoice uses the task title', () => {
    expect(notificationText(t, note('invoice.overdue', { title: 'X', client: 'Y' }))).toBe(
      'notifications.kinds.invoice_overdue_admin(title=X,client=Y)',
    );
  });
  it('an unknown kind gets a generic sentence', () => {
    expect(notificationText(t, note('something.new'))).toBe('notifications.kinds.unknown');
  });
});

describe('safeLink', () => {
  it('follows only paths inside the application', () => {
    expect(safeLink('/invoices/1')).toBe('/invoices/1');
    expect(safeLink('//evil.example')).toBeNull();
    expect(safeLink('https://evil.example')).toBeNull();
    expect(safeLink(null)).toBeNull();
  });
});

describe('timeAgo', () => {
  it('minutes, hours, days', () => {
    const now = Date.parse('2026-11-16T12:00:00Z');
    expect(timeAgo('2026-11-16T11:55:00Z', 'en', now)).toBe('5 minutes ago');
    expect(timeAgo('2026-11-16T09:00:00Z', 'en', now)).toBe('3 hours ago');
    expect(timeAgo('2026-11-15T12:00:00Z', 'en', now)).toBe('yesterday');
  });
});
