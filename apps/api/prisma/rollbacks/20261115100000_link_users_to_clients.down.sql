-- ROLLBACK for migration 20261115100000_link_users_to_clients
--
-- Unlinks every client login from its client (the link cannot be rebuilt).
-- Never run automatically on a real database (development or production).
-- It runs automatically ONLY in the rollback test, on alaa_ad_manager_test.
-- Manual use on any other database requires the project owner's approval.

-- Dropping client_id also drops its index, its foreign key and users_client_link_check.
ALTER TABLE "users" DROP COLUMN "client_id",
DROP COLUMN "must_change_password";

-- Forget that the migration was applied, so "prisma migrate deploy" can apply it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261115100000_link_users_to_clients';
