import { Inject, Injectable } from '@nestjs/common';
import type { ClientStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClientNotFoundError } from './clients.errors';

// What a CLIENT sees of its own company. Built from an explicit list of
// fields: internal_notes is never even read from the database (ADR 0016).
export interface ClientProfile {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  currency: string;
  timezone: string;
  website: string | null;
  businessIndustry: string | null;
  status: ClientStatus;
}

const PROFILE_FIELDS = {
  id: true,
  name: true,
  contactName: true,
  email: true,
  phone: true,
  country: true,
  currency: true,
  timezone: true,
  website: true,
  businessIndustry: true,
  status: true,
} as const;

// Services for the client portal. The client id ALWAYS comes from the
// session (never from the request), so a client can only reach its own data.
@Injectable()
export class ClientPortalService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async profile(clientId: string): Promise<ClientProfile> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: PROFILE_FIELDS,
    });
    if (!client) throw new ClientNotFoundError();
    return client;
  }
}
