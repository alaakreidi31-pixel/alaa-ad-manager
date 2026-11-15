import { Inject, Injectable } from '@nestjs/common';
import { auditRow } from '../audit/audit';
import { ClientArchivedError, ClientNotFoundError } from '../clients/clients.errors';
import { ClientIdSchema } from '../clients/clients.schemas';
import type { Actor } from '../clients/clients.service';
import type {
  Campaign,
  CampaignPlatform,
  CampaignStatus,
  Prisma,
} from '../generated/prisma/client';
import { fromMinor, MoneyFormatError, toMinor } from '../money/money';
import { PrismaService } from '../prisma/prisma.service';
import {
  CampaignArchivedError,
  CampaignNotFoundError,
  CampaignValidationError,
  CurrencyLockedError,
  ExternalIdTakenError,
  InvalidCampaignStatusChangeError,
} from './campaigns.errors';
import {
  CampaignDatesSchema,
  CampaignIdSchema,
  CreateCampaignSchema,
  ListAllCampaignsQuerySchema,
  ListCampaignsQuerySchema,
  UpdateCampaignSchema,
} from './campaigns.schemas';

// What the administration sees of a campaign. Money is decimal text in the
// campaign currency ("150.50" USD, "1500" JPY), stored in minor units
// (ADR 0008). Days are "YYYY-MM-DD": no float, no time zone shift.
export interface AdminCampaign {
  id: string;
  clientId: string;
  platform: CampaignPlatform;
  name: string;
  externalId: string | null;
  objective: string | null;
  status: CampaignStatus;
  currency: string;
  dailyBudget: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignPage {
  items: AdminCampaign[];
  total: number;
  page: number;
  pageSize: number;
}

// A row of the agency-wide list: the campaign and the name of its client.
export interface CampaignWithClient extends AdminCampaign {
  clientName: string;
}

export interface AllCampaignsPage {
  items: CampaignWithClient[];
  total: number;
  page: number;
  pageSize: number;
}

export type CampaignAction = 'pause' | 'activate' | 'end' | 'archive';

const TRANSITIONS: Record<CampaignAction, { from: CampaignStatus[]; to: CampaignStatus }> = {
  pause: { from: ['ACTIVE'], to: 'PAUSED' },
  activate: { from: ['PAUSED', 'ENDED', 'ARCHIVED'], to: 'ACTIVE' },
  end: { from: ['ACTIVE', 'PAUSED'], to: 'ENDED' },
  archive: { from: ['ACTIVE', 'PAUSED', 'ENDED'], to: 'ARCHIVED' },
};

const EDITABLE_FIELDS = [
  'name',
  'externalId',
  'objective',
  'currency',
  'dailyBudget',
  'startDate',
  'endDate',
] as const;

const toDay = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;
const fromDay = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00Z`);

function toAdminCampaign(campaign: Campaign): AdminCampaign {
  return {
    id: campaign.id,
    clientId: campaign.clientId,
    platform: campaign.platform,
    name: campaign.name,
    externalId: campaign.externalId,
    objective: campaign.objective,
    status: campaign.status,
    currency: campaign.currency,
    dailyBudget:
      campaign.dailyBudgetMinor === null
        ? null
        : fromMinor(campaign.dailyBudgetMinor, campaign.currency),
    startDate: toDay(campaign.startDate),
    endDate: toDay(campaign.endDate),
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}

// Decimal text -> minor units of the currency, as a validation error if the
// amount has too many decimals for it (e.g. 1.5 JPY).
function budgetMinor(amount: string | null, currency: string): bigint | null {
  if (amount === null) return null;
  try {
    return toMinor(amount, currency);
  } catch (error) {
    if (error instanceof MoneyFormatError) {
      throw new CampaignValidationError({ field: 'dailyBudget', message: error.message });
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

type Db = Pick<PrismaService, 'client' | 'campaign'>;

// Campaign management for the administration (ADR 0018). EVERY query is
// scoped by the client id of the URL AND the campaign id: a campaign of
// another client is "not found" (IDOR). Every change is audited in the SAME
// transaction. There is no delete: the database refuses it.
@Injectable()
export class CampaignsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(clientId: string, query: unknown): Promise<CampaignPage> {
    const parsed = ListCampaignsQuerySchema.safeParse(query);
    if (!parsed.success) throw new CampaignValidationError(parsed.error);
    const { status, platform, page, pageSize } = parsed.data;
    await this.findClient(this.prisma, clientId);

    const where = { clientId, ...(status ? { status } : {}), ...(platform ? { platform } : {}) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return { items: rows.map(toAdminCampaign), total, page, pageSize };
  }

  // Every campaign of every client, newest first (administration only).
  async listAll(query: unknown): Promise<AllCampaignsPage> {
    const parsed = ListAllCampaignsQuerySchema.safeParse(query);
    if (!parsed.success) throw new CampaignValidationError(parsed.error);
    const { search, status, platform, page, pageSize } = parsed.data;

    const where = {
      ...(status ? { status } : {}),
      ...(platform ? { platform } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { client: { name: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        include: { client: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({ ...toAdminCampaign(row), clientName: row.client.name })),
      total,
      page,
      pageSize,
    };
  }

  async get(clientId: string, campaignId: string): Promise<AdminCampaign> {
    await this.findClient(this.prisma, clientId);
    return toAdminCampaign(await this.findCampaign(this.prisma, clientId, campaignId));
  }

  async create(clientId: string, input: unknown, actor: Actor): Promise<AdminCampaign> {
    const parsed = CreateCampaignSchema.safeParse(input);
    if (!parsed.success) throw new CampaignValidationError(parsed.error);
    const { startDate, endDate, currency, dailyBudget, ...rest } = parsed.data;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const client = await this.findClient(tx, clientId);
        if (client.status === 'ARCHIVED') throw new ClientArchivedError();
        // Default: the client's currency.
        const campaignCurrency = currency ?? client.currency;
        const campaign = await tx.campaign.create({
          data: {
            ...rest,
            clientId: client.id,
            currency: campaignCurrency,
            dailyBudgetMinor: budgetMinor(dailyBudget ?? null, campaignCurrency),
            startDate: fromDay(startDate) ?? null,
            endDate: fromDay(endDate) ?? null,
          },
        });
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.campaign.created',
            metadata: {
              clientId: client.id,
              campaignId: campaign.id,
              platform: campaign.platform,
              name: campaign.name,
            },
          }),
        });
        return toAdminCampaign(campaign);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ExternalIdTakenError();
      throw error;
    }
  }

  async update(
    clientId: string,
    campaignId: string,
    input: unknown,
    actor: Actor,
  ): Promise<AdminCampaign> {
    const parsed = UpdateCampaignSchema.safeParse(input);
    if (!parsed.success) throw new CampaignValidationError(parsed.error);
    const changes = parsed.data;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const client = await this.findClient(tx, clientId);
        if (client.status === 'ARCHIVED') throw new ClientArchivedError();
        const current = await this.findCampaign(tx, clientId, campaignId);
        if (current.status === 'ARCHIVED') throw new CampaignArchivedError();

        const before = toAdminCampaign(current);
        // Daily numbers are stored in the campaign currency (step 4.2).
        if (
          changes.currency !== undefined &&
          changes.currency !== current.currency &&
          (await tx.campaignDailyMetric.count({ where: { campaignId: current.id } })) > 0
        ) {
          throw new CurrencyLockedError();
        }
        // The budget is compared in minor units of the NEW currency, so
        // "150" and "150.00" are the same amount; a currency change converts
        // the stored budget (and refuses it if it has too many decimals).
        const currency = changes.currency ?? current.currency;
        const budgetText =
          changes.dailyBudget !== undefined ? changes.dailyBudget : before.dailyBudget;
        const minor =
          changes.currency !== undefined || changes.dailyBudget !== undefined
            ? budgetMinor(budgetText, currency)
            : current.dailyBudgetMinor;
        const changed = EDITABLE_FIELDS.filter((field) =>
          field === 'dailyBudget'
            ? minor !== current.dailyBudgetMinor
            : changes[field] !== undefined && changes[field] !== before[field],
        );
        if (changed.length === 0) return before;

        // The order of the dates is checked with the stored value too.
        const start = changes.startDate !== undefined ? changes.startDate : before.startDate;
        const end = changes.endDate !== undefined ? changes.endDate : before.endDate;
        const dates = CampaignDatesSchema.safeParse({ startDate: start, endDate: end });
        if (!dates.success) throw new CampaignValidationError(dates.error);

        const data: Prisma.CampaignUpdateInput = {
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.externalId !== undefined ? { externalId: changes.externalId } : {}),
          ...(changes.objective !== undefined ? { objective: changes.objective } : {}),
          currency,
          dailyBudgetMinor: minor,
          ...(changes.startDate !== undefined ? { startDate: fromDay(changes.startDate) } : {}),
          ...(changes.endDate !== undefined ? { endDate: fromDay(changes.endDate) } : {}),
        };
        const campaign = await tx.campaign.update({ where: { id: current.id }, data });
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.campaign.updated',
            metadata: { clientId, campaignId: campaign.id, fields: changed.join(',') },
          }),
        });
        return toAdminCampaign(campaign);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ExternalIdTakenError();
      throw error;
    }
  }

  async changeStatus(
    clientId: string,
    campaignId: string,
    action: CampaignAction,
    actor: Actor,
  ): Promise<AdminCampaign> {
    const transition = TRANSITIONS[action];

    return this.prisma.$transaction(async (tx) => {
      const client = await this.findClient(tx, clientId);
      if (client.status === 'ARCHIVED') throw new ClientArchivedError();
      const current = await this.findCampaign(tx, clientId, campaignId);
      if (!transition.from.includes(current.status)) {
        throw new InvalidCampaignStatusChangeError(current.status, transition.to);
      }
      const campaign = await tx.campaign.update({
        where: { id: current.id },
        data: { status: transition.to },
      });
      await tx.auditLog.create({
        data: auditRow({
          ...actor,
          action: 'admin.campaign.status_changed',
          metadata: { clientId, campaignId: campaign.id, from: current.status, to: transition.to },
        }),
      });
      return toAdminCampaign(campaign);
    });
  }

  // Ids that are not UUIDs are simply "not found" (no database error).
  private async findClient(db: Db, clientId: string) {
    if (!ClientIdSchema.safeParse(clientId).success) throw new ClientNotFoundError();
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { id: true, status: true, currency: true },
    });
    if (!client) throw new ClientNotFoundError();
    return client;
  }

  private async findCampaign(db: Db, clientId: string, campaignId: string): Promise<Campaign> {
    if (!CampaignIdSchema.safeParse(campaignId).success) throw new CampaignNotFoundError();
    // BOTH ids: a campaign of another client is not found (IDOR).
    const campaign = await db.campaign.findFirst({ where: { id: campaignId, clientId } });
    if (!campaign) throw new CampaignNotFoundError();
    return campaign;
  }
}
