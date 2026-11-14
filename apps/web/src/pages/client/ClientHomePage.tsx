import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/auth-context';
import { ui } from '../../components/ui';
import { getMyClientProfile, type ClientProfile } from '../../lib/admin-api';
import { ApiError } from '../../lib/api-client';

// The client portal home: the client's own company (no internal notes:
// the API never sends them to a client account).
export function ClientHomePage() {
  const { t } = useTranslation();
  const { state, api } = useAuth();
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getMyClientProfile(api)
      .then((data) => {
        if (active) setProfile(data);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api]);

  if (state.status !== 'signed_in') return null;

  return (
    <section className="w-full max-w-2xl self-start">
      <h1 className="text-2xl font-bold text-white">
        {t('home.welcome', { name: state.user.fullName })}
      </h1>
      {error && (
        <p className={`${ui.error} mt-4`}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}
      {profile && (
        <div className={`${ui.card} mt-6`}>
          <p className="text-xs font-semibold text-gold-500">{t('clientPortal.company')}</p>
          <h2 className="mt-1 text-xl font-bold text-white">{profile.name}</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {(
              [
                ['contactName', profile.contactName, false],
                ['email', profile.email, true],
                ['phone', profile.phone, true],
                ['website', profile.website, true],
                ['country', profile.country, false],
                ['currency', profile.currency, false],
              ] as const
            ).map(([field, value, ltr]) => (
              <div key={field}>
                <dt className="text-xs font-semibold text-ink-400">
                  {t(`clients.fields.${field}`)}
                </dt>
                <dd className="mt-1 text-white" dir={ltr && value ? 'ltr' : undefined}>
                  {value ?? '—'}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-sm text-ink-400">{t('clientPortal.comingSoon')}</p>
        </div>
      )}
    </section>
  );
}
