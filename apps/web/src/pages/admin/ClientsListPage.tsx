import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { StatusBadge } from '../../components/StatusBadge';
import { ui } from '../../components/ui';
import { listClients, type ClientPage, type ClientStatus } from '../../lib/admin-api';
import { ApiError } from '../../lib/api-client';

const PAGE_SIZE = 20;

export function ClientsListPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ClientStatus | ''>('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ClientPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    listClients(api, { search, status, page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api, search, status, page]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' });

  return (
    <section className="w-full max-w-6xl self-start">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-white">{t('clients.title')}</h1>
        <Link to="/admin/clients/new" className={`${ui.primary} ms-auto`}>
          {t('clients.add')}
        </Link>
      </div>

      <form onSubmit={submitSearch} className="mt-6 flex flex-wrap gap-3">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t('clients.searchPlaceholder')}
          aria-label={t('clients.searchPlaceholder')}
          className={`${ui.input} mt-0 min-w-56 flex-1`}
        />
        <select
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value as ClientStatus | '');
          }}
          aria-label={t('clients.filterStatus')}
          className={`${ui.input} mt-0 w-auto`}
        >
          <option value="">{t('clients.allStatuses')}</option>
          <option value="ACTIVE">{t('clients.status.ACTIVE')}</option>
          <option value="SUSPENDED">{t('clients.status.SUSPENDED')}</option>
          <option value="ARCHIVED">{t('clients.status.ARCHIVED')}</option>
        </select>
        <button type="submit" className={ui.secondary}>
          {t('clients.search')}
        </button>
      </form>

      {error && (
        <p className={`${ui.error} mt-4`}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}

      <div className={`${ui.card} mt-6 overflow-x-auto p-0`}>
        <table className="w-full text-start text-sm">
          <thead className="border-b border-ink-700 text-ink-400">
            <tr>
              <th className="px-4 py-3 text-start font-semibold">{t('clients.fields.name')}</th>
              <th className="px-4 py-3 text-start font-semibold">
                {t('clients.fields.contactName')}
              </th>
              <th className="px-4 py-3 text-start font-semibold">{t('clients.fields.country')}</th>
              <th className="px-4 py-3 text-start font-semibold">{t('clients.fields.status')}</th>
              <th className="px-4 py-3 text-start font-semibold">
                {t('clients.fields.createdAt')}
              </th>
            </tr>
          </thead>
          <tbody>
            {result?.items.map((client) => (
              <tr
                key={client.id}
                className="border-b border-ink-800 last:border-0 hover:bg-ink-800/60"
              >
                <td className="px-4 py-3">
                  <Link
                    to={`/admin/clients/${client.id}`}
                    className="font-semibold text-gold-300 hover:underline"
                  >
                    {client.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-white">{client.contactName ?? '—'}</td>
                <td className="px-4 py-3 text-white">{client.country ?? '—'}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={client.status} />
                </td>
                <td className="px-4 py-3 text-ink-400">
                  {date.format(new Date(client.createdAt))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && result.items.length === 0 && (
          <p className="px-4 py-8 text-center text-ink-400">{t('clients.empty')}</p>
        )}
        {!result && !error && (
          <p className="px-4 py-8 text-center text-ink-400">{t('common.loading')}</p>
        )}
      </div>

      {result && result.total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink-400">
          <span>{t('clients.total', { total: result.total })}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={ui.secondary}
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t('common.previous')}
            </button>
            <span>{t('common.pageOf', { page, pages })}</span>
            <button
              type="button"
              className={ui.secondary}
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
