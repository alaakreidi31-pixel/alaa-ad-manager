import type { PrismaClient } from '../generated/prisma/client';

// Security audit log (ADR 0014): who did what, when, and from where.
// Append-only: the application database user can add and read rows, but the
// database refuses any UPDATE or DELETE on audit_logs (see the migration).
//
// NEVER put a password, token, code or key in an audit event.

export type AuditAction =
  // Full login completed: a session was started.
  | 'auth.login.succeeded'
  // Correct password, waiting for the 2FA code (no session yet).
  | 'auth.login.password_verified'
  // Login refused (reason in metadata).
  | 'auth.login.failed'
  // Too many failures: the account was locked for 15 minutes (ADR 0012).
  | 'auth.account.locked'
  // Second step refused (reason in metadata).
  | 'auth.two_factor.failed'
  // An old refresh token was used again: every session was closed (ADR 0011).
  | 'auth.session.reuse_detected'
  | 'auth.logout'
  // Administrative commands
  | 'admin.two_factor.enabled'
  | 'admin.super_admin.created'
  // Client management (ADR 0016). The admin is userId, the client is metadata.clientId.
  | 'admin.client.created'
  | 'admin.client.updated'
  | 'admin.client.status_changed'
  // Client login accounts (ADR 0016). Temporary passwords are NEVER logged.
  | 'admin.client_user.created'
  | 'admin.client_user.password_reset'
  | 'admin.client_user.status_changed'
  // Campaigns (ADR 0018): metadata.clientId and metadata.campaignId.
  | 'admin.campaign.created'
  | 'admin.campaign.updated'
  | 'admin.campaign.status_changed'
  // The numbers of one day were entered or corrected (metadata.date).
  | 'admin.campaign_metrics.saved'
  // A CSV file of daily numbers was imported (counts in metadata).
  | 'admin.campaign_metrics.imported'
  // Correct temporary password: the user must now choose a new one.
  | 'auth.login.password_change_required'
  | 'auth.password.changed';

export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface AuditEvent extends AuditContext {
  action: AuditAction;
  // The account concerned (null when unknown, e.g. a login with an unknown email).
  userId?: string | null;
  metadata?: AuditMetadata;
}

// Limits stored text, so one request cannot fill the table with huge values.
const MAX_TEXT = 512;
const clip = (value: string | undefined): string | null =>
  value === undefined ? null : value.slice(0, MAX_TEXT);

// Shape of one row, shared by the service and the administrative commands
// (which write inside their own transaction).
export function auditRow(event: AuditEvent) {
  return {
    action: event.action,
    userId: event.userId ?? null,
    ip: clip(event.ip),
    userAgent: clip(event.userAgent),
    ...(event.metadata ? { metadata: event.metadata } : {}),
  };
}

type AuditWriter = Pick<PrismaClient, 'auditLog'>;

export async function writeAuditLog(db: AuditWriter, event: AuditEvent): Promise<void> {
  await db.auditLog.create({ data: auditRow(event) });
}
