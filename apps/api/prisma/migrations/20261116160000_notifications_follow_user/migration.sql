-- Phase 9 (ADR 0023): a notification belongs to its user. If a login account
-- is ever deleted (the application never does; only the tests that empty
-- the users table do), its notifications go with it instead of blocking.
-- Nothing else changes: the application still cannot delete a notification.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_fkey";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
