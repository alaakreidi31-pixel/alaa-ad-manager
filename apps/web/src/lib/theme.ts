// Light / dark theme (ADR 0017). Dark is the brand default; the choice is
// remembered in this browser only (a display preference, nothing secret).
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'alaa.theme';

// A saved choice wins; anything else falls back to dark.
export function resolveTheme(saved: string | null): Theme {
  return saved === 'light' ? 'light' : 'dark';
}

export function readSavedTheme(): Theme {
  try {
    return resolveTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'dark'; // storage blocked (private mode on some browsers)
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f4f7fc' : '#070b16');
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The theme still applies for this visit.
  }
}
