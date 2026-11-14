-- ROLLBACK for migration 20261114112647_add_login_lockout
--
-- Removes the brute-force protection columns (lock state is lost).
-- Never run automatically on a real database (development or production).
-- It runs automatically ONLY in the rollback test, on alaa_ad_manager_test.
-- Manual use on any other database requires the project owner's approval.

ALTER TABLE "users" DROP COLUMN "failed_login_attempts", DROP COLUMN "locked_until";

-- Forget that the migration was applied, so "prisma migrate deploy" can apply it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114112647_add_login_lockout';
