import { describe, expect, it } from 'vitest';
import { resolveTheme } from './theme';

describe('theme', () => {
  it('uses a saved light theme', () => {
    expect(resolveTheme('light')).toBe('light');
  });

  it('is dark by default, and for any unknown value', () => {
    expect(resolveTheme(null)).toBe('dark');
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('purple')).toBe('dark');
  });
});
