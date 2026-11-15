import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyTheme, readSavedTheme, type Theme } from '../lib/theme';

const SUN =
  'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4';
const MOON = 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z';

// Switches between the dark (default) and light themes.
export function ThemeSwitcher() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(readSavedTheme);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      aria-label={t(next === 'light' ? 'theme.toLight' : 'theme.toDark')}
      title={t(next === 'light' ? 'theme.toLight' : 'theme.toDark')}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      className="rounded-full border border-sky-400/45 p-2 text-sky-300 transition hover:border-sky-300 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d={theme === 'dark' ? SUN : MOON} />
      </svg>
    </button>
  );
}
