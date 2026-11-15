import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { PlatformBadge } from '../../components/PlatformBadge';
import { StatusBadge } from '../../components/StatusBadge';
import { ui } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { listAllCampaigns, type CampaignWithClient, type Page } from '../../lib/campaigns-api';

const PAGE_SIZE = 20;

// /admin/campaigns: every campaign of every client (step 4.4). A campaign is
// added from its client's page, so it always belongs to one client.
export function CampaignsListPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [platform, setPlatform] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<CampaignWithClient> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    listAllCampaigns(api, { search, status, platform, page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api, search, status, platform, page]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' });

  return (
    <section className="mx-auto w-full max-w-6xl self-start">
      <h1 className="text-2xl font-bold text-white">{t('campaigns.title')}</h1>
      <p className="mt-1 text-sm text-ink-400">{t('campaigns.listHint')}</p>

      <form onSubmit={submitSearch} className="mt-6 flex flex-wrap gap-3">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t('campaigns.searchPlaceholder')}
          aria-label={t('campaigns.searchPlaceholder')}
          className={`${ui.input} mt-0 min-w-56 flex-1`}
        />
        <select
          value={platform}
          onChange={(event) => {
            setPage(1);
            setPlatform(event.target.value);
          }}
          aria-label={t('campaigns.fields.platform')}
          className={`${ui.input} mt-0 w-auto`}
        >
          <option value="">{t('campaigns.allPlatforms')}</option>
          <option value="META">Meta</option>
          <option value="GOOGLE">Google</option>
        </select>
        <select
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
          aria-label={t('clients.filterStatus')}
          className={`${ui.input} mt-0 w-auto`}
        >
          <option value="">{t('clients.allStatuses')}</option>
          {(['ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED'] as const).map((value) => (
            <option key={value} value={value}>
              {t(`campaigns.status.${value}`)}
            </option>
          ))}
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
        <table className="w-full text-sm">
          <thead className="border-b border-ink-700 text-ink-400">
            <tr>
              <th className="px-4 py-3 text-start font-semibold">{t('campaigns.fields.name')}</th>
              <th className="px-4 py-3 text-start font-semibold">{t('campaigns.client')}</th>
              <th className="px-4 py-3 text-start font-semibold">
                {t('campaigns.fields.platform')}
              </th>
              <th className="px-4 py-3 text-start font-semibold">{t('clients.fields.status')}</th>
              <th className="px-4 py-3 text-start font-semibold">
                {t('campaigns.fields.dailyBudget')}
              </th>
              <th className="px-4 py-3 text-start font-semibold">
                {t('clients.fields.createdAt')}
              </th>
            </tr>
          </thead>
          <tbody>
            {result?.items.map((campaign) => (
              <tr
                key={campaign.id}
                className="border-b border-ink-800 last:border-0 hover:bg-ink-800/60"
              >
                <td className="px-4 py-3">
                  <Link
                    to={`/admin/clients/${campaign.clientId}/campaigns/${campaign.id}`}
                    className="font-semibold text-gold-300 hover:underline"
                  >
                    {campaign.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link
                    to={`/admin/clients/${campaign.clientId}`}
                    className="text-white hover:text-sky-300"
                  >
                    {campaign.clientName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <PlatformBadge platform={campaign.platform} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={campaign.status} kind="campaigns" />
                </td>
                <td className="px-4 py-3 text-white" dir="ltr">
                  {campaign.dailyBudget ? `${campaign.dailyBudget} ${campaign.currency}` : '—'}
                </td>
                <td className="px-4 py-3 text-ink-400">
                  {date.format(new Date(campaign.createdAt))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && result.items.length === 0 && (
          <p className="px-4 py-8 text-center text-ink-400">{t('campaigns.empty')}</p>
        )}
        {!result && !error && (
          <p className="px-4 py-8 text-center text-ink-400">{t('common.loading')}</p>
        )}
      </div>

      {result && result.total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink-400">
          <span>{t('campaigns.total', { total: result.total })}</span>
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
