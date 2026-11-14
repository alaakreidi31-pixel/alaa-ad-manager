// Fixed-window rate limiter kept in memory (ADR 0012).
// Enough for one API server. With several servers, the counters must move
// to a shared store (database or Redis).
export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>();
  private hitsSincePrune = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  hit(key: string): RateLimitResult {
    const now = this.now();
    this.pruneOccasionally(now);

    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;

    const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    return { allowed: window.count <= this.limit, retryAfterSeconds };
  }

  get size(): number {
    return this.windows.size;
  }

  // Removes expired windows so memory does not grow forever.
  private pruneOccasionally(now: number): void {
    this.hitsSincePrune += 1;
    if (this.hitsSincePrune < 1000) return;
    this.hitsSincePrune = 0;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
