import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchHealth, type HealthResult } from '../lib/health';

type Tone = 'ok' | 'bad' | 'unknown';

function StatusRow({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const dot = tone === 'ok' ? 'bg-success' : tone === 'bad' ? 'bg-danger' : 'bg-ink-400';
  const text = tone === 'ok' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-ink-400';
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-ink-800 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
        <span className="text-sm text-white">{label}</span>
      </div>
      <span className={`text-sm font-semibold ${text}`}>{value}</span>
    </div>
  );
}

export function SystemStatus() {
  const { t } = useTranslation();
  const [result, setResult] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(true);

  const check = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      setResult(await fetchHealth(signal));
      setLoading(false);
    } catch {
      // Request was cancelled (component unmounted): ignore.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void check(controller.signal);
    return () => controller.abort();
  }, [check]);

  const apiTone: Tone = !result ? 'unknown' : result.kind === 'reachable' ? 'ok' : 'bad';
  const dbTone: Tone =
    result?.kind === 'reachable' ? (result.data.database === 'up' ? 'ok' : 'bad') : 'unknown';

  const apiValue = loading
    ? t('status.checking')
    : apiTone === 'ok'
      ? t('status.connected')
      : t('status.unreachable');
  const dbValue = loading
    ? t('status.checking')
    : dbTone === 'ok'
      ? t('status.up')
      : dbTone === 'bad'
        ? t('status.down')
        : t('status.unknown');

  return (
    <section className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-6 shadow-2xl shadow-black/50">
      {/* Letter-spacing only in LTR: spacing would break the joined letters of Arabic. */}
      <p className="text-xs font-semibold text-gold-500 ltr:tracking-[0.3em]">{t('status.phase')}</p>
      <h1 className="mt-2 text-2xl font-bold text-white">{t('status.title')}</h1>
      <p className="mt-1 text-sm text-ink-400">{t('status.subtitle')}</p>

      <div className="mt-6 space-y-3">
        <StatusRow label={t('status.api')} tone={loading ? 'unknown' : apiTone} value={apiValue} />
        <StatusRow label={t('status.database')} tone={loading ? 'unknown' : dbTone} value={dbValue} />
      </div>

      {!loading && result?.kind === 'unreachable' && (
        <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {result.reason.code === 'not_responding' ? (
            <p>
              {t('status.notResponding')}{' '}
              {/* Commands are always left-to-right, even inside Arabic text */}
              <code dir="ltr" className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-xs text-white">
                pnpm dev:api
              </code>
            </p>
          ) : (
            <p>{t('status.unexpected', { status: result.reason.httpStatus })}</p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => void check()}
        disabled={loading}
        className="mt-6 w-full rounded-xl bg-gold-400 px-4 py-3 text-sm font-bold text-ink-950 transition hover:bg-gold-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300 disabled:opacity-60"
      >
        {loading ? t('status.checking') : t('status.checkAgain')}
      </button>
    </section>
  );
}
