import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter } from './rate-limiter';

function limiterWithClock(limit = 3, windowMs = 60_000) {
  const clock = { now: 1_000_000 };
  const limiter = new FixedWindowRateLimiter(limit, windowMs, () => clock.now);
  return { limiter, clock };
}

describe('FixedWindowRateLimiter', () => {
  it('allows up to the limit, then refuses', () => {
    const { limiter } = limiterWithClock(3);
    expect([1, 2, 3].map(() => limiter.hit('ip-1').allowed)).toEqual([true, true, true]);
    expect(limiter.hit('ip-1').allowed).toBe(false);
  });

  it('tells how long to wait', () => {
    const { limiter, clock } = limiterWithClock(1, 60_000);
    limiter.hit('ip-1');
    clock.now += 20_000;
    expect(limiter.hit('ip-1')).toEqual({ allowed: false, retryAfterSeconds: 40 });
  });

  it('counts each key separately', () => {
    const { limiter } = limiterWithClock(1);
    expect(limiter.hit('ip-1').allowed).toBe(true);
    expect(limiter.hit('ip-2').allowed).toBe(true);
    expect(limiter.hit('ip-1').allowed).toBe(false);
  });

  it('allows again when the window has passed', () => {
    const { limiter, clock } = limiterWithClock(1, 60_000);
    limiter.hit('ip-1');
    expect(limiter.hit('ip-1').allowed).toBe(false);
    clock.now += 60_000;
    expect(limiter.hit('ip-1').allowed).toBe(true);
  });

  it('removes expired windows so memory does not grow', () => {
    const { limiter, clock } = limiterWithClock(1, 1000);
    for (let i = 0; i < 500; i += 1) limiter.hit(`old-${i}`);
    clock.now += 2000;
    for (let i = 0; i < 600; i += 1) limiter.hit('new');
    expect(limiter.size).toBeLessThan(10);
  });
});
