import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { ui } from '../../components/ui';
import {
  createClient,
  getClient,
  updateClient,
  type AdminClient,
  type ClientInput,
} from '../../lib/admin-api';
import { ApiError, type FieldError } from '../../lib/api-client';
import { countryOptions, currencyOptions, timeZoneOptions } from '../../lib/reference-data';

const EMPTY: ClientInput = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  country: '',
  currency: 'USD',
  timezone: 'UTC',
  website: '',
  businessIndustry: '',
  internalNotes: '',
};

function toInput(client: AdminClient): ClientInput {
  return {
    name: client.name,
    contactName: client.contactName ?? '',
    email: client.email ?? '',
    phone: client.phone ?? '',
    country: client.country ?? '',
    currency: client.currency,
    timezone: client.timezone,
    website: client.website ?? '',
    businessIndustry: client.businessIndustry ?? '',
    internalNotes: client.internalNotes ?? '',
  };
}

// Add (/admin/clients/new) or edit (/admin/clients/:id/edit) a client.
export function ClientFormPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = id !== undefined;

  const [values, setValues] = useState<ClientInput>(EMPTY);
  const [loaded, setLoaded] = useState(!editing);
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);

  const language = i18n.resolvedLanguage ?? 'en';
  const countries = useMemo(() => countryOptions(language), [language]);
  const currencies = useMemo(() => currencyOptions(language), [language]);
  const zones = useMemo(() => timeZoneOptions(), []);

  useEffect(() => {
    if (!id) return;
    let active = true;
    getClient(api, id)
      .then((client) => {
        if (!active) return;
        setValues(toInput(client));
        setArchived(client.status === 'ARCHIVED');
        setLoaded(true);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api, id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors([]);
    try {
      const saved = id ? await updateClient(api, id, values) : await createClient(api, values);
      void navigate(`/admin/clients/${saved.id}`);
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

  const set = (field: keyof ClientInput) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));
  const hasError = (field: string) => fieldErrors.some((f) => f.field === field);
  const disabled = busy || archived;

  function text(
    field: keyof ClientInput,
    options: { type?: string; ltr?: boolean; required?: boolean } = {},
  ) {
    return (
      <label className={ui.label}>
        {t(`clients.fields.${field}`)}
        {options.required && <span className="text-gold-400"> *</span>}
        <input
          type={options.type ?? 'text'}
          dir={options.ltr ? 'ltr' : undefined}
          value={values[field]}
          disabled={disabled}
          aria-invalid={hasError(field)}
          onChange={(event) => set(field)(event.target.value)}
          className={`${ui.input} ${hasError(field) ? 'border-danger' : ''}`}
        />
        {hasError(field) && (
          <span className="mt-1 block text-xs text-danger">{t('clients.invalidField')}</span>
        )}
      </label>
    );
  }

  return (
    <section className="w-full max-w-3xl self-start">
      <Link
        to={id ? `/admin/clients/${id}` : '/admin/clients'}
        className="text-sm text-gold-300 hover:underline"
      >
        {t('common.back')}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-white">
        {editing ? t('clients.editTitle') : t('clients.addTitle')}
      </h1>

      {archived && <p className={`${ui.error} mt-4`}>{t('clients.archivedReadOnly')}</p>}
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
          <div className="sm:col-span-2">{text('name', { required: true })}</div>
          {text('contactName')}
          {text('email', { type: 'email', ltr: true })}
          {text('phone', { type: 'tel', ltr: true })}
          {text('website', { type: 'url', ltr: true })}
          {text('businessIndustry')}

          <label className={ui.label}>
            {t('clients.fields.country')}
            <select
              value={values.country}
              disabled={disabled}
              onChange={(event) => set('country')(event.target.value)}
              className={ui.input}
            >
              <option value="">—</option>
              {countries.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={ui.label}>
            {t('clients.fields.currency')}
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
          </label>

          <label className={ui.label}>
            {t('clients.fields.timezone')}
            <select
              dir="ltr"
              value={values.timezone}
              disabled={disabled}
              onChange={(event) => set('timezone')(event.target.value)}
              className={ui.input}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>

          <label className={`${ui.label} sm:col-span-2`}>
            {t('clients.fields.internalNotes')}
            <span className="ms-2 rounded-full border border-gold-600/60 px-2 py-0.5 text-xs text-gold-300">
              {t('clients.internalOnly')}
            </span>
            <textarea
              rows={4}
              value={values.internalNotes}
              disabled={disabled}
              onChange={(event) => set('internalNotes')(event.target.value)}
              className={ui.input}
            />
          </label>

          <div className="sm:col-span-2">
            <button type="submit" disabled={disabled || !values.name.trim()} className={ui.primary}>
              {busy ? t('auth.wait') : t('common.save')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
