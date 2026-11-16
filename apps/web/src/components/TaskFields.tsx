import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/auth-context';
import { listClients } from '../lib/admin-api';
import type { FieldError } from '../lib/api-client';
import { listClientCampaigns } from '../lib/campaigns-api';
import type { TaskInput } from '../lib/tasks-api';
import { ui } from './ui';

type Linked = Pick<
  TaskInput,
  'title' | 'description' | 'priority' | 'clientId' | 'campaignId' | 'visibleToClient'
>;

// The common fields of a task and of a recurring rule: title, description,
// priority, client, campaign of that client, shared with the client.
export function TaskFields<T extends Linked>({
  value,
  onChange,
  errors,
}: {
  value: T;
  onChange: (value: T) => void;
  errors: FieldError[];
}) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    listClients(api, { pageSize: 100 })
      .then((page) => setClients(page.items.map(({ id, name }) => ({ id, name }))))
      .catch(() => setClients([]));
  }, [api]);

  useEffect(() => {
    if (!value.clientId) {
      setCampaigns([]);
      return;
    }
    listClientCampaigns(api, value.clientId)
      .then((page) => setCampaigns(page.items.map(({ id, name }) => ({ id, name }))))
      .catch(() => setCampaigns([]));
  }, [api, value.clientId]);

  const error = (field: string) => {
    const found = errors.find((item) => item.field === field);
    return found ? (
      <p className="mt-1 text-xs text-danger">{t(`tasks.errors.${field}`, found.message)}</p>
    ) : null;
  };
  const set = (patch: Partial<Linked>) => onChange({ ...value, ...patch });

  return (
    <>
      <label className="block sm:col-span-2">
        <span className={ui.label}>{t('tasks.fields.title')}</span>
        <input
          className={ui.input}
          value={value.title}
          maxLength={200}
          required
          onChange={(e) => set({ title: e.target.value })}
        />
        {error('title')}
      </label>
      <label className="block sm:col-span-2">
        <span className={ui.label}>{t('tasks.fields.description')}</span>
        <textarea
          className={`${ui.input} min-h-24`}
          value={value.description}
          maxLength={5000}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <label className="block">
        <span className={ui.label}>{t('tasks.fields.priority')}</span>
        <select
          className={ui.input}
          value={value.priority}
          onChange={(e) => set({ priority: e.target.value as Linked['priority'] })}
        >
          {(['HIGH', 'MEDIUM', 'LOW'] as const).map((priority) => (
            <option key={priority} value={priority}>
              {t(`tasks.priority.${priority}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={ui.label}>{t('tasks.fields.client')}</span>
        <select
          className={ui.input}
          value={value.clientId}
          // Changing the client clears its campaign and the sharing.
          onChange={(e) =>
            set({
              clientId: e.target.value,
              campaignId: '',
              visibleToClient: e.target.value ? value.visibleToClient : false,
            })
          }
        >
          <option value="">{t('tasks.noClient')}</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        {error('clientId')}
      </label>
      <label className="block">
        <span className={ui.label}>{t('tasks.fields.campaign')}</span>
        <select
          className={ui.input}
          value={value.campaignId}
          disabled={!value.clientId}
          onChange={(e) => set({ campaignId: e.target.value })}
        >
          <option value="">{t('tasks.noCampaign')}</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
        {error('campaignId')}
      </label>
      <label className="flex items-start gap-2 self-end pb-2 text-sm text-white">
        <input
          type="checkbox"
          className="mt-1"
          checked={value.visibleToClient}
          disabled={!value.clientId}
          onChange={(e) => set({ visibleToClient: e.target.checked })}
        />
        <span>
          {t('tasks.fields.visibleToClient')}
          <span className="block text-xs text-ink-400">{t('tasks.visibleHint')}</span>
        </span>
      </label>
    </>
  );
}
