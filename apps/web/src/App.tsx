import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/auth-context';
import { GuestOnly, RequireAuth, RequireRole } from './auth/route-guards';
import { AppShell } from './components/AppShell';
import { CampaignDetailPage } from './pages/admin/CampaignDetailPage';
import { CampaignFormPage } from './pages/admin/CampaignFormPage';
import { CampaignImportPage } from './pages/admin/CampaignImportPage';
import { CampaignsListPage } from './pages/admin/CampaignsListPage';
import { InvoiceDetailPage } from './pages/admin/InvoiceDetailPage';
import { InvoicePrintPage } from './pages/admin/InvoicePrintPage';
import { InvoicesListPage } from './pages/admin/InvoicesListPage';
import { ReportsPage } from './pages/admin/ReportsPage';
import { TaskDetailPage } from './pages/admin/TaskDetailPage';
import { TaskRecurrencesPage } from './pages/admin/TaskRecurrencesPage';
import { TasksPage } from './pages/admin/TasksPage';
import { ClientDetailPage } from './pages/admin/ClientDetailPage';
import { ClientFormPage } from './pages/admin/ClientFormPage';
import { ClientsListPage } from './pages/admin/ClientsListPage';
import { ClientCampaignPage } from './pages/client/ClientCampaignPage';
import { ClientCampaignsPage } from './pages/client/ClientCampaignsPage';
import { ClientInvoicePage } from './pages/client/ClientInvoicePage';
import { ClientInvoicesPage } from './pages/client/ClientInvoicesPage';
import { ClientReportsPage } from './pages/client/ClientReportsPage';
import { ClientTasksPage } from './pages/client/ClientTasksPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

// Administration pages: SUPER_ADMIN only.
const admin = (page: ReactNode) => <RequireRole role="SUPER_ADMIN">{page}</RequireRole>;
// Client portal pages: CLIENT_USER only.
const client = (page: ReactNode) => <RequireRole role="CLIENT_USER">{page}</RequireRole>;

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
          <Route path="/admin/invoices" element={admin(<InvoicesListPage />)} />
          <Route path="/admin/reports" element={admin(<ReportsPage />)} />
          <Route path="/admin/tasks" element={admin(<TasksPage />)} />
          <Route path="/admin/tasks/recurring" element={admin(<TaskRecurrencesPage />)} />
          <Route path="/admin/tasks/:id" element={admin(<TaskDetailPage />)} />
          <Route path="/admin/invoices/:id" element={admin(<InvoiceDetailPage />)} />
          <Route path="/admin/invoices/:id/print" element={admin(<InvoicePrintPage />)} />
          <Route path="/admin/clients/:id/campaigns/new" element={admin(<CampaignFormPage />)} />
          <Route
            path="/admin/clients/:id/campaigns/import"
            element={admin(<CampaignImportPage />)}
          />
          <Route
            path="/admin/clients/:id/campaigns/:campaignId"
            element={admin(<CampaignDetailPage />)}
          />
          <Route
            path="/admin/clients/:id/campaigns/:campaignId/edit"
            element={admin(<CampaignFormPage />)}
          />
          <Route path="/campaigns" element={client(<ClientCampaignsPage />)} />
          <Route path="/campaigns/:campaignId" element={client(<ClientCampaignPage />)} />
          <Route path="/invoices" element={client(<ClientInvoicesPage />)} />
          <Route path="/reports" element={client(<ClientReportsPage />)} />
          <Route path="/tasks" element={client(<ClientTasksPage />)} />
          <Route path="/invoices/:id" element={client(<ClientInvoicePage />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </AuthProvider>
  );
}
