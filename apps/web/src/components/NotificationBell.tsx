import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/auth-context';
import {
  listNotifications,
  markAllRead,
  markRead,
  notificationText,
  safeLink,
  timeAgo,
  unreadCount,
  type AppNotification,
} from '../lib/notifications-api';
import { Icon } from './icons';

const POLL_MS = 60_000;

// The bell in the header (phase 9): unread count, latest notifications.
// Opening one marks it as read and goes to its page.
export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    unreadCount(api)
      .then((data) => setUnread(data.unread))
      .catch(() => undefined);
  }, [api]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    listNotifications(api, { pageSize: 8 })
      .then((page) => {
        setItems(page.items);
        setUnread(page.unread);
      })
      .catch(() => setItems([]));
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !box.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [api, open]);

  async function openOne(item: AppNotification) {
    setOpen(false);
    if (!item.readAt) {
      const result = await markRead(api, item.id).catch(() => null);
      if (result) setUnread(result.unread);
    }
    const link = safeLink(item.link);
    if (link) void navigate(link);
  }

  async function readAll() {
    await markAllRead(api).catch(() => null);
    setUnread(0);
    setItems(
      (current) =>
        current?.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) ??
        null,
    );
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={t('notifications.bell', { count: unread })}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-xl border border-ink-700 p-2 text-ink-200 transition hover:text-white focus-visible:outline-2 focus-visible:outline-gold-300"
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span className="absolute -end-1.5 -top-1.5 min-w-5 rounded-full bg-gold-400 px-1 text-center text-[11px] font-bold leading-5 text-on-gold">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
            <p className="font-bold text-white">{t('notifications.title')}</p>
            {unread > 0 && (
              <button
                type="button"
                className="text-xs text-sky-300 hover:underline"
                onClick={() => void readAll()}
              >
                {t('notifications.readAll')}
              </button>
            )}
          </div>
          {!items && (
            <p className="px-4 py-6 text-center text-sm text-ink-400">{t('common.loading')}</p>
          )}
          {items?.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-ink-400">{t('notifications.empty')}</p>
          )}
          <ul className="max-h-96 overflow-y-auto">
            {items?.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void openOne(item)}
                  className={`flex w-full gap-3 border-b border-ink-800 px-4 py-3 text-start transition hover:bg-ink-800/70 ${item.readAt ? '' : 'bg-sky-400/5'}`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? 'bg-transparent' : 'bg-gold-400'}`}
                  />
                  <span className="min-w-0">
                    <span
                      className={`block text-sm ${item.readAt ? 'text-ink-200' : 'font-semibold text-white'}`}
                    >
                      {notificationText(t, item)}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-400">
                      {timeAgo(item.createdAt, i18n.resolvedLanguage)}
                      {!item.readAt && (
                        <span className="sr-only"> · {t('notifications.unread')}</span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block px-4 py-3 text-center text-sm font-semibold text-gold-300 hover:bg-ink-800/70"
          >
            {t('notifications.seeAll')}
          </Link>
        </div>
      )}
    </div>
  );
}
