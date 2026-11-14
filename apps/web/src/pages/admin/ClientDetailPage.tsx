import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { StatusBadge } from '../../components/StatusBadge';
import { TemporaryPasswordDialog } from '../../components/TemporaryPasswordDialog';
import { ui } from '../../components/ui';
import {
  changeClientStatus,
  changeClientUserStatus,
  createClientUser,
  getClient,
  listClientUsers,
  resetClientUserPassword,
  type AdminClient,
  type ClientUser,
} from '../../lib/admin-api';
import { ApiError } from '../../lib/api-client';

function codeOf(error: unknown): string {
  return error instanceof ApiError ? error.code : 'server_unreachable';
}

function Detail({ label, value, ltr }: { label: string; value: string | null; ltr?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-ink-400">{label}</dt>
      <dd className="mt-1 text-white" dir={ltr && value ? 'ltr' : undefined}>
        {value ?? '—'}
      </dd>
    </div>
  );
}

export function ClientDetailPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const { id = '' } = useParams();

  const [client, setClient] = useState<AdminClient | null>(null);
  const [users, setUsers] = useState<ClientUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  // The temporary password lives ONLY here, until the dialog is closed.
  const [shownPassword, setShownPassword] = useState<{ email: string; password: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const [loadedClient, loadedUsers] = await Promise.all([
        getClient(api, id),
        listClientUsers(api, id),
      ]);
      setClient(loadedClient);
      setUsers(loadedUsers);
    } catch (caught) {
      setError(codeOf(caught));
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Runs an action after an optional confirmation, then reloads the page data.
  async function act(work: () => Promise<unknown>, confirmKey?: string) {
    if (confirmKey && !window.confirm(t(confirmKey))) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
    } catch (caught) {
      setError(codeOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function addUser(event: FormEvent) {
    event.preventDefault();
    await act(async () => {
      const created = await createClientUser(api, id, { email: newEmail, fullName: newName });
      setShownPassword({ email: created.user.email, password: created.temporaryPassword });
      setNewEmail('');
      setNewName('');
    });
  }

  if (!client) {
    return (
      <section className="w-full max-w-4xl self-start">
        <Link to="/admin/clients" className="text-sm text-gold-300 hover:underline">
          {t('common.back')}
        </Link>
        <p className="mt-6 text-ink-400">
          {error ? t(`apiErrors.${error}`, t('apiErrors.server_unreachable')) : t('common.loading')}
        </p>
      </section>
    );
  }

  const archived = client.status === 'ARCHIVED';
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' });

  return (
    <section className="w-full max-w-4xl self-start">
      <Link to="/admin/clients" className="text-sm text-gold-300 hover:underline">
        {t('common.back')}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-white">{client.name}</h1>
        <StatusBadge status={client.status} />
        <div className="ms-auto flex flex-wrap gap-2">
          {!archived && (
            <Link to={`/admin/clients/${client.id}/edit`} className={ui.secondary}>
              {t('common.edit')}
            </Link>
          )}
          {client.status === 'ACTIVE' && (
            <button
              type="button"
              disabled={busy}
              className={ui.secondary}
              onClick={() =>
                void act(() => changeClientStatus(api, id, 'suspend'), 'clients.confirmSuspend')
              }
            >
              {t('clients.suspend')}
            </button>
          )}
          {client.status !== 'ACTIVE' && (
            <button
              type="button"
              disabled={busy}
              className={ui.secondary}
              onClick={() =>
                void act(() => changeClientStatus(api, id, 'activate'), 'clients.confirmActivate')
              }
            >
              {t('clients.activate')}
            </button>
          )}
          {!archived && (
            <button
              type="button"
              disabled={busy}
              className={ui.danger}
              onClick={() =>
                void act(() => changeClientStatus(api, id, 'archive'), 'clients.confirmArchive')
              }
            >
              {t('clients.archive')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className={`${ui.error} mt-4`}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      {client.status !== 'ACTIVE' && (
        <p className={`${ui.error} mt-4`}>{t(`clients.inactiveNotice.${client.status}`)}</p>
      )}

      <dl className={`${ui.card} mt-6 grid gap-5 sm:grid-cols-2`}>
        <Detail label={t('clients.fields.contactName')} value={client.contactName} />
        <Detail label={t('clients.fields.email')} value={client.email} ltr />
        <Detail label={t('clients.fields.phone')} value={client.phone} ltr />
        <Detail label={t('clients.fields.website')} value={client.website} ltr />
        <Detail label={t('clients.fields.businessIndustry')} value={client.businessIndustry} />
        <Detail label={t('clients.fields.country')} value={client.country} />
        <Detail label={t('clients.fields.currency')} value={client.currency} />
        <Detail label={t('clients.fields.timezone')} value={client.timezone} ltr />
        <Detail
          label={t('clients.fields.createdAt')}
          value={date.format(new Date(client.createdAt))}
        />
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold text-ink-400">
            {t('clients.fields.internalNotes')}{' '}
            <span className="text-gold-300">({t('clients.internalOnly')})</span>
          </dt>
          <dd className="mt-1 whitespace-pre-wrap text-white">{client.internalNotes ?? '—'}</dd>
        </div>
      </dl>

      <h2 className="mt-10 text-xl font-bold text-white">{t('clientUsers.title')}</h2>
      <p className="mt-1 text-sm text-ink-400">{t('clientUsers.subtitle')}</p>

      <div className={`${ui.card} mt-4 overflow-x-auto p-0`}>
        <table className="w-full text-sm">
          <thead className="border-b border-ink-700 text-ink-400">
            <tr>
              <th className="px-4 py-3 text-start font-semibold">{t('clientUsers.fullName')}</th>
              <th className="px-4 py-3 text-start font-semibold">{t('clientUsers.email')}</th>
              <th className="px-4 py-3 text-start font-semibold">{t('clients.fields.status')}</th>
              <th className="px-4 py-3 text-start font-semibold">{t('clientUsers.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-ink-800 last:border-0">
                <td className="px-4 py-3 text-white">{user.fullName}</td>
                <td className="px-4 py-3 text-white" dir="ltr">
                  {user.email}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={user.status} />
                  {user.mustChangePassword && (
                    <span className="ms-2 text-xs text-gold-300">
                      {t('clientUsers.mustChangePassword')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {!archived && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        className={ui.secondary}
                        onClick={() =>
                          void act(async () => {
                            const reset = await resetClientUserPassword(api, id, user.id);
                            setShownPassword({
                              email: user.email,
                              password: reset.temporaryPassword,
                            });
                          }, 'clientUsers.confirmReset')
                        }
                      >
                        {t('clientUsers.resetPassword')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={user.status === 'ACTIVE' ? ui.danger : ui.secondary}
                        onClick={() =>
                          void act(
                            () =>
                              changeClientUserStatus(
                                api,
                                id,
                                user.id,
                                user.status === 'ACTIVE' ? 'suspend' : 'activate',
                              ),
                            user.status === 'ACTIVE' ? 'clientUsers.confirmSuspend' : undefined,
                          )
                        }
                      >
                        {user.status === 'ACTIVE' ? t('clients.suspend') : t('clients.activate')}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <p className="px-4 py-6 text-center text-ink-400">{t('clientUsers.empty')}</p>
        )}
      </div>

      {!archived && (
        <form
          onSubmit={(event) => void addUser(event)}
          className={`${ui.card} mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end`}
          noValidate
        >
          <label className={ui.label}>
            {t('clientUsers.fullName')}
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              className={ui.input}
            />
          </label>
          <label className={ui.label}>
            {t('clientUsers.email')}
            <input
              type="email"
              dir="ltr"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              className={ui.input}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !newEmail.trim() || newName.trim().length < 2}
            className={ui.primary}
          >
            {t('clientUsers.add')}
          </button>
        </form>
      )}

      {shownPassword && (
        <TemporaryPasswordDialog
          email={shownPassword.email}
          password={shownPassword.password}
          onClose={() => setShownPassword(null)}
        />
      )}
    </section>
  );
}
