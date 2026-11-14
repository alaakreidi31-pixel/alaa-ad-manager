-- ROLLBACK for migration 20261114093306_create_users
--
-- DANGER: deletes the users table and ALL of its data.
-- Never run automatically on a real database (development or production).
-- It runs automatically ONLY in the rollback test, on alaa_ad_manager_test,
-- behind a guard that refuses any database whose name does not end with "_test".
-- Manual use on any other database requires the project owner's approval.

DROP TABLE "users";
DROP TYPE "user_status";
DROP TYPE "user_role";

-- Forget that the migration was applied, so "prisma migrate deploy" can apply it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114093306_create_users';
