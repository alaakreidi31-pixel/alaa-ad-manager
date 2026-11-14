-- ROLLBACK for migration 20261115090000_create_clients
--
-- DELETES EVERY CLIENT.
-- Never run automatically on a real database (development or production).
-- It runs automatically ONLY in the rollback test, on alaa_ad_manager_test.
-- Manual use on any other database requires the project owner's approval.

DROP TABLE "clients";
DROP TYPE "client_status";

-- Forget that the migration was applied, so "prisma migrate deploy" can apply it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261115090000_create_clients';
