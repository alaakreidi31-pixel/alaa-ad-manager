import { useCallback, useEffect, useState } from 'react';
import { fetchHealth, type HealthResult } from '../lib/health';

type Tone = 'ok' | 'bad' | 'unknown';

function StatusRow({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const dot = tone === 'ok' ? 'bg-success' : tone === 'bad' ? 'bg-danger' : 'bg-ink-400';
  const text = tone === 'ok' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-ink-400';
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-ink-800 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
        <span className="text-sm text-white">{label}</span>
      </div>
      <span className={`text-sm font-semibold ${text}`}>{value}</span>
    </div>
  );
}

export function SystemStatus() {
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

  return (
    <section className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-6 shadow-2xl shadow-black/50">
      <p className="text-xs font-semibold tracking-[0.3em] text-gold-500">PHASE 0</p>
      <h1 className="mt-2 text-2xl font-bold text-white">System Status</h1>
      <p className="mt-1 text-sm text-ink-400">Live connection check of the platform services.</p>

      <div className="mt-6 space-y-3">
        <StatusRow
          label="API"
          tone={loading ? 'unknown' : apiTone}
          value={loading ? 'Checking…' : apiTone === 'ok' ? 'Connected' : 'Unreachable'}
        />
        <StatusRow
          label="Database"
          tone={loading ? 'unknown' : dbTone}
          value={loading ? 'Checking…' : dbTone === 'ok' ? 'Up' : dbTone === 'bad' ? 'Down' : 'Unknown'}
        />
      </div>

      {!loading && result?.kind === 'unreachable' && (
        <p className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {result.reason}. Start it with: pnpm dev:api
        </p>
      )}

      <button
        type="button"
        onClick={() => void check()}
        disabled={loading}
        className="mt-6 w-full rounded-xl bg-gold-400 px-4 py-3 text-sm font-bold text-ink-950 transition hover:bg-gold-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300 disabled:opacity-60"
      >
        {loading ? 'Checking…' : 'Check again'}
      </button>
    </section>
  );
}
