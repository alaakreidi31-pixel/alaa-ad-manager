-- Phase 8 (ADR 0022): tasks of the agency.
--   * A task is general, or for a client, or for a campaign of that client.
--   * "visible_to_client" shares it (read only) in the client portal.
--     Comments are internal: never shown to the client.
--   * Sources: MANUAL (typed by the administration), RECURRING (made from a
--     task_recurrences rule, once per occurrence) and SYSTEM (made by the
--     application, once per "system_key", e.g. an invoice draft to review).
--   * Nothing is deleted: a task is cancelled, a rule is paused or ended,
--     a comment never changes.

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');
CREATE TYPE "task_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "task_source" AS ENUM ('MANUAL', 'RECURRING', 'SYSTEM');
CREATE TYPE "task_frequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateTable: the rules of recurring tasks.
CREATE TABLE "task_recurrences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "task_priority" NOT NULL DEFAULT 'MEDIUM',
    "client_id" UUID,
    "campaign_id" UUID,
    "visible_to_client" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "task_frequency" NOT NULL,
    -- WEEKLY: 1 = Monday ... 7 = Sunday (ISO). MONTHLY: day 1 to 28 (every month has it).
    "day_of_week" SMALLINT,
    "day_of_month" SMALLINT,
    -- The task is due this many days after its occurrence day.
    "due_after_days" SMALLINT NOT NULL DEFAULT 0,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "paused_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_recurrences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_recurrences_title_check" CHECK ("title" = btrim("title") AND length("title") BETWEEN 1 AND 200),
    CONSTRAINT "task_recurrences_description_check" CHECK ("description" IS NULL OR length("description") <= 5000),
    CONSTRAINT "task_recurrences_schedule_check" CHECK (
      -- IS NOT NULL is explicit: a CHECK that is NULL (unknown) would pass.
      ("frequency" = 'WEEKLY' AND "day_of_week" IS NOT NULL AND "day_of_week" BETWEEN 1 AND 7 AND "day_of_month" IS NULL)
      OR ("frequency" = 'MONTHLY' AND "day_of_month" IS NOT NULL AND "day_of_month" BETWEEN 1 AND 28 AND "day_of_week" IS NULL)),
    CONSTRAINT "task_recurrences_due_check" CHECK ("due_after_days" BETWEEN 0 AND 60),
    CONSTRAINT "task_recurrences_dates_check" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on"),
    CONSTRAINT "task_recurrences_campaign_check" CHECK ("campaign_id" IS NULL OR "client_id" IS NOT NULL),
    CONSTRAINT "task_recurrences_visible_check" CHECK (NOT "visible_to_client" OR "client_id" IS NOT NULL)
);

-- CreateTable: the tasks.
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "task_status" NOT NULL DEFAULT 'TODO',
    "priority" "task_priority" NOT NULL DEFAULT 'MEDIUM',
    "due_on" DATE,
    "client_id" UUID,
    "campaign_id" UUID,
    "visible_to_client" BOOLEAN NOT NULL DEFAULT false,
    "source" "task_source" NOT NULL DEFAULT 'MANUAL',
    "recurrence_id" UUID,
    "occurrence_on" DATE,
    "system_key" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tasks_title_check" CHECK ("title" = btrim("title") AND length("title") BETWEEN 1 AND 200),
    CONSTRAINT "tasks_description_check" CHECK ("description" IS NULL OR length("description") <= 5000),
    CONSTRAINT "tasks_campaign_check" CHECK ("campaign_id" IS NULL OR "client_id" IS NOT NULL),
    CONSTRAINT "tasks_visible_check" CHECK (NOT "visible_to_client" OR "client_id" IS NOT NULL),
    -- Each source has exactly its own fields.
    CONSTRAINT "tasks_source_check" CHECK (
      ("source" = 'MANUAL' AND "created_by" IS NOT NULL AND "recurrence_id" IS NULL
         AND "occurrence_on" IS NULL AND "system_key" IS NULL)
      OR ("source" = 'RECURRING' AND "recurrence_id" IS NOT NULL AND "occurrence_on" IS NOT NULL
         AND "system_key" IS NULL)
      OR ("source" = 'SYSTEM' AND "system_key" IS NOT NULL AND "recurrence_id" IS NULL
         AND "occurrence_on" IS NULL)),
    CONSTRAINT "tasks_system_key_check" CHECK ("system_key" IS NULL OR "system_key" ~ '^[a-z-]+:[A-Za-z0-9:-]+$'),
    -- A done task has its completion time, and only a done task.
    CONSTRAINT "tasks_completed_check" CHECK (("status" = 'DONE') = ("completed_at" IS NOT NULL))
);

-- CreateTable: internal comments (never shown to the client, never changed).
CREATE TABLE "task_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_comments_body_check" CHECK (btrim("body") <> '' AND length("body") <= 5000)
);

-- One task per occurrence of a rule; one task per system key (even if cancelled).
CREATE UNIQUE INDEX "tasks_recurrence_occurrence_key" ON "tasks"("recurrence_id", "occurrence_on");
CREATE UNIQUE INDEX "tasks_system_key_key" ON "tasks"("system_key");
CREATE INDEX "tasks_status_due_on_idx" ON "tasks"("status", "due_on");
CREATE INDEX "tasks_client_id_status_idx" ON "tasks"("client_id", "status");
CREATE INDEX "tasks_campaign_id_idx" ON "tasks"("campaign_id");
CREATE INDEX "task_recurrences_client_id_idx" ON "task_recurrences"("client_id");
CREATE INDEX "task_comments_task_id_created_at_idx" ON "task_comments"("task_id", "created_at");

-- AddForeignKey (RESTRICT: nothing referenced can disappear)
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_id_fkey" FOREIGN KEY ("recurrence_id") REFERENCES "task_recurrences"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The campaign of a task or rule must belong to its client.
CREATE FUNCTION "task_campaign_matches_client"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."campaign_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "campaigns" WHERE "id" = NEW."campaign_id" AND "client_id" = NEW."client_id"
  ) THEN
    RAISE EXCEPTION 'the campaign does not belong to the client of the task' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "tasks_campaign_matches_client" BEFORE INSERT OR UPDATE OF "client_id", "campaign_id" ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "task_campaign_matches_client"();
CREATE TRIGGER "task_recurrences_campaign_matches_client" BEFORE INSERT OR UPDATE OF "client_id", "campaign_id" ON "task_recurrences"
  FOR EACH ROW EXECUTE FUNCTION "task_campaign_matches_client"();

-- tasks: the origin of a task never changes; the completion time is set by
-- the database (when it becomes DONE) and cleared when it is reopened.
CREATE FUNCTION "tasks_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."created_at" := CURRENT_TIMESTAMP;
    NEW."completed_at" := CASE WHEN NEW."status" = 'DONE' THEN CURRENT_TIMESTAMP END;
  ELSE
    IF NEW."id" <> OLD."id" OR NEW."created_at" <> OLD."created_at"
       OR NEW."source" <> OLD."source"
       OR NEW."recurrence_id" IS DISTINCT FROM OLD."recurrence_id"
       OR NEW."occurrence_on" IS DISTINCT FROM OLD."occurrence_on"
       OR NEW."system_key" IS DISTINCT FROM OLD."system_key"
       OR NEW."created_by" IS DISTINCT FROM OLD."created_by" THEN
      RAISE EXCEPTION 'the origin of a task cannot change' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" = 'DONE' AND OLD."status" <> 'DONE' THEN
      NEW."completed_at" := CURRENT_TIMESTAMP;
    ELSIF NEW."status" <> 'DONE' THEN
      NEW."completed_at" := NULL;
    ELSE
      NEW."completed_at" := OLD."completed_at";
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "tasks_guard" BEFORE INSERT OR UPDATE ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "tasks_guard"();

-- task_recurrences: the creator and creation time never change.
CREATE FUNCTION "task_recurrences_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."created_at" := CURRENT_TIMESTAMP;
  ELSIF NEW."id" <> OLD."id" OR NEW."created_at" <> OLD."created_at" OR NEW."created_by" <> OLD."created_by" THEN
    RAISE EXCEPTION 'the creator of a recurring task cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "task_recurrences_guard" BEFORE INSERT OR UPDATE ON "task_recurrences"
  FOR EACH ROW EXECUTE FUNCTION "task_recurrences_guard"();

-- task_comments: the time is the database's.
CREATE FUNCTION "task_comments_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."created_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;

CREATE TRIGGER "task_comments_guard" BEFORE INSERT ON "task_comments"
  FOR EACH ROW EXECUTE FUNCTION "task_comments_guard"();

-- Nothing is deleted. Comments are never changed either.
REVOKE DELETE, TRUNCATE ON "tasks", "task_recurrences" FROM alaa_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "task_comments" FROM alaa_app;
