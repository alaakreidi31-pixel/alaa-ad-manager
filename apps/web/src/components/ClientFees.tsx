import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/auth-context';
import { ApiError, type FieldError } from '../lib/api-client';
import {
  cancelFeePlan,
  createFeePlan,
  getClientFees,
  listFeePlans,
  monthFromNow,
  type FeePlan,
  type FeePlanInput,
  type FeesReport,
} from '../lib/fees-api';
import { currencyOptions } from '../lib/reference-data';
import { ui } from './ui';

const STATUS_TONES: Record<FeePlan['status'], string> = {
  active: 'border-success/40 bg-success/10 text-success',
  scheduled: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
  ended: 'border-ink-400/40 bg-ink-800 text-ink-400',
  cancelled: 'border-danger/40 bg-danger/10 text-danger',
};

const codeOf = (error: unknown) => (error instanceof ApiError ? error.code : 'server_unreachable');

// The fees of one client, on its page (step 5.2, ADR 0019): its current
// plan, the change form, the history of plans, and the fee of each month.
// Every amount comes from the API as text: the browser computes nothing.
export function ClientFees({
  clientId,
  clientCurrency,
  archived,
}: {
  clientId: string;
  clientCurrency: string;
  archived: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [plans, setPlans] = useState<FeePlan[] | null>(null);
  const [report, setReport] = useState<FeesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [values, setValues] = useState<FeePlanInput>({
    currency: clientCurrency,
    fixedFee: '',
    percent: '',
    minimumFee: '',
    startsOn: monthFromNow(1),
  });

  const language = i18n.resolvedLanguage ?? 'en';
  const currencies = useMemo(() => currencyOptions(language), [language]);
  const monthName = new Intl.DateTimeFormat(language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const showMonth = (month: string) => monthName.format(new Date(`${month}-01T00:00:00Z`));

  const load = useCallback(async () => {
    try {
      const [loadedPlans, loadedReport] = await Promise.all([
        listFeePlans(api, clientId),
        getClientFees(api, clientId, { from: monthFromNow(-5), to: monthFromNow(1) }),
      ]);
      setPlans(loadedPlans);
      setReport(loadedReport);
    } catch (caught) {
      setError(codeOf(caught));
    }
  }, [api, clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = plans?.find((plan) => plan.status === 'active') ?? null;
  const scheduled = plans?.find((plan) => plan.status === 'scheduled') ?? null;
  const hasPlans = (plans ?? []).some((plan) => plan.status !== 'cancelled');

  function openForm() {
    setValues({
      currency: active?.currency ?? clientCurrency,
      fixedFee: '',
      percent: '',
      minimumFee: '',
      // The first plan may start this month; a change starts next month.
      startsOn: hasPlans ? monthFromNow(1) : monthFromNow(0),
    });
    setFieldErrors([]);
    setError(null);
    setEditing(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors([]);
    try {
      await createFeePlan(api, clientId, values);
      setEditing(false);
      await load();
    } catch (caught) {
      setError(codeOf(caught));
      if (caught instanceof ApiError) setFieldErrors(caught.fields);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(plan: FeePlan) {
    if (!window.confirm(t('fees.confirmCancel'))) return;
    setBusy(true);
    setError(null);
    try {
      await cancelFeePlan(api, clientId, plan.id);
      await load();
    } catch (caught) {
      setError(codeOf(caught));
    } finally {
      setBusy(false);
    }
  }

  const hasError = (field: string) => fieldErrors.some((f) => f.field === field);
  // "100.00 USD + 7.50% of the spend · minimum 300.00 USD"
  const terms = (plan: Pick<FeePlan, 'currency' | 'fixedFee' | 'percent' | 'minimumFee'>) => {
    const charged = [
      Number(plan.fixedFee) > 0 && `${plan.fixedFee} ${plan.currency}`,
      Number(plan.percent) > 0 && t('fees.percentOfSpend', { percent: plan.percent }),
    ]
      .filter(Boolean)
      .join(' + ');
    return plan.minimumFee
      ? `${charged} · ${t('fees.minimumOf', { amount: `${plan.minimumFee} ${plan.currency}` })}`
      : charged;
  };

  return (
    <>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <h2 className="me-auto text-xl font-bold text-white">{t('fees.title')}</h2>
        {!archived && !editing && (
          <button type="button" className={ui.primary} onClick={openForm}>
            {hasPlans ? t('fees.change') : t('fees.add')}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className={`${ui.error} mt-4`}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}

      <div className={`${ui.card} mt-4`}>
        {!plans && !error && <p className="text-ink-400">{t('common.loading')}</p>}
        {plans && !active && !scheduled && <p className="text-ink-400">{t('fees.noPlan')}</p>}
        {active && (
          <div>
            <p className="text-xs font-semibold text-ink-400">{t('fees.current')}</p>
            <p dir="auto" className="mt-1 text-lg font-bold text-white">
              {terms(active)}
            </p>
            <p className="mt-1 text-sm text-ink-400">
              {t('fees.since', { month: showMonth(active.startsOn.slice(0, 7)) })}
              {active.endsOn &&
                ` · ${t('fees.until', { month: showMonth(active.endsOn.slice(0, 7)) })}`}
            </p>
          </div>
        )}
        {scheduled && (
          <p className="mt-3 rounded-xl border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-sm text-sky-300">
            {t('fees.scheduled', { month: showMonth(scheduled.startsOn.slice(0, 7)) })}{' '}
            <span dir="auto" className="font-semibold">
              {terms(scheduled)}
            </span>
          </p>
        )}
      </div>

      {editing && (
        <form
          onSubmit={(event) => void submit(event)}
          className={`${ui.card} mt-4 grid gap-5 sm:grid-cols-2`}
          noValidate
        >
          <p className="text-sm text-ink-400 sm:col-span-2">
            {hasPlans ? t('fees.changeHint') : t('fees.firstHint')}
          </p>
          <label className={ui.label}>
            {t('fees.fields.fixedFee')}
            <input
              dir="ltr"
              inputMode="decimal"
              placeholder="0"
              value={values.fixedFee}
              onChange={(event) => setValues({ ...values, fixedFee: event.target.value })}
              className={`${ui.input} ${hasError('fixedFee') ? 'border-danger' : ''}`}
            />
          </label>
          <label className={ui.label}>
            {t('fees.fields.percent')}
            <input
              dir="ltr"
              inputMode="decimal"
              placeholder="0"
              value={values.percent}
              onChange={(event) => setValues({ ...values, percent: event.target.value })}
              className={`${ui.input} ${hasError('percent') ? 'border-danger' : ''}`}
            />
            <span className="mt-1 block text-xs text-ink-400">{t('fees.percentHint')}</span>
          </label>
          <label className={ui.label}>
            {t('fees.fields.minimumFee')}
            <input
              dir="ltr"
              inputMode="decimal"
              placeholder={t('fees.optional')}
              value={values.minimumFee}
              onChange={(event) => setValues({ ...values, minimumFee: event.target.value })}
              className={`${ui.input} ${hasError('minimumFee') ? 'border-danger' : ''}`}
            />
            <span className="mt-1 block text-xs text-ink-400">{t('fees.minimumHint')}</span>
          </label>
          <label className={ui.label}>
            {t('fees.fields.currency')}
            <select
              value={values.currency}
              onChange={(event) => setValues({ ...values, currency: event.target.value })}
              className={ui.input}
            >
              {currencies.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink-400">{t('fees.currencyHint')}</span>
          </label>
          <label className={ui.label}>
            {t('fees.fields.startsOn')}
            <input
              type="month"
              value={values.startsOn}
              min={hasPlans ? monthFromNow(1) : undefined}
              onChange={(event) => setValues({ ...values, startsOn: event.target.value })}
              className={`${ui.input} ${hasError('startsOn') ? 'border-danger' : ''}`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={busy || (!values.fixedFee.trim() && !values.percent.trim())}
              className={ui.primary}
            >
              {busy ? t('auth.wait') : t('fees.save')}
            </button>
            <button type="button" className={ui.secondary} onClick={() => setEditing(false)}>
              {t('fees.cancelForm')}
            </button>
            <span className="text-xs text-ink-400">{t('fees.immutableHint')}</span>
          </div>
        </form>
      )}

      {report && report.warnings.length > 0 && (
        <div role="alert" className={`${ui.error} mt-4 flex flex-col gap-1`}>
          <p className="font-semibold">{t('fees.warningsTitle')}</p>
          {report.warnings.map((warning) => (
            <p key={`${warning.month}-${warning.currency}`}>
              {t('fees.warning', {
                client: warning.clientName,
                month: showMonth(warning.month),
                amount: `${warning.spend} ${warning.currency}`,
              })}
            </p>
          ))}
        </div>
      )}

      {report && (
        <div className={`${ui.card} mt-4 overflow-x-auto p-0`}>
          <h3 className="px-4 pt-4 text-lg font-bold text-white">{t('fees.monthlyTitle')}</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="border-b border-ink-700 text-ink-400">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">{t('fees.month')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('fees.spend')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('fees.fixed')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('fees.variable')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('fees.fee')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('fees.notes')}</th>
              </tr>
            </thead>
            <tbody>
              {report.months
                .slice()
                .reverse()
                .map((row) => (
                  <tr key={row.month} className="border-b border-ink-800 last:border-0">
                    <td className="px-4 py-3 text-white">{showMonth(row.month)}</td>
                    <td dir="ltr" className="px-4 py-3 text-end text-white">
                      {row.spend ?? '—'}
                    </td>
                    <td dir="ltr" className="px-4 py-3 text-end text-white">
                      {row.breakdown?.fixed ?? '—'}
                    </td>
                    <td dir="ltr" className="px-4 py-3 text-end text-white">
                      {row.breakdown?.variable ?? '—'}
                    </td>
                    <td dir="ltr" className="px-4 py-3 text-end font-bold text-gold-300">
                      {row.fee ? `${row.fee} ${row.plan?.currency ?? ''}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-400">
                      {[
                        !row.plan && t('fees.noPlanMonth'),
                        row.breakdown?.minimumApplied && t('fees.minimumApplied'),
                        row.inProgress && t('fees.inProgress'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {plans && plans.length > 0 && (
        <div className={`${ui.card} mt-4 overflow-x-auto p-0`}>
          <h3 className="px-4 pt-4 text-lg font-bold text-white">{t('fees.historyTitle')}</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="border-b border-ink-700 text-ink-400">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">{t('fees.period')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('fees.terms')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('clients.fields.status')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-b border-ink-800 last:border-0">
                  <td className="px-4 py-3 text-white">
                    {showMonth(plan.startsOn.slice(0, 7))} →{' '}
                    {plan.endsOn ? showMonth(plan.endsOn.slice(0, 7)) : t('fees.open')}
                  </td>
                  <td dir="auto" className="px-4 py-3 text-white">
                    {terms(plan)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONES[plan.status]}`}
                    >
                      {t(`fees.status.${plan.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-end">
                    {plan.status === 'scheduled' && !archived && (
                      <button
                        type="button"
                        disabled={busy}
                        className={ui.danger}
                        onClick={() => void cancel(plan)}
                      >
                        {t('fees.cancelPlan')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
