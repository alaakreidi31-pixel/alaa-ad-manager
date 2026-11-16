-- ROLLBACK for migration 20261116150000_create_notifications
--
-- DELETES EVERY NOTIFICATION. Touches nothing else (users, clients, invoices,
-- tasks... are not read nor changed).
-- Never run automatically on a real database (development or production).
-- It runs automatically ONLY in the rollback test, on alaa_ad_manager_test.
-- Manual use on any other database requires the project owner's approval.

DROP TABLE "notifications";
DROP FUNCTION "notifications_guard"();

-- Forget that the migration was applied, so "prisma migrate deploy" can apply it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261116150000_create_notifications';
