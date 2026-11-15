import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { ui } from '../../components/ui';
import { getClient } from '../../lib/admin-api';
import { ApiError, type FieldError } from '../../lib/api-client';
import {
  createCampaign,
  getCampaign,
  updateCampaign,
  type Campaign,
  type CampaignInput,
  type CampaignPlatform,
} from '../../lib/campaigns-api';
import { currencyOptions } from '../../lib/reference-data';

const EMPTY: CampaignInput = {
  name: '',
  externalId: '',
  objective: '',
  currency: 'USD',
  dailyBudget: '',
  startDate: '',
  endDate: '',
};

function toInput(campaign: Campaign): CampaignInput {
  return {
    name: campaign.name,
    externalId: campaign.externalId ?? '',
    objective: campaign.objective ?? '',
    currency: campaign.currency,
    dailyBudget: campaign.dailyBudget ?? '',
    startDate: campaign.startDate ?? '',
    endDate: campaign.endDate ?? '',
  };
}

// Add (/admin/clients/:id/campaigns/new) or edit (.../:campaignId/edit) a campaign.
export function CampaignFormPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const { id: clientId = '', campaignId } = useParams();
  const editing = campaignId !== undefined;

  const [values, setValues] = useState<CampaignInput>(EMPTY);
  const [platform, setPlatform] = useState<CampaignPlatform>('META');
  const [clientName, setClientName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);

  const currencies = useMemo(
    () => currencyOptions(i18n.resolvedLanguage ?? 'en'),
    [i18n.resolvedLanguage],
  );

  useEffect(() => {
    let active = true;
    Promise.all([
      getClient(api, clientId),
      campaignId ? getCampaign(api, clientId, campaignId) : null,
    ])
      .then(([client, campaign]) => {
        if (!active) return;
        setClientName(client.name);
        if (campaign) {
          setValues(toInput(campaign));
          setPlatform(campaign.platform);
          setReadOnly(campaign.status === 'ARCHIVED' || client.status === 'ARCHIVED');
        } else {
          // A new campaign starts in the client's currency.
          setValues({ ...EMPTY, currency: client.currency });
          setReadOnly(client.status === 'ARCHIVED');
        }
        setLoaded(true);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api, clientId, campaignId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors([]);
    try {
      const saved = campaignId
        ? await updateCampaign(api, clientId, campaignId, values)
        : await createCampaign(api, clientId, { ...values, platform });
      void navigate(`/admin/clients/${clientId}/campaigns/${saved.id}`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.code);
        setFieldErrors(caught.fields);
      } else {
        setError('server_unreachable');
      }
    } finally {
      setBusy(false);
    }
  }

  const set = (field: keyof CampaignInput) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));
  const hasError = (field: string) => fieldErrors.some((f) => f.field === field);
  const disabled = busy || readOnly;

  function input(
    field: keyof CampaignInput,
    options: { type?: string; ltr?: boolean; required?: boolean; hint?: string } = {},
  ) {
    return (
      <label className={ui.label}>
        {t(`campaigns.fields.${field}`)}
        {options.required && <span className="text-gold-400"> *</span>}
        <input
          type={options.type ?? 'text'}
          dir={options.ltr ? 'ltr' : undefined}
          inputMode={field === 'dailyBudget' ? 'decimal' : undefined}
          value={values[field]}
          disabled={disabled}
          aria-invalid={hasError(field)}
          onChange={(event) => set(field)(event.target.value)}
          className={`${ui.input} ${hasError(field) ? 'border-danger' : ''}`}
        />
        {hasError(field) ? (
          <span className="mt-1 block text-xs text-danger">
            {t(`campaigns.errors.${field}`, t('clients.invalidField'))}
          </span>
        ) : (
          options.hint && <span className="mt-1 block text-xs text-ink-400">{options.hint}</span>
        )}
      </label>
    );
  }

  const back = campaignId
    ? `/admin/clients/${clientId}/campaigns/${campaignId}`
    : `/admin/clients/${clientId}`;

  return (
    <section className="mx-auto w-full max-w-3xl self-start">
      <Link to={back} className="text-sm text-gold-300 hover:underline">
        {t('common.back')}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-white">
        {editing ? t('campaigns.editTitle') : t('campaigns.addTitle')}
      </h1>
      {clientName && <p className="mt-1 text-sm text-ink-400">{clientName}</p>}

      {readOnly && <p className={`${ui.error} mt-4`}>{t('campaigns.archivedReadOnly')}</p>}
      {error && (
        <p role="alert" className={`${ui.error} mt-4`}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}

      {loaded && (
        <form
          onSubmit={(event) => void submit(event)}
          className={`${ui.card} mt-6 grid gap-5 sm:grid-cols-2`}
          noValidate
        >
          <fieldset className="sm:col-span-2">
            <legend className={ui.label}>{t('campaigns.fields.platform')}</legend>
            <div className="mt-2 flex gap-3">
              {(['META', 'GOOGLE'] as const).map((value) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold ${
                    platform === value
                      ? 'border-gold-400 text-gold-300'
                      : 'border-ink-700 text-ink-200'
                  } ${editing ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <input
                    type="radio"
                    name="platform"
                    value={value}
                    checked={platform === value}
                    disabled={editing || disabled}
                    onChange={() => setPlatform(value)}
                    className="accent-gold-400"
                  />
                  <span dir="ltr">{value === 'META' ? 'Meta' : 'Google'}</span>
                </label>
              ))}
            </div>
            {editing && (
              <span className="mt-1 block text-xs text-ink-400">
                {t('campaigns.platformLocked')}
              </span>
            )}
          </fieldset>

          <div className="sm:col-span-2">{input('name', { required: true })}</div>
          {input('externalId', { ltr: true, hint: t('campaigns.externalIdHint') })}
          {input('objective', { hint: t('campaigns.objectiveHint') })}

          <label className={ui.label}>
            {t('campaigns.fields.currency')}
            <select
              value={values.currency}
              disabled={disabled}
              onChange={(event) => set('currency')(event.target.value)}
              className={ui.input}
            >
              {currencies.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink-400">{t('campaigns.currencyHint')}</span>
          </label>
          {input('dailyBudget', { ltr: true, hint: t('campaigns.dailyBudgetHint') })}
          {input('startDate', { type: 'date', ltr: true })}
          {input('endDate', { type: 'date', ltr: true })}

          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={disabled || values.name.trim().length < 2}
              className={ui.primary}
            >
              {busy ? t('auth.wait') : t('common.save')}
            </button>
            {!readOnly && values.name.trim().length < 2 && (
              <span className="text-sm text-ink-400">{t('campaigns.nameRequiredHint')}</span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
