// Temporary text logo of ALAA MARKETING GROUP (a designed logo can replace it later).
export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 32 32" className="h-9 w-9 shrink-0" aria-hidden="true">
        <path d="M16 2 30 16 16 30 2 16Z" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gold-500" />
        <path d="M16 8 24 16 16 24 8 16Z" className="fill-gold-400" />
      </svg>
      <div className="leading-tight">
        <p className="text-lg font-bold tracking-[0.25em] text-gold-400">ALAA</p>
        <p className="text-[0.65rem] font-semibold tracking-[0.3em] text-white">MARKETING GROUP</p>
      </div>
      <span className="ms-2 hidden rounded-full border border-gold-600/60 px-3 py-1 text-xs font-semibold tracking-widest text-gold-300 sm:inline">
        AD MANAGER
      </span>
    </div>
  );
}
