import type { Prisma } from '../generated/prisma/client';

// Notifications for situations found by the periodic sync (step 9.2). Each
// one has a dedupe key: running the sync again adds nothing.
const TODAY = `(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`;

export async function syncNotifications(tx: Prisma.TransactionClient): Promise<number> {
  // Open system tasks (invoice draft to review, invoice overdue, campaign
  // without numbers...) -> administrators.
  const system = await tx.$executeRawUnsafe(`
    INSERT INTO notifications (user_id, kind, params, link, dedupe_key)
    SELECT u.id,
           CASE split_part(t.system_key, ':', 1)
             WHEN 'invoice-review' THEN 'invoice.draft_ready'
             WHEN 'invoice-overdue' THEN 'invoice.overdue'
             WHEN 'stale-campaign' THEN 'campaign.stale'
             ELSE 'task.system'
           END,
           jsonb_build_object('title', t.title, 'client', c.name),
           '/admin/tasks/' || t.id, 'task:' || t.id
    FROM tasks t
    LEFT JOIN clients c ON c.id = t.client_id
    JOIN users u ON u.role = 'SUPER_ADMIN' AND u.status = 'ACTIVE'
    WHERE t.source = 'SYSTEM' AND t.status IN ('TODO', 'IN_PROGRESS')
    ON CONFLICT (user_id, dedupe_key) DO NOTHING`);

  // Other open tasks past their due date -> administrators.
  const overdueTasks = await tx.$executeRawUnsafe(`
    INSERT INTO notifications (user_id, kind, params, link, dedupe_key)
    SELECT u.id, 'task.overdue', jsonb_build_object('title', t.title, 'dueOn', to_char(t.due_on, 'YYYY-MM-DD')),
           '/admin/tasks/' || t.id, 'task-overdue:' || t.id
    FROM tasks t
    JOIN users u ON u.role = 'SUPER_ADMIN' AND u.status = 'ACTIVE'
    WHERE t.source <> 'SYSTEM' AND t.status IN ('TODO', 'IN_PROGRESS') AND t.due_on < ${TODAY}
    ON CONFLICT (user_id, dedupe_key) DO NOTHING`);

  // Shared tasks (recurring ones too) -> the accounts of THAT client.
  const shared = await tx.$executeRawUnsafe(`
    INSERT INTO notifications (user_id, kind, params, link, dedupe_key)
    SELECT u.id, 'task.shared', jsonb_build_object('title', t.title), '/tasks', 'task-shared:' || t.id
    FROM tasks t
    JOIN users u ON u.role = 'CLIENT_USER' AND u.status = 'ACTIVE' AND u.client_id = t.client_id
    WHERE t.visible_to_client AND t.status IN ('TODO', 'IN_PROGRESS')
    ON CONFLICT (user_id, dedupe_key) DO NOTHING`);

  // Issued invoices past due and not fully paid -> the accounts of THAT client.
  const overdueInvoices = await tx.$executeRawUnsafe(`
    INSERT INTO notifications (user_id, kind, params, link, dedupe_key)
    SELECT u.id, 'invoice.overdue', jsonb_build_object('number', i.number, 'dueOn', to_char(i.due_on, 'YYYY-MM-DD')),
           '/invoices/' || i.id, 'invoice-overdue:' || i.id
    FROM invoices i
    JOIN users u ON u.role = 'CLIENT_USER' AND u.status = 'ACTIVE' AND u.client_id = i.client_id
    WHERE i.status = 'ISSUED' AND i.due_on < ${TODAY}
      AND i.total_minor > (SELECT COALESCE(SUM(p.amount_minor), 0) FROM payments p
                           WHERE p.invoice_id = i.id AND p.voided_at IS NULL)
    ON CONFLICT (user_id, dedupe_key) DO NOTHING`);

  return system + overdueTasks + shared + overdueInvoices;
}
