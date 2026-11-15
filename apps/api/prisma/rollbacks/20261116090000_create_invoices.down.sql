-- ROLLBACK for migration 20261116090000_create_invoices
--
-- DELETES EVERY INVOICE, PAYMENT AND INVOICE NUMBER COUNTER. Touches nothing
-- else (fee plans, campaigns, clients... are not read nor changed).
-- Never run automatically on a real database (development or production).
-- It runs automatically ONLY in the rollback test, on alaa_ad_manager_test.
-- Manual use on any other database requires the project owner's approval.

DROP TABLE "payments";
DROP FUNCTION "payments_guard"();
DROP TABLE "invoices";
DROP FUNCTION "invoices_guard"();
DROP FUNCTION "next_invoice_number"(INTEGER);
DROP TABLE "invoice_number_counters";
DROP TYPE "payment_method";
DROP TYPE "invoice_status";

-- Forget that the migration was applied, so "prisma migrate deploy" can apply it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261116090000_create_invoices';
