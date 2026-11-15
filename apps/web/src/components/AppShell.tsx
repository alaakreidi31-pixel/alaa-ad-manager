import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { Icon, type IconName } from './icons';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';
import { Logo } from './Logo';

interface NavItem {
  key: string;
  icon: IconName;
  // No "to": the page is not built yet (shown as "soon", not clickable).
  to?: string;
  end?: boolean;
}

// The administration menu (approved design). Pages are added as phases ship.
const ADMIN_NAV: NavItem[] = [
  { key: 'home', icon: 'home', to: '/', end: true },
  { key: 'clients', icon: 'clients', to: '/admin/clients' },
  { key: 'campaigns', icon: 'campaigns', to: '/admin/campaigns' },
  { key: 'invoices', icon: 'invoices' },
  { key: 'payments', icon: 'payments' },
  { key: 'reports', icon: 'reports' },
  { key: 'tasks', icon: 'tasks' },
  { key: 'settings', icon: 'settings' },
];

// The client portal menu: a client sees only its own company's pages.
const CLIENT_NAV: NavItem[] = [
  { key: 'overview', icon: 'home', to: '/', end: true },
  { key: 'campaigns', icon: 'campaigns' },
  { key: 'reports', icon: 'reports' },
  { key: 'invoices', icon: 'invoices' },
];

function SignOutButton({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      aria-label={compact ? t('auth.signOut') : undefined}
      onClick={() => {
        setBusy(true);
        void signOut().finally(() => setBusy(false));
      }}
      className="inline-flex items-center gap-2 rounded-xl border border-ink-700 px-3 py-2 text-sm font-semibold text-ink-200 transition hover:border-danger hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300 disabled:opacity-60"
    >
      <Icon name="logout" className="h-4 w-4 rtl:-scale-x-100" />
      {!compact && t('auth.signOut')}
    </button>
  );
}

function SideNav({ items }: { items: NavItem[] }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('nav.label')} className="flex flex-col gap-1">
      {items.map((item) =>
        item.to ? (
          <NavLink
            key={item.key}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[0.95rem] transition focus-visible:outline-2 focus-visible:outline-gold-300 ${
                isActive
                  ? 'bg-ink-800 font-semibold text-gold-300 shadow-[inset_-3px_0_0_var(--color-gold-400)] ltr:shadow-[inset_3px_0_0_var(--color-gold-400)]'
                  : 'text-ink-200 hover:bg-ink-800/60 hover:text-white'
              }`
            }
          >
            <Icon name={item.icon} />
            {t(`nav.${item.key}`)}
          </NavLink>
        ) : (
          <span
            key={item.key}
            aria-disabled="true"
            className="flex cursor-default items-center gap-3 rounded-xl px-3.5 py-2.5 text-[0.95rem] text-ink-400/80"
          >
            <Icon name={item.icon} />
            {t(`nav.${item.key}`)}
            <span className="ms-auto rounded-full border border-ink-700 px-2 py-0.5 text-[0.7rem] text-ink-400">
              {t('nav.soon')}
            </span>
          </span>
        ),
      )}
    </nav>
  );
}

// Administration layout: menu on the side (right in Arabic, left in English);
// on a phone it opens from a menu button.
function AdminShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { state } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the phone menu after moving to another page.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (state.status !== 'signed_in') return null;
  const initials = state.user.fullName
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      {open && (
        <button
          type="button"
          aria-label={t('nav.close')}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 start-0 z-40 flex w-64 shrink-0 flex-col gap-7 border-e border-ink-700 bg-ink-900 px-4 py-6 transition-transform lg:static ${
          open ? '' : 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-2">
          <Logo compact />
          <button
            type="button"
            aria-label={t('nav.close')}
            className="rounded-lg p-1.5 text-ink-400 hover:text-white lg:hidden"
            onClick={() => setOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <SideNav items={ADMIN_NAV} />
        <div className="mt-auto flex items-center gap-3 rounded-2xl border border-ink-700 bg-ink-800 p-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-400 font-bold text-on-gold"
          >
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{state.user.fullName}</p>
            <p className="truncate text-xs text-ink-400">{t(`home.roles.${state.user.role}`)}</p>
          </div>
          <SignOutButton compact />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-ink-700 px-4 py-3 sm:px-8">
          <button
            type="button"
            aria-label={t('nav.open')}
            className="rounded-xl border border-ink-700 p-2 text-ink-200 hover:text-white lg:hidden"
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <div className="ms-auto flex items-center gap-3">
            <ThemeSwitcher />
            <LanguageSwitcher />
          </div>
        </header>
        <main className="flex flex-1 flex-col px-4 py-8 sm:px-8">{children}</main>
        <Footer />
      </div>
    </div>
  );
}

// Client portal layout: a simple top bar (approved design).
function ClientShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { state } = useAuth();
  if (state.status !== 'signed_in') return null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-ink-700 bg-ink-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
          <Logo compact />
          <nav aria-label={t('nav.label')} className="flex flex-wrap gap-1">
            {CLIENT_NAV.map((item) =>
              item.to ? (
                <NavLink
                  key={item.key}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-full px-3.5 py-1.5 text-sm transition ${
                      isActive
                        ? 'bg-ink-800 font-semibold text-gold-300'
                        : 'text-ink-200 hover:text-white'
                    }`
                  }
                >
                  {t(`nav.${item.key}`)}
                </NavLink>
              ) : (
                <span
                  key={item.key}
                  aria-disabled="true"
                  title={t('nav.soon')}
                  className="cursor-default rounded-full px-3.5 py-1.5 text-sm text-ink-400/80"
                >
                  {t(`nav.${item.key}`)}
                </span>
              ),
            )}
          </nav>
          <div className="ms-auto flex items-center gap-3">
            <ThemeSwitcher />
            <LanguageSwitcher />
            <span className="hidden text-sm text-ink-200 sm:inline">{state.user.fullName}</span>
            <SignOutButton compact />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6">
        {children}
      </main>
      <Footer />
    </div>
  );
}

// Signed out (login page): logo and language only.
function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-ink-700 bg-ink-900/80">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
          <Logo />
          <div className="ms-auto">
            <ThemeSwitcher />
            <LanguageSwitcher />
          </div>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">{children}</main>
      <Footer />
    </div>
  );
}

function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-ink-700 px-4 py-4 text-center text-xs text-ink-400">
      {t('footer.rights', { year: new Date().getFullYear() })}
    </footer>
  );
}

// Chooses the layout from who is signed in.
export function AppShell({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status !== 'signed_in') return <PublicShell>{children}</PublicShell>;
  if (state.user.role === 'SUPER_ADMIN') return <AdminShell>{children}</AdminShell>;
  return <ClientShell>{children}</ClientShell>;
}
