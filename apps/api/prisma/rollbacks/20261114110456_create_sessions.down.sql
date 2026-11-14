-- ROLLBACK for migration 20261114110456_create_sessions
--
-- DANGER: deletes the sessions table and ALL of its data (every user is logged out).
-- Never run automatically on a real database (development or production).
-- It runs automatically ONLY in the rollback test, on alaa_ad_manager_test,
-- behind a guard that refuses any database whose name does not end with "_test".
-- Manual use on any other database requires the project owner's approval.

DROP TABLE "sessions";

-- Forget that the migration was applied, so "prisma migrate deploy" can apply it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114110456_create_sessions';
