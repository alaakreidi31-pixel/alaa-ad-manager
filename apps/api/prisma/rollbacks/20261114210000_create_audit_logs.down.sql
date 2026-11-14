-- ROLLBACK for migration 20261114210000_create_audit_logs
--
-- DELETES THE WHOLE AUDIT HISTORY.
-- Never run automatically on a real database (development or production).
-- It runs automatically ONLY in the rollback test, on alaa_ad_manager_test.
-- Manual use on any other database requires the project owner's approval.

DROP TABLE "audit_logs";

-- Forget that the migration was applied, so "prisma migrate deploy" can apply it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114210000_create_audit_logs';
