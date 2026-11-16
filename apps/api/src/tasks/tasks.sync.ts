import type { Prisma } from '../generated/prisma/client';

// Tasks made by the application itself (step 8.2, ADR 0022). There is no
// background scheduler yet: the sync runs when the administration opens the
// tasks or the dashboard. Every INSERT is idempotent (unique occurrence per
// rule and day, unique system key), so running it twice changes nothing.

const TODAY = `(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`;
// Recurring occurrences missed while nobody opened the application are
// created up to 31 days back, never before the rule existed.
const CATCH_UP_DAYS = 31;
// An active campaign with no numbers for this many full days gets a task.
export const STALE_DAYS = 3;

export interface SyncResult {
  recurring: number;
  system: number;
  closed: number;
}

export async function syncTasks(tx: Prisma.TransactionClient): Promise<SyncResult> {
  const recurring = await tx.$executeRawUnsafe(`
    INSERT INTO tasks (title, description, priority, due_on, client_id, campaign_id,
                       visible_to_client, source, recurrence_id, occurrence_on)
    SELECT r.title, r.description, r.priority, d.day + r.due_after_days, r.client_id, r.campaign_id,
           r.visible_to_client, 'RECURRING', r.id, d.day
    FROM task_recurrences r
    CROSS JOIN LATERAL (
      SELECT generate_series(
        GREATEST(r.starts_on, (r.created_at AT TIME ZONE 'UTC')::date, ${TODAY} - ${CATCH_UP_DAYS})::timestamp,
        LEAST(${TODAY}, COALESCE(r.ends_on, ${TODAY}))::timestamp,
        interval '1 day')::date AS day
    ) d
    WHERE r.paused_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = r.client_id AND c.status = 'ARCHIVED')
      AND CASE r.frequency
            WHEN 'WEEKLY' THEN EXTRACT(ISODOW FROM d.day) = r.day_of_week
            ELSE EXTRACT(DAY FROM d.day) = r.day_of_month
          END
    ON CONFLICT (recurrence_id, occurrence_on) DO NOTHING`);

  // Invoice drafts waiting for review and issue.
  const reviews = await tx.$executeRawUnsafe(`
    INSERT INTO tasks (title, priority, due_on, client_id, source, system_key)
    SELECT btrim(left('مراجعة وإصدار مسودة فاتورة: ' || c.name || ' — ' || to_char(i.period_month, 'YYYY-MM'), 200)),
           'MEDIUM', ${TODAY}, i.client_id, 'SYSTEM', 'invoice-review:' || i.id
    FROM invoices i JOIN clients c ON c.id = i.client_id
    WHERE i.status = 'DRAFT'
    ON CONFLICT (system_key) DO NOTHING`);

  // Issued invoices past their due date and not fully paid.
  const overdue = await tx.$executeRawUnsafe(`
    INSERT INTO tasks (title, priority, due_on, client_id, source, system_key)
    SELECT btrim(left('متابعة فاتورة متأخرة: ' || i.number || ' — ' || c.name, 200)),
           'HIGH', i.due_on, i.client_id, 'SYSTEM', 'invoice-overdue:' || i.id
    FROM invoices i JOIN clients c ON c.id = i.client_id
    WHERE i.status = 'ISSUED' AND i.due_on < ${TODAY}
      AND i.total_minor > (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p
                           WHERE p.invoice_id = i.id AND p.voided_at IS NULL)
    ON CONFLICT (system_key) DO NOTHING`);

  // Active campaigns without numbers for STALE_DAYS full days. The key holds
  // the last day with numbers: a later gap is a new task.
  const stale = await tx.$executeRawUnsafe(`
    INSERT INTO tasks (title, priority, due_on, client_id, campaign_id, source, system_key)
    SELECT btrim(left('حملة بلا أرقام منذ ${STALE_DAYS} أيام أو أكثر: ' || s.name || ' — ' || s.client_name, 200)),
           'MEDIUM', ${TODAY}, s.client_id, s.id, 'SYSTEM', s.key
    FROM (
      SELECT ca.id, ca.name, ca.client_id, cl.name AS client_name,
             'stale-campaign:' || ca.id || ':' || COALESCE(to_char(m.last, 'YYYY-MM-DD'), 'none') AS key,
             COALESCE(m.last, (ca.created_at AT TIME ZONE 'UTC')::date) AS since
      FROM campaigns ca
      JOIN clients cl ON cl.id = ca.client_id
      LEFT JOIN LATERAL (SELECT max(date) AS last FROM campaign_daily_metrics WHERE campaign_id = ca.id) m ON true
      WHERE ca.status = 'ACTIVE' AND cl.status = 'ACTIVE'
    ) s
    WHERE s.since < ${TODAY} - ${STALE_DAYS}
    ON CONFLICT (system_key) DO NOTHING`);

  // Close the system tasks whose reason is gone (still open ones only).
  const closed = await tx.$executeRawUnsafe(`
    UPDATE tasks t SET status = 'DONE'
    WHERE t.source = 'SYSTEM' AND t.status IN ('TODO', 'IN_PROGRESS') AND (
      (t.system_key LIKE 'invoice-review:%' AND NOT EXISTS (
         SELECT 1 FROM invoices i WHERE 'invoice-review:' || i.id = t.system_key AND i.status = 'DRAFT'))
      OR (t.system_key LIKE 'invoice-overdue:%' AND NOT EXISTS (
         SELECT 1 FROM invoices i WHERE 'invoice-overdue:' || i.id = t.system_key AND i.status = 'ISSUED'
           AND i.total_minor > (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p
                                WHERE p.invoice_id = i.id AND p.voided_at IS NULL)))
      OR (t.system_key LIKE 'stale-campaign:%' AND NOT EXISTS (
         SELECT 1 FROM campaigns ca
         LEFT JOIN LATERAL (SELECT max(date) AS last FROM campaign_daily_metrics WHERE campaign_id = ca.id) m ON true
         WHERE ca.id = t.campaign_id AND ca.status = 'ACTIVE'
           AND 'stale-campaign:' || ca.id || ':' || COALESCE(to_char(m.last, 'YYYY-MM-DD'), 'none') = t.system_key))
    )`);

  return { recurring, system: reviews + overdue + stale, closed };
}
