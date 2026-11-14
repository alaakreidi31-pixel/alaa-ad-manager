// Shared Tailwind classes, so every page looks the same (brand: ink + gold).
export const ui = {
  card: 'rounded-2xl border border-ink-700 bg-ink-900 p-6 shadow-2xl shadow-black/40',
  label: 'block text-sm font-semibold text-white',
  input:
    'mt-1.5 w-full rounded-xl border border-ink-700 bg-ink-950 px-4 py-2.5 text-white placeholder:text-ink-400 focus:border-gold-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-300/40 disabled:opacity-60',
  primary:
    'rounded-xl bg-gold-400 px-4 py-2.5 text-sm font-bold text-ink-950 transition hover:bg-gold-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300 disabled:opacity-60',
  secondary:
    'rounded-xl border border-ink-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:border-gold-500 hover:text-gold-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300 disabled:opacity-60',
  danger:
    'rounded-xl border border-danger/50 px-4 py-2.5 text-sm font-semibold text-danger transition hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-60',
  error: 'rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger',
  success: 'rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success',
} as const;
