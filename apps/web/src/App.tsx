import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/auth-context';
import { GuestOnly, RequireAuth, RequireRole } from './auth/route-guards';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { Logo } from './components/Logo';
import { MainNav } from './components/MainNav';
import { UserMenu } from './components/UserMenu';
import { ClientDetailPage } from './pages/admin/ClientDetailPage';
import { ClientFormPage } from './pages/admin/ClientFormPage';
import { ClientsListPage } from './pages/admin/ClientsListPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

// Administration pages: SUPER_ADMIN only.
const admin = (page: ReactNode) => <RequireRole role="SUPER_ADMIN">{page}</RequireRole>;

// Layout uses logical spacing (ps/pe/ms/me, text-start) instead of left/right,
// so the whole page flips correctly between English (LTR) and Arabic (RTL).
export function App() {
  const { t } = useTranslation();

  return (
    <AuthProvider>
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-ink-700 bg-ink-900/80">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
            <Logo />
            <MainNav />
            <div className="ms-auto flex items-center gap-3">
              <UserMenu />
              <LanguageSwitcher />
            </div>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
          <Routes>
            <Route
              path="/login"
              element={
                <GuestOnly>
                  <LoginPage />
                </GuestOnly>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <HomePage />
                </RequireAuth>
              }
            />
            <Route path="/admin/clients" element={admin(<ClientsListPage />)} />
            <Route path="/admin/clients/new" element={admin(<ClientFormPage />)} />
            <Route path="/admin/clients/:id" element={admin(<ClientDetailPage />)} />
            <Route path="/admin/clients/:id/edit" element={admin(<ClientFormPage />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        <footer className="border-t border-ink-700 px-4 py-4 text-center text-xs text-ink-400">
          {t('footer.rights', { year: new Date().getFullYear() })}
        </footer>
      </div>
    </AuthProvider>
  );
}
