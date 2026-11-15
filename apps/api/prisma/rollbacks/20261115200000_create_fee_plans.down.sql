-- ROLLBACK for migration 20261115200000_create_fee_plans
--
-- DELETES EVERY FEE PLAN and the currency list. Touches nothing else:
-- users, sessions, audit_logs, clients, campaigns and campaign_daily_metrics
-- are not read nor changed.
-- Never run automatically on a real database (development or production).
-- It runs automatically ONLY in the rollback test, on alaa_ad_manager_test.
-- Manual use on any other database requires the project owner's approval.

DROP TABLE "fee_plans";
DROP FUNCTION "fee_plans_guard_insert"();
DROP FUNCTION "fee_plans_guard_update"();
DROP FUNCTION "monthly_fee_minor"(NUMERIC, BIGINT, INTEGER, BIGINT);
DROP TABLE "currencies";
-- The btree_gist extension is kept on purpose: it holds no data, and it may
-- have been created by "postgres" (then alaa_migrator could not drop it).

-- Forget that the migration was applied, so "prisma migrate deploy" can apply it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261115200000_create_fee_plans';
