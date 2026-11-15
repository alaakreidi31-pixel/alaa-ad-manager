import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { PlatformBadge } from '../../components/PlatformBadge';
import { ui } from '../../components/ui';
import { getClient } from '../../lib/admin-api';
import { ApiError, type FieldError } from '../../lib/api-client';
import {
  commitImport,
  previewImport,
  type CampaignPlatform,
  type ImportPreview,
} from '../../lib/campaigns-api';

const MAX_FILE_BYTES = 2_000_000;
const SHOWN_ROWS = 200;

// /admin/clients/:id/campaigns/import: daily numbers from a Meta or Google
// CSV export (step 4.3). 1) choose the file, 2) check the preview,
// 3) confirm: every line is saved, or none.
export function CampaignImportPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const { id: clientId = '' } = useParams();

  const [clientName, setClientName] = useState('');
  const [platform, setPlatform] = useState<CampaignPlatform>('META');
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getClient(api, clientId)
      .then((client) => {
        if (active) setClientName(client.name);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.code : 'server_unreachable');
      });
    return () => {
      active = false;
    };
  }, [api, clientId]);

  function reset() {
    setPreview(null);
    setDone(null);
    setError(null);
    setFileProblem(null);
  }

  async function chooseFile(file: File | undefined) {
    reset();
    setCsv('');
    setFileName(file?.name ?? '');
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileProblem(t('imports.tooBig'));
      return;
    }
    setCsv(await file.text());
  }

  async function run(work: () => Promise<ImportPreview>, after: (result: ImportPreview) => void) {
    setBusy(true);
    setError(null);
    setFileProblem(null);
    try {
      after(await work());
    } catch (caught) {
      if (caught instanceof ApiError) {
        const csvField: FieldError | undefined = caught.fields.find((f) => f.field === 'csv');
        if (csvField) {
          // e.g. "missing_columns: externalId,impressions"
          const [reason = '', columns = ''] = csvField.message.split(': ');
          setFileProblem(
            t(`imports.file.${reason}`, {
              columns: columns
                .split(',')
                .filter(Boolean)
                .map((column) => t(`imports.columns.${column}`))
                .join('، '),
              defaultValue: t('imports.file.unreadable'),
            }),
          );
        } else {
          setError(caught.code);
        }
      } else {
        setError('server_unreachable');
      }
    } finally {
      setBusy(false);
    }
  }

  const input = { platform, csv };
  const canConfirm = preview !== null && preview.errors.length === 0 && preview.rows.length > 0;

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 self-start">
      <div>
        <Link to={`/admin/clients/${clientId}`} className="text-sm text-gold-300 hover:underline">
          ← {clientName || t('common.back')}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white">{t('imports.title')}</h1>
        <p className="mt-1 text-sm text-ink-400">{t('imports.hint')}</p>
      </div>

      {error && (
        <p role="alert" className={ui.error}>
          {t(`apiErrors.${error}`, t('apiErrors.server_unreachable'))}
        </p>
      )}

      <div className={`${ui.card} grid gap-5 sm:grid-cols-[auto_1fr_auto] sm:items-end`}>
        <fieldset>
          <legend className={ui.label}>{t('campaigns.fields.platform')}</legend>
          <div className="mt-2 flex gap-2">
            {(['META', 'GOOGLE'] as const).map((value) => (
              <label
                key={value}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold ${
                  platform === value
                    ? 'border-gold-400 text-gold-300'
                    : 'border-ink-700 text-ink-200'
                }`}
              >
                <input
                  type="radio"
                  name="platform"
                  checked={platform === value}
                  onChange={() => {
                    setPlatform(value);
                    reset();
                  }}
                  className="accent-gold-400"
                />
                <span dir="ltr">{value === 'META' ? 'Meta' : 'Google'}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className={ui.label}>
          {t('imports.file.label')}
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void chooseFile(event.target.files?.[0])}
            className={`${ui.input} file:me-3 file:rounded-lg file:border-0 file:bg-ink-800 file:px-3 file:py-1.5 file:text-sm file:text-white`}
          />
        </label>
        <button
          type="button"
          disabled={busy || !csv}
          className={ui.secondary}
          onClick={() =>
            void run(
              () => previewImport(api, clientId, input),
              (result) => setPreview(result),
            )
          }
        >
          {busy && !preview ? t('auth.wait') : t('imports.check')}
        </button>
      </div>

      {fileProblem && (
        <p role="alert" className={ui.error}>
          {fileName && <span dir="ltr">{fileName}: </span>}
          {fileProblem}
        </p>
      )}

      {done && (
        <div className={`${ui.success} flex flex-wrap items-center gap-3 text-base`}>
          <span className="me-auto">
            {t('imports.done', {
              newDays: done.summary.newDays,
              corrections: done.summary.corrections,
            })}
          </span>
          <Link to={`/admin/clients/${clientId}`} className={ui.secondary}>
            {t('imports.backToClient')}
          </Link>
        </div>
      )}

      {preview && !done && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['newDays', 'text-success'],
                ['corrections', 'text-gold-300'],
                ['campaigns', 'text-sky-300'],
                ['errors', preview.summary.errors > 0 ? 'text-danger' : 'text-ink-400'],
              ] as const
            ).map(([key, tone]) => (
              <div key={key} className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
                <p className="text-xs text-ink-400">{t(`imports.summary.${key}`)}</p>
                <p className={`mt-1 text-2xl font-bold ${tone}`}>{preview.summary[key]}</p>
              </div>
            ))}
          </div>

          {preview.errors.length > 0 && (
            <div className={`${ui.card} border-danger/40`}>
              <h2 className="text-lg font-bold text-danger">{t('imports.errorsTitle')}</h2>
              <p className="mt-1 text-sm text-ink-400">{t('imports.errorsHint')}</p>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {preview.errors.slice(0, SHOWN_ROWS).map((problem) => (
                  <li key={`${problem.line}-${problem.reason}`} className="text-white">
                    <span className="text-ink-400">
                      {t('imports.line', { line: problem.line })}
                    </span>{' '}
                    {t(`imports.problems.${problem.reason}`)}
                    {problem.externalId && (
                      <span dir="ltr" className="ms-2 text-xs text-ink-400">
                        ({problem.externalId})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.rows.length > 0 && (
            <div className={`${ui.card} overflow-x-auto p-0`}>
              <table className="w-full text-sm">
                <thead className="border-b border-ink-700 text-ink-400">
                  <tr>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('imports.lineHeader')}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('campaigns.metrics.date')}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      {t('campaigns.fields.name')}
                    </th>
                    <th className="px-4 py-3 text-end font-semibold">
                      {t('campaigns.metrics.spend')}
                    </th>
                    <th className="px-4 py-3 text-end font-semibold">
                      {t('campaigns.metrics.impressions')}
                    </th>
                    <th className="px-4 py-3 text-end font-semibold">
                      {t('campaigns.metrics.clicks')}
                    </th>
                    <th className="px-4 py-3 text-end font-semibold">
                      {t('campaigns.metrics.conversions')}
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">{t('imports.change')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, SHOWN_ROWS).map((row) => (
                    <tr key={row.line} className="border-b border-ink-800 last:border-0">
                      <td className="px-4 py-2 text-ink-400">{row.line}</td>
                      <td dir="ltr" className="px-4 py-2 text-start text-white">
                        {row.date}
                      </td>
                      <td className="px-4 py-2 text-white">
                        <PlatformBadge platform={preview.platform} /> {row.campaignName}
                      </td>
                      <td dir="ltr" className="px-4 py-2 text-end text-white">
                        {row.spend} <span className="text-xs text-ink-400">{row.currency}</span>
                      </td>
                      <td dir="ltr" className="px-4 py-2 text-end text-white">
                        {row.impressions.toLocaleString('en-US')}
                      </td>
                      <td dir="ltr" className="px-4 py-2 text-end text-white">
                        {row.clicks.toLocaleString('en-US')}
                      </td>
                      <td dir="ltr" className="px-4 py-2 text-end text-white">
                        {row.conversions}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-xs font-semibold ${
                            row.change === 'new' ? 'text-success' : 'text-gold-300'
                          }`}
                        >
                          {t(`imports.changes.${row.change}`)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > SHOWN_ROWS && (
                <p className="px-4 py-3 text-center text-xs text-ink-400">
                  {t('imports.moreRows', { count: preview.rows.length - SHOWN_ROWS })}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || !canConfirm}
              className={ui.primary}
              onClick={() =>
                void run(
                  () => commitImport(api, clientId, input),
                  (result) => setDone(result),
                )
              }
            >
              {busy ? t('auth.wait') : t('imports.confirm', { count: preview.rows.length })}
            </button>
            {!canConfirm && (
              <span className="text-sm text-ink-400">
                {preview.errors.length > 0 ? t('imports.fixFirst') : t('imports.nothing')}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
