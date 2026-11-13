import { Logo } from './components/Logo';
import { SystemStatus } from './components/SystemStatus';

// Layout uses logical spacing (ps/pe/ms/me, text-start) instead of left/right,
// so the whole page flips correctly when Arabic (RTL) is added in step 0.6.
export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-ink-700 bg-ink-900/80">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-4 sm:px-6">
          <Logo />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <SystemStatus />
      </main>

      <footer className="border-t border-ink-700 px-4 py-4 text-center text-xs text-ink-400">
        © {new Date().getFullYear()} ALAA MARKETING GROUP
      </footer>
    </div>
  );
}
