import { Prisma } from '../generated/prisma/client';

// Writes in-app notifications (phase 9, ADR 0023), inside the caller's
// transaction when it has one. A notification is a code ("kind") and its
// values ("params"); the web app writes the sentence. NEVER put a password,
// token, internal note or comment text in params.

export type NotificationKind =
  // Invoices
  | 'invoice.issued'
  | 'invoice.payment_recorded'
  | 'invoice.draft_ready'
  | 'invoice.overdue'
  // Tasks
  | 'task.shared'
  | 'task.status_changed'
  | 'task.overdue'
  | 'task.system'
  // Campaigns
  | 'campaign.status_changed'
  | 'campaign.import_done'
  | 'campaign.stale'
  // Security
  | 'security.account_locked'
  | 'security.new_device';

export interface Note {
  kind: NotificationKind;
  params?: Record<string, string | number | boolean | null>;
  // A path inside the application, e.g. /invoices/<id>.
  link?: string | null;
  // The same key is shown once per user.
  dedupeKey?: string | null;
}

type Db = { $executeRaw: Prisma.TransactionClient['$executeRaw'] };

function insert(db: Db, recipients: Prisma.Sql, note: Note): Promise<number> {
  return db.$executeRaw`
    INSERT INTO notifications (user_id, kind, params, link, dedupe_key)
    SELECT u.id, ${note.kind}, ${JSON.stringify(note.params ?? {})}::jsonb, ${note.link ?? null}, ${note.dedupeKey ?? null}
    FROM users u
    WHERE u.status = 'ACTIVE' AND ${recipients}
    ON CONFLICT (user_id, dedupe_key) DO NOTHING`;
}

// Every active administrator.
export const notifyAdmins = (db: Db, note: Note) =>
  insert(db, Prisma.sql`u.role = 'SUPER_ADMIN'`, note);

// Every active login account of ONE client (never another client's).
export const notifyClient = (db: Db, clientId: string, note: Note) =>
  insert(db, Prisma.sql`u.role = 'CLIENT_USER' AND u.client_id = ${clientId}::uuid`, note);

export const notifyUser = (db: Db, userId: string, note: Note) =>
  insert(db, Prisma.sql`u.id = ${userId}::uuid`, note);

// "Chrome on Windows": enough to recognize a device, never the full header.
export function deviceName(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Browser';
  const system = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'unknown';
  return `${browser} / ${system}`;
}
