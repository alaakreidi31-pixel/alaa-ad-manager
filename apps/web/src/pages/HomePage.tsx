import { useAuth } from '../auth/auth-context';
import { AdminDashboardPage } from './admin/AdminDashboardPage';
import { ClientHomePage } from './client/ClientHomePage';

// The home page depends on who is signed in.
export function HomePage() {
  const { state } = useAuth();
  if (state.status !== 'signed_in') return null;
  return state.user.role === 'CLIENT_USER' ? <ClientHomePage /> : <AdminDashboardPage />;
}
