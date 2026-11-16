-- Database checks of the notifications (step 9.1, ADR 0023). Run by
-- notifications.database.db-spec.ts as alaa_app, inside ONE transaction that
-- is rolled back at the end. Statements are separated by a line "-- @@".
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
  ('c9000000-0000-0000-0000-000000000001', 'notify-check@alaa.test', 'Notify Check', 'x', 'SUPER_ADMIN', now());
-- @@
DO $$
DECLARE
  u uuid := 'c9000000-0000-0000-0000-000000000001';
  n1 uuid; first_read timestamptz;
  ins text := 'INSERT INTO notifications (user_id, kind, params, link, dedupe_key) VALUES (%L, %L, %L, %L, %L)';
BEGIN
  PERFORM pg_temp.must_pass('notification with params and an inside link', format(ins, u, 'invoice.issued', '{"number":"AMG-2026-0001"}', '/invoices/x', NULL));
  SELECT id INTO n1 FROM notifications WHERE user_id = u AND kind = 'invoice.issued';
  PERFORM pg_temp.check('a new notification is unread', (SELECT (read_at IS NULL)::text FROM notifications WHERE id = n1), 'true');
  PERFORM pg_temp.must_pass('notification without link', format(ins, u, 'security.account_locked', '{}', NULL, NULL));
  PERFORM pg_temp.must_fail('kind that is not a code', format(ins, u, 'Invoice issued!', '{}', NULL, NULL));
  PERFORM pg_temp.must_fail('params that are not an object', format(ins, u, 'invoice.issued', '[1,2]', NULL, NULL));
  PERFORM pg_temp.must_fail('params over 2000 characters', format(ins, u, 'invoice.issued', json_build_object('x', repeat('a', 2000))::text, NULL, NULL));
  PERFORM pg_temp.must_fail('link to an outside site', format(ins, u, 'invoice.issued', '{}', 'https://evil.example', NULL));
  PERFORM pg_temp.must_fail('link starting with //', format(ins, u, 'invoice.issued', '{}', '//evil.example', NULL));
  PERFORM pg_temp.must_fail('link with a script', format(ins, u, 'invoice.issued', '{}', '/x"><script>', NULL));
  PERFORM pg_temp.must_fail('unknown user', format(ins, '00000000-0000-0000-0000-000000000000', 'invoice.issued', '{}', NULL, NULL));

  -- Repeated events: once per user and key
  PERFORM pg_temp.must_pass('overdue invoice, first time', format(ins, u, 'invoice.overdue', '{}', '/admin/invoices/x', 'invoice-overdue:x'));
  PERFORM pg_temp.must_fail('the same key again', format(ins, u, 'invoice.overdue', '{}', '/admin/invoices/x', 'invoice-overdue:x'));
  PERFORM pg_temp.must_pass('... ON CONFLICT DO NOTHING is idempotent', format(ins || ' ON CONFLICT (user_id, dedupe_key) DO NOTHING', u, 'invoice.overdue', '{}', '/admin/invoices/x', 'invoice-overdue:x'));
  PERFORM pg_temp.check('... still one', (SELECT count(*)::text FROM notifications WHERE dedupe_key = 'invoice-overdue:x'), '1');

  -- Reading: the database sets the time, once
  PERFORM pg_temp.must_pass('mark as read', format('UPDATE notifications SET read_at = %L WHERE id = %L', '2020-01-01', n1));
  SELECT read_at INTO first_read FROM notifications WHERE id = n1;
  PERFORM pg_temp.check('the read time is the database''s, not the typed one', (first_read > now() - interval '1 hour')::text, 'true');
  PERFORM pg_temp.must_pass('mark as unread is ignored', format('UPDATE notifications SET read_at = NULL WHERE id = %L', n1));
  PERFORM pg_temp.check('... still read, same time', ((SELECT read_at FROM notifications WHERE id = n1) = first_read)::text, 'true');
  PERFORM pg_temp.must_fail('change the text values', format('UPDATE notifications SET params = %L WHERE id = %L', '{"number":"FAKE"}', n1));
  PERFORM pg_temp.must_fail('give it to another user', format('UPDATE notifications SET user_id = %L WHERE id = %L', '00000000-0000-0000-0000-000000000000', n1));
  PERFORM pg_temp.must_fail('change the link', format('UPDATE notifications SET link = %L WHERE id = %L', '/admin', n1));
  PERFORM pg_temp.must_fail('backdate it', format('UPDATE notifications SET created_at = created_at - interval ''1 day'' WHERE id = %L', n1));
  PERFORM pg_temp.must_fail('delete it (alaa_app)', format('DELETE FROM notifications WHERE id = %L', n1));
END $$;
-- @@
SELECT n, label, ok, detail FROM results ORDER BY n;
