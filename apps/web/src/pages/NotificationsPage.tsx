import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { ui } from '../components/ui';
import { ApiError } from '../lib/api-client';
import {
  listNotifications,
  markAllRead,
  markRead,
  notificationText,
  safeLink,
  timeAgo,
  type AppNotification,
  type NotificationPage,
} from '../lib/notifications-api';

// /notifications (phase 9): every notification of the signed-in account,
// administration and clients alike.
export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<NotificationPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setResult(await listNotifications(api, { unread: onlyUnread, page, pageSize: 20 }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
    }
  }, [api, onlyUnread, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(item: AppNotification) {
    if (!item.readAt) await markRead(api, item.id).catch(() => null);
    const link = safeLink(item.link);
    if (link) void navigate(link);
    else await load();
  }

  const moment = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 self-start">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="me-auto text-2xl font-bold text-white sm:text-3xl">
          {t('notifications.title')}
        </h1>
        {result && result.unread > 0 && (
          <button
            type="button"
            className={ui.secondary}
            onClick={() => void markAllRead(api).then(load)}
          >
            {t('notifications.readAll')}
          </button>
        )}
      </div>
      <div className="flex gap-2">
        {[false, true].map((value) => (
          <button
            key={String(value)}
            type="button"
            onClick={() => {
              setPage(1);
              setOnlyUnread(value);
            }}
            className={`rounded-full border px-3.5 py-1.5 text-sm ${
              onlyUnread === value
                ? 'border-gold-400 font-semibold text-gold-300'
                : 'border-ink-700 text-ink-200'
            }`}
          >
            {value
              ? t('notifications.onlyUnread', { count: result?.unread ?? 0 })
              : t('notifications.all')}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      {!result && !error && <p className="text-ink-400">{t('common.loading')}</p>}
      {result?.items.length === 0 && (
        <p className={`${ui.card} text-center text-ink-400`}>{t('notifications.empty')}</p>
      )}
      <ul className="flex flex-col gap-2">
        {result?.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => void open(item)}
              className={`flex w-full gap-3 rounded-2xl border border-ink-700 p-4 text-start transition hover:border-sky-400 ${
                item.readAt ? 'bg-ink-900' : 'bg-ink-800'
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${item.readAt ? 'bg-ink-700' : 'bg-gold-400'}`}
              />
              <span className="min-w-0">
                <span
                  className={`block ${item.readAt ? 'text-ink-200' : 'font-semibold text-white'}`}
                >
                  {notificationText(t, item)}
                </span>
                <span
                  className="mt-1 block text-xs text-ink-400"
                  title={moment.format(new Date(item.createdAt))}
                >
                  {timeAgo(item.createdAt, i18n.resolvedLanguage)}
                  {!item.readAt && ` · ${t('notifications.unread')}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {result && pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            className={ui.secondary}
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('common.previous')}
          </button>
          <span className="text-sm text-ink-400">{t('common.pageOf', { page, pages })}</span>
          <button
            type="button"
            className={ui.secondary}
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t('common.next')}
          </button>
        </div>
      )}
    </section>
  );
}
