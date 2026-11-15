-- Database checks of the invoices and payments (step 6.1, ADR 0020): the 58
-- checks reviewed with the project owner. Run by invoices.database.db-spec.ts
-- as alaa_app, inside ONE transaction that is rolled back at the end.
-- Statements are separated by a line "-- @@".
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
INSERT INTO clients (id, name, updated_at) VALUES
  ('b0000000-0000-0000-0000-000000000001','Invoice A', now()),
  ('b0000000-0000-0000-0000-000000000002','Invoice B', now());
-- @@
DO $$
DECLARE
  today date := (now() AT TIME ZONE 'UTC')::date;
  this_month date := date_trunc('month', (now() AT TIME ZONE 'UTC'))::date;
  m1 date := (date_trunc('month', (now() AT TIME ZONE 'UTC')) - interval '1 month')::date;
  m2 date := (date_trunc('month', (now() AT TIME ZONE 'UTC')) - interval '2 months')::date;
  m3 date := (date_trunc('month', (now() AT TIME ZONE 'UTC')) - interval '3 months')::date;
  m4 date := (date_trunc('month', (now() AT TIME ZONE 'UTC')) - interval '4 months')::date;
  a uuid := 'b0000000-0000-0000-0000-000000000001'; b uuid := 'b0000000-0000-0000-0000-000000000002';
  pa uuid; pb uuid; inv1 uuid; inv2 uuid; inv3 uuid; inv4 uuid; pay1 uuid; pay2 uuid; pay3 uuid;
  y text := EXTRACT(YEAR FROM (now() AT TIME ZONE 'UTC'))::text;
  ins text := 'INSERT INTO invoices (client_id, fee_plan_id, period_month, currency, spend_minor, fixed_fee_minor, percent_basis_points, minimum_fee_minor, variable_fee_minor, total_minor%s) VALUES (%L,%L,%L,%L,%s,%s,%s,%s,%s,%s%s)';
  first_number text; second_number text;
BEGIN
  -- Plans: A = 100.00 + 10%, minimum 300.00 (USD), from 3 months ago. B = 50.00 fixed.
  INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, percent_basis_points, minimum_fee_minor, starts_on)
    VALUES (a, 'USD', 10000, 1000, 30000, m3) RETURNING id INTO pa;
  INSERT INTO fee_plans (client_id, currency, fixed_fee_minor, starts_on) VALUES (b, 'USD', 5000, m3) RETURNING id INTO pb;

  -- Drafts: amounts must equal the fee formula and copy the plan.
  PERFORM pg_temp.must_pass('draft for last month, spend 1500.00 -> 100 + 150 = 250 -> minimum 300.00',
    format(ins, '', a, pa, m1, 'USD', 150000, 10000, 1000, 30000, 15000, 30000, ''));
  SELECT id INTO inv1 FROM invoices WHERE client_id = a AND period_month = m1;
  PERFORM pg_temp.must_fail('wrong total (typed by hand)', format(ins, '', a, pa, m2, 'USD', 150000, 10000, 1000, 30000, 15000, 25000, ''));
  PERFORM pg_temp.must_fail('wrong variable part', format(ins, '', a, pa, m2, 'USD', 150000, 10000, 1000, 30000, 15001, 30000, ''));
  PERFORM pg_temp.must_fail('invoice for the current month (not over)', format(ins, '', a, pa, this_month, 'USD', 0, 10000, 1000, 30000, 0, 30000, ''));
  PERFORM pg_temp.must_fail('a new invoice that is not a draft', format(ins, ', status', a, pa, m2, 'USD', 0, 10000, 1000, 30000, 0, 30000, ', ''ISSUED'''));
  PERFORM pg_temp.must_fail('second invoice for the same client and month', format(ins, '', a, pa, m1, 'USD', 0, 10000, 1000, 30000, 0, 30000, ''));
  PERFORM pg_temp.must_fail('the fee plan of ANOTHER client', format(ins, '', a, pb, m2, 'USD', 0, 5000, 0, 'NULL', 0, 5000, ''));
  PERFORM pg_temp.must_fail('terms different from the plan', format(ins, '', a, pa, m2, 'USD', 0, 9000, 1000, 30000, 0, 30000, ''));
  PERFORM pg_temp.must_fail('currency different from the plan', format(ins, '', a, pa, m2, 'EUR', 0, 10000, 1000, 30000, 0, 30000, ''));
  PERFORM pg_temp.must_fail('a month before the plan started', format(ins, '', a, pa, m4, 'USD', 0, 10000, 1000, 30000, 0, 30000, ''));
  PERFORM pg_temp.must_fail('a draft with a due date', format(ins, ', due_on', a, pa, m2, 'USD', 0, 10000, 1000, 30000, 0, 30000, format(', %L', today)));

  -- Draft: may be refreshed (new spend), never numbered by the application.
  PERFORM pg_temp.must_pass('refresh a draft (spend 5000.00 -> 100 + 500 = 600.00)',
    format('UPDATE invoices SET spend_minor = 500000, variable_fee_minor = 50000, total_minor = 60000 WHERE id = %L', inv1));
  PERFORM pg_temp.must_fail('refresh with a wrong total', format('UPDATE invoices SET spend_minor = 0 WHERE id = %L', inv1));
  PERFORM pg_temp.must_fail('the application writes a number', format($q$UPDATE invoices SET number = 'AMG-2026-9999' WHERE id = %L$q$, inv1));
  PERFORM pg_temp.must_fail('the application issues with its own number', format($q$UPDATE invoices SET status = 'ISSUED', number = 'AMG-2026-0500' WHERE id = %L$q$, inv1));
  PERFORM pg_temp.must_fail('issue with a due date in the past', format('UPDATE invoices SET status = ''ISSUED'', due_on = %L WHERE id = %L', today - 1, inv1));

  -- Issue: the database sets the number, the date and the due date (+14 days).
  PERFORM pg_temp.must_pass('issue the draft', format('UPDATE invoices SET status = ''ISSUED'' WHERE id = %L', inv1));
  SELECT number INTO first_number FROM invoices WHERE id = inv1;
  PERFORM pg_temp.check('number format AMG-YYYY-NNNN', (first_number ~ ('^AMG-' || y || '-[0-9]{4}$'))::text, 'true');
  PERFORM pg_temp.check('due date = issue day + 14', (SELECT (due_on - (issued_at AT TIME ZONE 'UTC')::date)::text FROM invoices WHERE id = inv1), '14');

  INSERT INTO invoices (client_id, fee_plan_id, period_month, currency, spend_minor, fixed_fee_minor, percent_basis_points, minimum_fee_minor, variable_fee_minor, total_minor)
    VALUES (b, pb, m1, 'USD', 0, 5000, 0, NULL, 0, 5000) RETURNING id INTO inv2;
  -- A failed issue does not use a number (no gap).
  BEGIN
    UPDATE invoices SET status = 'ISSUED' WHERE id = inv2;
    RAISE EXCEPTION 'simulated failure after issuing';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  UPDATE invoices SET status = 'ISSUED', due_on = today + 30 WHERE id = inv2;
  SELECT number INTO second_number FROM invoices WHERE id = inv2;
  PERFORM pg_temp.check('next number follows, even after a failed issue (no gap)',
    (split_part(second_number, '-', 3)::int - split_part(first_number, '-', 3)::int)::text, '1');
  PERFORM pg_temp.check('a chosen due date is kept', (SELECT (due_on - today)::text FROM invoices WHERE id = inv2), '30');

  -- Numbers are protected from the application.
  PERFORM pg_temp.must_fail('the application reads the counters', 'SELECT * FROM invoice_number_counters');
  PERFORM pg_temp.must_fail('the application changes the counters', 'UPDATE invoice_number_counters SET last_number = 0');
  PERFORM pg_temp.must_fail('the application calls next_invoice_number', 'SELECT next_invoice_number(2026)');

  -- An issued invoice never changes.
  PERFORM pg_temp.must_fail('change an issued amount', format('UPDATE invoices SET spend_minor = 0, variable_fee_minor = 0, total_minor = 30000 WHERE id = %L', inv1));
  PERFORM pg_temp.must_fail('change the notes of an issued invoice', format($q$UPDATE invoices SET notes = 'x' WHERE id = %L$q$, inv1));
  PERFORM pg_temp.must_fail('change the due date of an issued invoice', format('UPDATE invoices SET due_on = due_on + 1 WHERE id = %L', inv1));
  PERFORM pg_temp.must_fail('back to draft', format($q$UPDATE invoices SET status = 'DRAFT', number = NULL, issued_at = NULL, due_on = NULL WHERE id = %L$q$, inv1));

  -- Payments: partial, never above the total (600.00).
  INSERT INTO invoices (client_id, fee_plan_id, period_month, currency, spend_minor, fixed_fee_minor, percent_basis_points, minimum_fee_minor, variable_fee_minor, total_minor)
    VALUES (a, pa, m2, 'USD', 0, 10000, 1000, 30000, 0, 30000) RETURNING id INTO inv3;
  PERFORM pg_temp.must_fail('payment on a draft', format($q$INSERT INTO payments (invoice_id, amount_minor, paid_on, method) VALUES (%L, 100, %L, 'CASH')$q$, inv3, today));
  PERFORM pg_temp.must_pass('partial payment 100.00', format($q$INSERT INTO payments (invoice_id, amount_minor, paid_on, method, reference) VALUES (%L, 10000, %L, 'BANK_TRANSFER', 'TRX-1')$q$, inv1, today));
  PERFORM pg_temp.must_pass('partial payment 450.00 (550.00 of 600.00)', format($q$INSERT INTO payments (invoice_id, amount_minor, paid_on, method) VALUES (%L, 45000, %L, 'CARD')$q$, inv1, today));
  PERFORM pg_temp.must_fail('payment above what is left (60.00 > 50.00)', format($q$INSERT INTO payments (invoice_id, amount_minor, paid_on, method) VALUES (%L, 6000, %L, 'CASH')$q$, inv1, today));
  PERFORM pg_temp.must_pass('last payment 50.00: fully paid', format($q$INSERT INTO payments (invoice_id, amount_minor, paid_on, method) VALUES (%L, 5000, %L, 'CASH')$q$, inv1, today));
  PERFORM pg_temp.check('paid = total', (SELECT (SUM(amount_minor) = 60000)::text FROM payments WHERE invoice_id = inv1 AND voided_at IS NULL), 'true');
  PERFORM pg_temp.must_fail('payment of 0', format($q$INSERT INTO payments (invoice_id, amount_minor, paid_on, method) VALUES (%L, 0, %L, 'CASH')$q$, inv2, today));
  PERFORM pg_temp.must_fail('negative payment', format($q$INSERT INTO payments (invoice_id, amount_minor, paid_on, method) VALUES (%L, -100, %L, 'CASH')$q$, inv2, today));
  PERFORM pg_temp.must_fail('payment dated in the future', format($q$INSERT INTO payments (invoice_id, amount_minor, paid_on, method) VALUES (%L, 100, %L, 'CASH')$q$, inv2, today + 5));
  PERFORM pg_temp.must_fail('unknown payment method', format($q$INSERT INTO payments (invoice_id, amount_minor, paid_on, method) VALUES (%L, 100, %L, 'CHEQUE')$q$, inv2, today));

  -- A payment never changes; it is voided with a reason.
  SELECT id INTO pay1 FROM payments WHERE invoice_id = inv1 AND reference = 'TRX-1';
  PERFORM pg_temp.must_fail('change a payment amount', format('UPDATE payments SET amount_minor = 1 WHERE id = %L', pay1));
  PERFORM pg_temp.must_fail('void a payment without a reason', format('UPDATE payments SET voided_at = now() WHERE id = %L', pay1));
  PERFORM pg_temp.must_pass('void a payment with a reason', format($q$UPDATE payments SET voided_at = now(), void_reason = 'wrong client' WHERE id = %L$q$, pay1));
  PERFORM pg_temp.must_fail('void a payment twice', format($q$UPDATE payments SET void_reason = 'again' WHERE id = %L$q$, pay1));
  PERFORM pg_temp.must_pass('a voided payment frees its amount (100.00 again)', format($q$INSERT INTO payments (invoice_id, amount_minor, paid_on, method) VALUES (%L, 10000, %L, 'CASH')$q$, inv1, today));

  -- Voiding an invoice: never with live payments; keeps its number; final.
  PERFORM pg_temp.must_fail('void an invoice that has payments', format($q$UPDATE invoices SET status = 'VOID', void_reason = 'error' WHERE id = %L$q$, inv1));
  UPDATE payments SET voided_at = now(), void_reason = 'refund' WHERE invoice_id = inv1 AND voided_at IS NULL;
  PERFORM pg_temp.must_fail('void without a reason', format($q$UPDATE invoices SET status = 'VOID' WHERE id = %L$q$, inv1));
  PERFORM pg_temp.must_pass('void the invoice once its payments are voided', format($q$UPDATE invoices SET status = 'VOID', void_reason = 'wrong spend' WHERE id = %L$q$, inv1));
  PERFORM pg_temp.check('a voided invoice keeps its number', (SELECT number FROM invoices WHERE id = inv1), first_number);
  PERFORM pg_temp.must_fail('a voided invoice cannot change', format($q$UPDATE invoices SET notes = 'x' WHERE id = %L$q$, inv1));
  PERFORM pg_temp.must_fail('a voided invoice cannot come back', format($q$UPDATE invoices SET status = 'ISSUED' WHERE id = %L$q$, inv1));

  -- A replacement invoice for the same month gets a NEW number.
  PERFORM pg_temp.must_pass('new draft for the month of the voided invoice',
    format(ins, '', a, pa, m1, 'USD', 150000, 10000, 1000, 30000, 15000, 30000, ''));
  SELECT id INTO inv4 FROM invoices WHERE client_id = a AND period_month = m1 AND status = 'DRAFT';
  UPDATE invoices SET status = 'ISSUED' WHERE id = inv4;
  PERFORM pg_temp.check('the replacement takes the next number (never reused)',
    (split_part((SELECT number FROM invoices WHERE id = inv4), '-', 3)::int - split_part(second_number, '-', 3)::int)::text, '1');

  -- Discarding a draft = void with a reason (no deletion, no number).
  PERFORM pg_temp.must_pass('discard a draft (void, no number)', format($q$UPDATE invoices SET status = 'VOID', void_reason = 'not needed' WHERE id = %L$q$, inv3));
  PERFORM pg_temp.check('a discarded draft has no number', (SELECT coalesce(number, 'none') FROM invoices WHERE id = inv3), 'none');

  -- Nothing is ever deleted.
  PERFORM pg_temp.must_fail('DELETE an invoice', format('DELETE FROM invoices WHERE id = %L', inv3));
  PERFORM pg_temp.must_fail('DELETE a payment', format('DELETE FROM payments WHERE id = %L', pay1));
  PERFORM pg_temp.must_fail('TRUNCATE invoices', 'TRUNCATE invoices CASCADE');
  PERFORM pg_temp.must_fail('TRUNCATE payments', 'TRUNCATE payments');
  PERFORM pg_temp.must_fail('DELETE the fee plan of an invoice', format('DELETE FROM fee_plans WHERE id = %L', pa));
END $$;
