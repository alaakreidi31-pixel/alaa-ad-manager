-- Phase 9 (ADR 0023): in-app notifications.
--   * One row per user: an event for the administration is written for each
--     SUPER_ADMIN, an event for a client for each login account of that client.
--   * "kind" is a code (e.g. invoice.issued) and "params" its values; the web
--     app writes the sentence in Arabic or English. Never a password, token,
--     internal note or comment text.
--   * "dedupe_key" makes repeated events (e.g. an invoice still overdue) appear
--     once per user.
--   * Nothing is deleted: the only change allowed is marking as read.

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "link" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_kind_check" CHECK ("kind" ~ '^[a-z_]+\.[a-z_]+$'),
    CONSTRAINT "notifications_params_check" CHECK (jsonb_typeof("params") = 'object' AND length("params"::text) <= 2000),
    -- A path inside the application only: never an outside address, and
    -- never "//site" (a browser reads it as another site).
    CONSTRAINT "notifications_link_check" CHECK ("link" IS NULL OR ("link" ~ '^/([A-Za-z0-9_?=&.-][A-Za-z0-9/_?=&.-]*)?$' AND length("link") <= 300)),
    CONSTRAINT "notifications_dedupe_key_check" CHECK ("dedupe_key" IS NULL OR length("dedupe_key") BETWEEN 1 AND 200)
);

-- One notification per user and repeated event.
CREATE UNIQUE INDEX "notifications_user_dedupe_key" ON "notifications"("user_id", "dedupe_key");
-- The bell: the unread notifications of a user, newest first.
CREATE INDEX "notifications_user_unread_idx" ON "notifications"("user_id", "created_at" DESC) WHERE "read_at" IS NULL;
CREATE INDEX "notifications_user_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Only "read_at" can change, and once read a notification stays read. The
-- creation time is the database's.
CREATE FUNCTION "notifications_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."created_at" := CURRENT_TIMESTAMP;
    NEW."read_at" := NULL;
  ELSE
    IF NEW."id" <> OLD."id" OR NEW."user_id" <> OLD."user_id" OR NEW."kind" <> OLD."kind"
       OR NEW."params" <> OLD."params" OR NEW."link" IS DISTINCT FROM OLD."link"
       OR NEW."dedupe_key" IS DISTINCT FROM OLD."dedupe_key" OR NEW."created_at" <> OLD."created_at" THEN
      RAISE EXCEPTION 'a notification cannot change, it can only be marked as read' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."read_at" IS NOT NULL THEN
      NEW."read_at" := OLD."read_at";
    ELSIF NEW."read_at" IS NOT NULL THEN
      NEW."read_at" := CURRENT_TIMESTAMP;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "notifications_guard" BEFORE INSERT OR UPDATE ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION "notifications_guard"();

-- Nothing is deleted.
REVOKE DELETE, TRUNCATE ON "notifications" FROM alaa_app;
