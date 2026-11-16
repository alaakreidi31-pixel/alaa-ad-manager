-- Database checks of the tasks (step 8.1, ADR 0022). Run by
-- tasks.database.db-spec.ts as alaa_app, inside ONE transaction that is
-- rolled back at the end. Statements are separated by a line "-- @@".
CREATE TEMP TABLE results (n serial, label text, ok boolean, detail text);
-- @@
CREATE FUNCTION pg_temp.must_fail(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    INSERT INTO results(label, ok, detail) VALUES (label, false, 'was ACCEPTED');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results(label, ok, detail) VALUES (label, true, 'refused: ' || SQLERRM);
  END;
END $$;
-- @@
CREATE FUNCTION pg_temp.must_pass(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  INSERT INTO results(label, ok, detail) VALUES (label, true, 'accepted');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO results(label, ok, detail) VALUES (label, false, 'refused: ' || SQLERRM);
END $$;
-- @@
CREATE FUNCTION pg_temp.check(label text, actual text, expected text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results(label, ok, detail)
  VALUES (label, actual IS NOT DISTINCT FROM expected, 'got ' || coalesce(actual,'NULL') || ', expected ' || coalesce(expected,'NULL'));
$$;
-- @@
INSERT INTO users (id, email, full_name, password_hash, role, updated_at) VALUES
  ('c8000000-0000-0000-0000-000000000001', 'tasks-check@alaa.test', 'Tasks Check', 'x', 'SUPER_ADMIN', now());
-- @@
INSERT INTO clients (id, name, updated_at) VALUES
  ('c8100000-0000-0000-0000-000000000001', 'Tasks A', now()),
  ('c8100000-0000-0000-0000-000000000002', 'Tasks B', now());
-- @@
INSERT INTO campaigns (id, client_id, platform, name, currency, updated_at) VALUES
  ('c8200000-0000-0000-0000-000000000001', 'c8100000-0000-0000-0000-000000000001', 'META', 'Of A', 'USD', now()),
  ('c8200000-0000-0000-0000-000000000002', 'c8100000-0000-0000-0000-000000000002', 'GOOGLE', 'Of B', 'USD', now());
-- @@
DO $$
DECLARE
  u uuid := 'c8000000-0000-0000-0000-000000000001';
  a uuid := 'c8100000-0000-0000-0000-000000000001';
  b uuid := 'c8100000-0000-0000-0000-000000000002';
  ca uuid := 'c8200000-0000-0000-0000-000000000001';
  cb uuid := 'c8200000-0000-0000-0000-000000000002';
  t1 uuid; t2 uuid; r1 uuid; c1 uuid; done_at timestamptz;
BEGIN
  -- Manual tasks
  PERFORM pg_temp.must_pass('general task (no client)', format('INSERT INTO tasks (title, created_by) VALUES (%L, %L)', 'Plan the month', u));
  PERFORM pg_temp.must_pass('task for a client', format('INSERT INTO tasks (title, client_id, created_by) VALUES (%L, %L, %L)', 'Call A', a, u));
  PERFORM pg_temp.must_pass('task for a campaign of the client, shared', format('INSERT INTO tasks (title, client_id, campaign_id, visible_to_client, priority, due_on, created_by) VALUES (%L, %L, %L, true, %L, %L, %L)', 'New creatives', a, ca, 'HIGH', '2026-12-01', u));
  SELECT id INTO t1 FROM tasks WHERE title = 'New creatives';
  PERFORM pg_temp.must_fail('campaign of ANOTHER client', format('INSERT INTO tasks (title, client_id, campaign_id, created_by) VALUES (%L, %L, %L, %L)', 'x', a, cb, u));
  PERFORM pg_temp.must_fail('campaign without client', format('INSERT INTO tasks (title, campaign_id, created_by) VALUES (%L, %L, %L)', 'x', ca, u));
  PERFORM pg_temp.must_fail('moving the campaign to another client''s', format('UPDATE tasks SET campaign_id = %L WHERE id = %L', cb, t1));
  PERFORM pg_temp.must_fail('shared task without client', format('INSERT INTO tasks (title, visible_to_client, created_by) VALUES (%L, true, %L)', 'x', u));
  PERFORM pg_temp.must_fail('empty title', format('INSERT INTO tasks (title, created_by) VALUES (%L, %L)', '', u));
  PERFORM pg_temp.must_fail('title with spaces around', format('INSERT INTO tasks (title, created_by) VALUES (%L, %L)', ' x ', u));
  PERFORM pg_temp.must_fail('title over 200 characters', format('INSERT INTO tasks (title, created_by) VALUES (%L, %L)', repeat('x', 201), u));
  PERFORM pg_temp.must_fail('description over 5000 characters', format('INSERT INTO tasks (title, description, created_by) VALUES (%L, %L, %L)', 'x', repeat('x', 5001), u));
  PERFORM pg_temp.must_fail('manual task without its author', 'INSERT INTO tasks (title) VALUES (''x'')');
  PERFORM pg_temp.must_fail('unknown priority', format('INSERT INTO tasks (title, priority, created_by) VALUES (%L, %L, %L)', 'x', 'URGENT', u));

  -- Completion time: set and cleared by the database
  PERFORM pg_temp.must_pass('completion time typed by hand on a TODO task...', format('UPDATE tasks SET completed_at = now() WHERE id = %L', t1));
  PERFORM pg_temp.check('...is replaced by the database (still empty)', (SELECT (completed_at IS NULL)::text FROM tasks WHERE id = t1), 'true');
  UPDATE tasks SET status = 'DONE' WHERE id = t1;
  SELECT completed_at INTO done_at FROM tasks WHERE id = t1;
  PERFORM pg_temp.check('DONE sets the completion time', (done_at IS NOT NULL)::text, 'true');
  UPDATE tasks SET title = 'New creatives v2' WHERE id = t1;
  PERFORM pg_temp.check('editing a done task keeps its completion time', ((SELECT completed_at FROM tasks WHERE id = t1) = done_at)::text, 'true');
  UPDATE tasks SET status = 'IN_PROGRESS' WHERE id = t1;
  PERFORM pg_temp.check('reopening clears the completion time', (SELECT (completed_at IS NULL)::text FROM tasks WHERE id = t1), 'true');
  PERFORM pg_temp.must_pass('cancel a task', format('UPDATE tasks SET status = %L WHERE id = %L', 'CANCELLED', t1));

  -- Origin never changes; nothing is deleted
  PERFORM pg_temp.must_fail('change the author', format('UPDATE tasks SET created_by = NULL WHERE id = %L', t1));
  PERFORM pg_temp.must_fail('change the creation time', format('UPDATE tasks SET created_at = created_at - interval ''1 day'' WHERE id = %L', t1));
  PERFORM pg_temp.must_fail('turn a manual task into a system task', format('UPDATE tasks SET source = %L, system_key = %L WHERE id = %L', 'SYSTEM', 'invoice-review:x', t1));
  PERFORM pg_temp.must_fail('delete a task (alaa_app)', format('DELETE FROM tasks WHERE id = %L', t1));

  -- System tasks: once per key, even when cancelled
  PERFORM pg_temp.must_pass('system task (no author)', format('INSERT INTO tasks (title, source, system_key, client_id) VALUES (%L, %L, %L, %L)', 'Review the invoice draft', 'SYSTEM', 'invoice-review:c8100000-0000-0000-0000-000000000001-2026-10', a));
  PERFORM pg_temp.must_fail('the same system key twice', format('INSERT INTO tasks (title, source, system_key) VALUES (%L, %L, %L)', 'again', 'SYSTEM', 'invoice-review:c8100000-0000-0000-0000-000000000001-2026-10'));
  PERFORM pg_temp.must_pass('... ON CONFLICT DO NOTHING makes it idempotent', format('INSERT INTO tasks (title, source, system_key) VALUES (%L, %L, %L) ON CONFLICT (system_key) DO NOTHING', 'again', 'SYSTEM', 'invoice-review:c8100000-0000-0000-0000-000000000001-2026-10'));
  PERFORM pg_temp.check('... still one task for that key', (SELECT count(*)::text FROM tasks WHERE system_key LIKE 'invoice-review:%'), '1');
  PERFORM pg_temp.must_fail('system task without key', format('INSERT INTO tasks (title, source) VALUES (%L, %L)', 'x', 'SYSTEM'));
  PERFORM pg_temp.must_fail('badly formed system key', format('INSERT INTO tasks (title, source, system_key) VALUES (%L, %L, %L)', 'x', 'SYSTEM', 'no key here'));

  -- Recurring rules
  PERFORM pg_temp.must_pass('weekly rule (Monday), due 2 days later', format('INSERT INTO task_recurrences (title, client_id, frequency, day_of_week, due_after_days, starts_on, created_by) VALUES (%L, %L, %L, 1, 2, %L, %L)', 'Weekly check', a, 'WEEKLY', '2026-11-01', u));
  SELECT id INTO r1 FROM task_recurrences WHERE title = 'Weekly check';
  PERFORM pg_temp.must_pass('monthly rule (day 28)', format('INSERT INTO task_recurrences (title, frequency, day_of_month, starts_on, created_by) VALUES (%L, %L, 28, %L, %L)', 'Monthly report', 'MONTHLY', '2026-11-01', u));
  PERFORM pg_temp.must_fail('monthly rule on day 31 (not every month has it)', format('INSERT INTO task_recurrences (title, frequency, day_of_month, starts_on, created_by) VALUES (%L, %L, 31, %L, %L)', 'x', 'MONTHLY', '2026-11-01', u));
  PERFORM pg_temp.must_fail('weekly rule without a day', format('INSERT INTO task_recurrences (title, frequency, starts_on, created_by) VALUES (%L, %L, %L, %L)', 'x', 'WEEKLY', '2026-11-01', u));
  PERFORM pg_temp.must_fail('weekly rule with a day of month', format('INSERT INTO task_recurrences (title, frequency, day_of_week, day_of_month, starts_on, created_by) VALUES (%L, %L, 1, 5, %L, %L)', 'x', 'WEEKLY', '2026-11-01', u));
  PERFORM pg_temp.must_fail('rule ending before it starts', format('INSERT INTO task_recurrences (title, frequency, day_of_week, starts_on, ends_on, created_by) VALUES (%L, %L, 1, %L, %L, %L)', 'x', 'WEEKLY', '2026-11-10', '2026-11-01', u));
  PERFORM pg_temp.must_fail('due more than 60 days later', format('INSERT INTO task_recurrences (title, frequency, day_of_week, due_after_days, starts_on, created_by) VALUES (%L, %L, 1, 61, %L, %L)', 'x', 'WEEKLY', '2026-11-01', u));
  PERFORM pg_temp.must_fail('rule with a campaign of another client', format('INSERT INTO task_recurrences (title, client_id, campaign_id, frequency, day_of_week, starts_on, created_by) VALUES (%L, %L, %L, %L, 1, %L, %L)', 'x', a, cb, 'WEEKLY', '2026-11-01', u));
  PERFORM pg_temp.must_pass('pause a rule', format('UPDATE task_recurrences SET paused_at = now() WHERE id = %L', r1));
  PERFORM pg_temp.must_fail('change the creator of a rule', format('UPDATE task_recurrences SET created_by = %L WHERE id = %L', '00000000-0000-0000-0000-000000000000', r1));
  PERFORM pg_temp.must_fail('delete a rule (alaa_app)', format('DELETE FROM task_recurrences WHERE id = %L', r1));

  -- Occurrences: once per rule and day
  PERFORM pg_temp.must_pass('occurrence of 2026-11-02', format('INSERT INTO tasks (title, source, recurrence_id, occurrence_on, client_id) VALUES (%L, %L, %L, %L, %L)', 'Weekly check', 'RECURRING', r1, '2026-11-02', a));
  SELECT id INTO t2 FROM tasks WHERE recurrence_id = r1;
  PERFORM pg_temp.must_fail('the same occurrence twice', format('INSERT INTO tasks (title, source, recurrence_id, occurrence_on) VALUES (%L, %L, %L, %L)', 'Weekly check', 'RECURRING', r1, '2026-11-02'));
  PERFORM pg_temp.must_fail('recurring task without its day', format('INSERT INTO tasks (title, source, recurrence_id) VALUES (%L, %L, %L)', 'x', 'RECURRING', r1));
  PERFORM pg_temp.must_fail('move an occurrence to another day', format('UPDATE tasks SET occurrence_on = %L WHERE id = %L', '2026-11-09', t2));
  PERFORM pg_temp.must_fail('a rule in use cannot lose its tasks (no delete)', format('DELETE FROM tasks WHERE id = %L', t2));

  -- Comments: internal, never changed nor deleted
  PERFORM pg_temp.must_pass('comment on a task', format('INSERT INTO task_comments (task_id, author_id, body) VALUES (%L, %L, %L)', t2, u, 'Done for this week'));
  SELECT id INTO c1 FROM task_comments WHERE task_id = t2;
  PERFORM pg_temp.must_fail('empty comment', format('INSERT INTO task_comments (task_id, author_id, body) VALUES (%L, %L, %L)', t2, u, '   '));
  PERFORM pg_temp.must_fail('comment over 5000 characters', format('INSERT INTO task_comments (task_id, author_id, body) VALUES (%L, %L, %L)', t2, u, repeat('x', 5001)));
  PERFORM pg_temp.must_fail('comment without author', format('INSERT INTO task_comments (task_id, body) VALUES (%L, %L)', t2, 'x'));
  PERFORM pg_temp.must_fail('edit a comment (alaa_app)', format('UPDATE task_comments SET body = %L WHERE id = %L', 'changed', c1));
  PERFORM pg_temp.must_fail('delete a comment (alaa_app)', format('DELETE FROM task_comments WHERE id = %L', c1));
  INSERT INTO task_comments (task_id, author_id, body, created_at) VALUES (t2, u, 'backdated', '2020-01-01');
  PERFORM pg_temp.check('a backdated comment gets the database time', (SELECT (created_at > now() - interval '1 hour')::text FROM task_comments WHERE body = 'backdated'), 'true');

  -- Referenced rows cannot disappear
  PERFORM pg_temp.must_fail('delete a client that has tasks (alaa_app)', format('DELETE FROM clients WHERE id = %L', a));
END $$;
-- @@
SELECT n, label, ok, detail FROM results ORDER BY n;
