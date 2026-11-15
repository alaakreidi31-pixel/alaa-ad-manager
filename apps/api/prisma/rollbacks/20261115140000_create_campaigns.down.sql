-- ROLLBACK for migration 20261115140000_create_campaigns
--
-- DELETES EVERY CAMPAIGN.
-- Never run automatically on a real database (development or production).
-- It runs automatically ONLY in the rollback test, on alaa_ad_manager_test.
-- Manual use on any other database requires the project owner's approval.

DROP TABLE "campaigns";
DROP TYPE "campaign_status";
DROP TYPE "campaign_platform";

-- Forget that the migration was applied, so "prisma migrate deploy" can apply it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261115140000_create_campaigns';
