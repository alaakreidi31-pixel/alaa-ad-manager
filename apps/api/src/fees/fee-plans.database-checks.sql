-- Database checks of the fee plans (step 5.1, ADR 0019): the 63 checks
-- reviewed with the project owner. Run by fee-plans.database.db-spec.ts as
-- alaa_app, inside ONE transaction that is rolled back at the end.
-- Statements are separated by a line "-- @@".
CREATE TEMP TABLE results (n serial, label text, ok boolean, detail text);
-- @@
-- Runs a statement that MUST fail; records which error PostgreSQL gave.
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
-- Months relative to today (UTC), so the tests work on any date.
CREATE TEMP TABLE m AS SELECT
  date_trunc('month', CURRENT_DATE)::date AS this_month,
  (date_trunc('month', CURRENT_DATE) - interval '3 months')::date AS three_ago,
  (date_trunc('month', CURRENT_DATE) - interval '1 day')::date AS end_last_month,
  (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date AS end_this_month,
  (date_trunc('month', CURRENT_DATE) + interval '1 month')::date AS next_month,
  (date_trunc('month', CURRENT_DATE) + interval '2 months')::date AS in_two_months;
-- @@
-- Fresh test clients (the application can create clients).
INSERT INTO clients (id, name, updated_at) VALUES
  ('a0000000-0000-0000-0000-000000000001','Fee A', now()),
  ('a0000000-0000-0000-0000-000000000002','Fee B', now()),
  ('a0000000-0000-0000-0000-000000000003','Fee C', now()),
  ('a0000000-0000-0000-0000-000000000004','Fee D', now());
-- @@
DO $$
DECLARE r m%ROWTYPE; a uuid := 'a0000000-0000-0000-0000-000000000001'; b uuid := 'a0000000-0000-0000-0000-000000000002';
  c uuid := 'a0000000-0000-0000-0000-000000000003'; d uuid := 'a0000000-0000-0000-0000-000000000004';
  p1 uuid; p2 uuid; fut uuid; t1 timestamptz; t2 timestamptz;
BEGIN
  SELECT * INTO r FROM m;

  -- History: the FIRST plan of a client may start in a past month.
  PERFORM pg_temp.must_pass('first plan may start 3 months ago',
    format($q$INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, percent_basis_points, starts_on) VALUES (%L,'USD',10000,1000,%L)$q$, a, r.three_ago));
  SELECT id, updated_at INTO p1, t1 FROM fee_plans WHERE client_id = a;

  -- Overlap (exclusion constraint).
  PERFORM pg_temp.must_fail('overlapping plan for the same client',
    format($q$INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, starts_on) VALUES (%L,'USD',500,%L)$q$, a, r.next_month));
  PERFORM pg_temp.must_pass('same months for ANOTHER client',
    format($q$INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, starts_on) VALUES (%L,'USD',500,%L)$q$, b, r.three_ago));
  PERFORM pg_temp.must_fail('second plan starting in a past month',
    format($q$INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, starts_on, ends_on) VALUES (%L,'USD',500,%L,%L)$q$, b, (r.three_ago - interval '2 months')::date, (r.three_ago - interval '1 day')::date));

  -- Immutable terms.
  PERFORM pg_temp.must_fail('change the fixed fee', format('UPDATE fee_plans SET fixed_fee_minor = 1 WHERE id = %L', p1));
  PERFORM pg_temp.must_fail('change the percentage', format('UPDATE fee_plans SET percent_basis_points = 1 WHERE id = %L', p1));
  PERFORM pg_temp.must_fail('change the minimum', format('UPDATE fee_plans SET minimum_fee_minor = 1 WHERE id = %L', p1));
  PERFORM pg_temp.must_fail('change the currency', format($q$UPDATE fee_plans SET currency = 'EUR' WHERE id = %L$q$, p1));
  PERFORM pg_temp.must_fail('change the start month', format('UPDATE fee_plans SET starts_on = %L WHERE id = %L', r.this_month, p1));
  PERFORM pg_temp.must_fail('move the plan to another client', format('UPDATE fee_plans SET client_id = %L WHERE id = %L', c, p1));

  -- Closing: a change during a month applies from the NEXT month.
  PERFORM pg_temp.must_fail('close in a past month', format('UPDATE fee_plans SET ends_on = %L WHERE id = %L', r.end_last_month, p1));
  PERFORM pg_temp.must_fail('close on a day that is not a month end', format('UPDATE fee_plans SET ends_on = %L WHERE id = %L', r.this_month + 9, p1));
  PERFORM pg_temp.must_pass('close at the end of the current month', format('UPDATE fee_plans SET ends_on = %L WHERE id = %L', r.end_this_month, p1));
  SELECT updated_at INTO t2 FROM fee_plans WHERE id = p1;
  PERFORM pg_temp.check('updated_at refreshed by the database on close', (t2 >= t1)::text, 'true');
  PERFORM pg_temp.must_pass('new plan from next month',
    format($q$INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, percent_basis_points, minimum_fee_minor, starts_on) VALUES (%L,'USD',0,750,30000,%L)$q$, a, r.next_month));
  PERFORM pg_temp.must_fail('reopen a closed plan', format('UPDATE fee_plans SET ends_on = NULL WHERE id = %L', p1));
  PERFORM pg_temp.must_fail('move the end of a closed plan', format('UPDATE fee_plans SET ends_on = %L WHERE id = %L', (r.end_this_month + interval '1 month')::date, p1));

  -- Future plans: cancel (once) instead of delete.
  SELECT id INTO fut FROM fee_plans WHERE client_id = a AND starts_on = r.next_month;
  PERFORM pg_temp.must_fail('cancel a plan that has started', format('UPDATE fee_plans SET cancelled_at = now() WHERE id = %L', p1));
  PERFORM pg_temp.must_pass('cancel a plan that has not started', format('UPDATE fee_plans SET cancelled_at = now() WHERE id = %L', fut));
  PERFORM pg_temp.must_fail('cancel twice / un-cancel', format('UPDATE fee_plans SET cancelled_at = NULL WHERE id = %L', fut));
  PERFORM pg_temp.must_pass('a cancelled plan does not block the same months',
    format($q$INSERT INTO fee_plans (client_id, currency, percent_basis_points, starts_on) VALUES (%L,'USD',1000,%L)$q$, a, r.next_month));
  PERFORM pg_temp.must_fail('insert a plan already cancelled',
    format($q$INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, starts_on, cancelled_at) VALUES (%L,'USD',1,%L, now())$q$, c, r.next_month));
  PERFORM pg_temp.must_pass('forged created_at is replaced by the database',
    format($q$INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, starts_on, created_at) VALUES (%L,'USD',1,%L,'2000-01-01')$q$, c, r.this_month));
  PERFORM pg_temp.check('created_at set by the database',
    (SELECT (created_at > '2020-01-01')::text FROM fee_plans WHERE client_id = c), 'true');

  -- Values and months.
  PERFORM pg_temp.must_fail('start on a day that is not the 1st', format($q$INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, starts_on) VALUES (%L,'USD',1,%L)$q$, d, r.next_month + 4));
  PERFORM pg_temp.must_fail('plan with no fixed fee and no percentage', format($q$INSERT INTO fee_plans (client_id, currency, starts_on) VALUES (%L,'USD',%L)$q$, d, r.next_month));
  PERFORM pg_temp.must_fail('percentage above 100%%', format($q$INSERT INTO fee_plans (client_id, currency, percent_basis_points, starts_on) VALUES (%L,'USD',10001,%L)$q$, d, r.next_month));
  PERFORM pg_temp.must_fail('negative fixed fee', format($q$INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, percent_basis_points, starts_on) VALUES (%L,'USD',-1,100,%L)$q$, d, r.next_month));
  PERFORM pg_temp.must_fail('negative minimum', format($q$INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, minimum_fee_minor, starts_on) VALUES (%L,'USD',1,-1,%L)$q$, d, r.next_month));
  PERFORM pg_temp.must_fail('currency XYZ (not ISO 4217)', format($q$INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, starts_on) VALUES (%L,'XYZ',1,%L)$q$, d, r.next_month));
  PERFORM pg_temp.must_fail('currency HRK (superseded)', format($q$INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, starts_on) VALUES (%L,'HRK',1,%L)$q$, d, r.next_month));

  -- No deletion; the currency list is read only for the application.
  PERFORM pg_temp.must_fail('DELETE a fee plan', format('DELETE FROM fee_plans WHERE id = %L', p1));
  PERFORM pg_temp.must_fail('TRUNCATE fee_plans', 'TRUNCATE fee_plans');
  PERFORM pg_temp.must_fail('the application adds a currency', $q$INSERT INTO currencies VALUES ('ABC', 2)$q$);
  PERFORM pg_temp.must_fail('the application changes a currency', $q$UPDATE currencies SET minor_units = 3 WHERE code = 'USD'$q$);
  PERFORM pg_temp.must_fail('the application deletes a currency', $q$DELETE FROM currencies WHERE code = 'USD'$q$);
END $$;
-- @@
-- monthly_fee_minor: rounding (half up), zero spend, minimum on the TOTAL.
SELECT pg_temp.check('7.5% of 1333 cents = 99.975 -> 100', monthly_fee_minor(1333, 0, 750, NULL)::text, '100');
-- @@
SELECT pg_temp.check('99.4 -> 99 (down)', monthly_fee_minor(994, 0, 1000, NULL)::text, '99');
-- @@
SELECT pg_temp.check('exactly .5 -> up (12.5 -> 13)', monthly_fee_minor(125, 0, 1000, NULL)::text, '13');
-- @@
SELECT pg_temp.check('0.01% of 4999 = 0.4999 -> 0', monthly_fee_minor(4999, 0, 1, NULL)::text, '0');
-- @@
SELECT pg_temp.check('0.01% of 5000 = 0.5 -> 1', monthly_fee_minor(5000, 0, 1, NULL)::text, '1');
-- @@
SELECT pg_temp.check('100% of the spend', monthly_fee_minor(123456, 0, 10000, NULL)::text, '123456');
-- @@
SELECT pg_temp.check('fixed 100.00 + 10% of 1500.00 = 250.00', monthly_fee_minor(150000, 10000, 1000, NULL)::text, '25000');
-- @@
SELECT pg_temp.check('same with minimum 300.00 -> 300.00 (minimum on the total)', monthly_fee_minor(150000, 10000, 1000, 30000)::text, '30000');
-- @@
SELECT pg_temp.check('total above the minimum is kept', monthly_fee_minor(500000, 10000, 1000, 30000)::text, '60000');
-- @@
SELECT pg_temp.check('zero spend: fixed only', monthly_fee_minor(0, 10000, 1000, NULL)::text, '10000');
-- @@
SELECT pg_temp.check('zero spend: minimum applies', monthly_fee_minor(0, 10000, 1000, 30000)::text, '30000');
-- @@
SELECT pg_temp.check('zero spend, percentage only, no minimum = 0', monthly_fee_minor(0, 0, 1000, NULL)::text, '0');
-- @@
SELECT pg_temp.check('JPY (0 decimals): 7.5% of 1333 yen = 99.975 -> 100 yen', monthly_fee_minor(1333, 0, 750, NULL)::text, '100');
-- @@
SELECT pg_temp.check('KWD (3 decimals): 7.5% of 1.333 KWD (1333 fils) -> 100 fils', monthly_fee_minor(1333, 0, 750, NULL)::text, '100');
-- @@
SELECT pg_temp.check('huge spend (sum above BIGINT): 1% of 999999999999999999.99 = 9999999999999999.9999 -> exact',
  monthly_fee_minor(99999999999999999999::numeric, 0, 100, NULL)::text, '1000000000000000000');
-- @@
SELECT pg_temp.check('largest possible fee', monthly_fee_minor(0, 9223372036854775807, 0, NULL)::text, '9223372036854775807');
-- @@
SELECT pg_temp.must_fail('fee above BIGINT is an ERROR, never a wrong number', 'SELECT monthly_fee_minor(0, 9223372036854775807, 1, NULL) + monthly_fee_minor(10000, 9223372036854775807, 1, NULL)');
-- @@
SELECT pg_temp.must_fail('overflow inside the function', 'SELECT monthly_fee_minor(10000, 9223372036854775807, 10000, NULL)');
-- @@
SELECT pg_temp.must_fail('NULL spend', 'SELECT monthly_fee_minor(NULL, 0, 100, NULL)');
-- @@
SELECT pg_temp.must_fail('NULL fixed fee', 'SELECT monthly_fee_minor(100, NULL, 100, NULL)');
-- @@
SELECT pg_temp.must_fail('NULL percentage', 'SELECT monthly_fee_minor(100, 0, NULL, NULL)');
-- @@
SELECT pg_temp.must_fail('negative spend', 'SELECT monthly_fee_minor(-1, 0, 100, NULL)');
-- @@
SELECT pg_temp.must_fail('spend with a fraction of a minor unit', 'SELECT monthly_fee_minor(10.5, 0, 100, NULL)');
-- @@
SELECT pg_temp.must_fail('negative fixed fee', 'SELECT monthly_fee_minor(100, -1, 100, NULL)');
-- @@
SELECT pg_temp.must_fail('percentage above 10000', 'SELECT monthly_fee_minor(100, 0, 10001, NULL)');
-- @@
SELECT pg_temp.must_fail('negative percentage', 'SELECT monthly_fee_minor(100, 0, -1, NULL)');
-- @@
SELECT pg_temp.must_fail('negative minimum', 'SELECT monthly_fee_minor(100, 0, 100, -1)');
