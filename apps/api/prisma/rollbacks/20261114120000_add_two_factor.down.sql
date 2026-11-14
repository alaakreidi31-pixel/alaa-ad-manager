-- ROLLBACK for migration 20261114120000_add_two_factor
--
-- Removes two-factor authentication: every 2FA secret and recovery code is lost.
-- Never run automatically on a real database (development or production).
-- It runs automatically ONLY in the rollback test, on alaa_ad_manager_test.
-- Manual use on any other database requires the project owner's approval.

DROP TABLE "recovery_codes";

-- Dropping the columns also drops the users_totp_consistent_check constraint.
ALTER TABLE "users" DROP COLUMN "totp_enabled_at",
DROP COLUMN "totp_last_used_step",
DROP COLUMN "totp_secret_encrypted";

-- Forget that the migration was applied, so "prisma migrate deploy" can apply it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114120000_add_two_factor';
