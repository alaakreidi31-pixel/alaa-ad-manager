// The administration and client portal routes of the API (ADR 0016).
import type { Api } from './api-client';

export type ClientStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';

export interface ClientFields {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  currency: string;
  timezone: string;
  website: string | null;
  businessIndustry: string | null;
}

// Administration view: includes the internal notes (agency only).
export interface AdminClient extends ClientFields {
  id: string;
  status: ClientStatus;
  internalNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

// Client portal view: NO internal notes.
export interface ClientProfile extends ClientFields {
  id: string;
  status: ClientStatus;
}

export interface ClientPage {
  items: AdminClient[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ClientUser {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
}

// Shown ONCE: the temporary password is never stored in the browser.
export interface WithTemporaryPassword {
  user: ClientUser;
  temporaryPassword: string;
}

// Form values: texts ("" clears an optional field on the server).
export type ClientInput = Record<keyof ClientFields | 'internalNotes', string>;

export interface ClientListQuery {
  search?: string;
  status?: ClientStatus | '';
  page?: number;
  pageSize?: number;
}

export const listClients = (api: Api, query: ClientListQuery) =>
  api<ClientPage>('/admin/clients', { query: { ...query } });

export const getClient = (api: Api, id: string) =>
  api<AdminClient>(`/admin/clients/${encodeURIComponent(id)}`);

export const createClient = (api: Api, input: ClientInput) =>
  api<AdminClient>('/admin/clients', { method: 'POST', body: input });

export const updateClient = (api: Api, id: string, input: ClientInput) =>
  api<AdminClient>(`/admin/clients/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });

export const changeClientStatus = (
  api: Api,
  id: string,
  action: 'suspend' | 'activate' | 'archive',
) => api<AdminClient>(`/admin/clients/${encodeURIComponent(id)}/${action}`, { method: 'POST' });

export const listClientUsers = (api: Api, clientId: string) =>
  api<ClientUser[]>(`/admin/clients/${encodeURIComponent(clientId)}/users`);

export const createClientUser = (
  api: Api,
  clientId: string,
  input: { email: string; fullName: string },
) =>
  api<WithTemporaryPassword>(`/admin/clients/${encodeURIComponent(clientId)}/users`, {
    method: 'POST',
    body: input,
  });

export const resetClientUserPassword = (api: Api, clientId: string, userId: string) =>
  api<WithTemporaryPassword>(
    `/admin/clients/${encodeURIComponent(clientId)}/users/${encodeURIComponent(userId)}/reset-password`,
    { method: 'POST' },
  );

export const changeClientUserStatus = (
  api: Api,
  clientId: string,
  userId: string,
  action: 'suspend' | 'activate',
) =>
  api<ClientUser>(
    `/admin/clients/${encodeURIComponent(clientId)}/users/${encodeURIComponent(userId)}/${action}`,
    { method: 'POST' },
  );

export const getMyClientProfile = (api: Api) => api<ClientProfile>('/client/profile');

// Administration home page summary (step 3.2): real counts only.
export interface AdminDashboard {
  clients: Record<ClientStatus, number> & { total: number };
  accounts: { total: number; active: number; suspended: number; pendingPasswordChange: number };
  recentClients: { id: string; name: string; status: ClientStatus; createdAt: string }[];
  // The current month, all clients; one line per currency (never added up).
  month: {
    month: string;
    activeCampaigns: number;
    spend: { currency: string; amount: string }[];
    fees: { currency: string; amount: string; clients: number }[];
    activeClientsWithoutPlan: number;
  };
  generatedAt: string;
}

export const getAdminDashboard = (api: Api) => api<AdminDashboard>('/admin/dashboard');
