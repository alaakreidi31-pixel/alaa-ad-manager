import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/auth-context';
import { GuestOnly, RequireAuth, RequireRole } from './auth/route-guards';
import { AppShell } from './components/AppShell';
import { CampaignDetailPage } from './pages/admin/CampaignDetailPage';
import { CampaignFormPage } from './pages/admin/CampaignFormPage';
import { CampaignsListPage } from './pages/admin/CampaignsListPage';
import { ClientDetailPage } from './pages/admin/ClientDetailPage';
import { ClientFormPage } from './pages/admin/ClientFormPage';
import { ClientsListPage } from './pages/admin/ClientsListPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

// Administration pages: SUPER_ADMIN only.
const admin = (page: ReactNode) => <RequireRole role="SUPER_ADMIN">{page}</RequireRole>;

// The layout (menu, header) is chosen by role in AppShell. Layout uses logical
// spacing (ps/pe/ms/me, start/end) so pages flip between English and Arabic.
export function App() {
  return (
    <AuthProvider>
      <AppShell>
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
          <Route path="/admin/campaigns" element={admin(<CampaignsListPage />)} />
          <Route path="/admin/clients/:id/campaigns/new" element={admin(<CampaignFormPage />)} />
          <Route
            path="/admin/clients/:id/campaigns/:campaignId"
            element={admin(<CampaignDetailPage />)}
          />
          <Route
            path="/admin/clients/:id/campaigns/:campaignId/edit"
            element={admin(<CampaignFormPage />)}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </AuthProvider>
  );
}
