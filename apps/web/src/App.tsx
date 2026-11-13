import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { Logo } from './components/Logo';
import { SystemStatus } from './components/SystemStatus';

// Layout uses logical spacing (ps/pe/ms/me, text-start) instead of left/right,
// so the whole page flips correctly between English (LTR) and Arabic (RTL).
export function App() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-ink-700 bg-ink-900/80">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4 sm:px-6">
          <Logo />
          <div className="ms-auto">
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <SystemStatus />
      </main>

      <footer className="border-t border-ink-700 px-4 py-4 text-center text-xs text-ink-400">
        {t('footer.rights', { year: new Date().getFullYear() })}
      </footer>
    </div>
  );
}
