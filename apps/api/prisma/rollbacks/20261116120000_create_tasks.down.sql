-- ROLLBACK for migration 20261116120000_create_tasks
--
-- DELETES EVERY TASK, RECURRING RULE AND TASK COMMENT. Touches nothing else
-- (clients, campaigns, invoices... are not read nor changed).
-- Never run automatically on a real database (development or production).
-- It runs automatically ONLY in the rollback test, on alaa_ad_manager_test.
-- Manual use on any other database requires the project owner's approval.

DROP TABLE "task_comments";
DROP FUNCTION "task_comments_guard"();
DROP TABLE "tasks";
DROP FUNCTION "tasks_guard"();
DROP TABLE "task_recurrences";
DROP FUNCTION "task_recurrences_guard"();
DROP FUNCTION "task_campaign_matches_client"();
DROP TYPE "task_frequency";
DROP TYPE "task_source";
DROP TYPE "task_priority";
DROP TYPE "task_status";

-- Forget that the migration was applied, so "prisma migrate deploy" can apply it again.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261116120000_create_tasks';
