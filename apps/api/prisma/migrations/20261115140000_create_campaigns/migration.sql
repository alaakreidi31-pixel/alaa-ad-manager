-- CreateEnum
CREATE TYPE "campaign_platform" AS ENUM ('META', 'GOOGLE');

-- CreateEnum
CREATE TYPE "campaign_status" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "platform" "campaign_platform" NOT NULL,
    "name" TEXT NOT NULL,
    "external_id" TEXT,
    "objective" TEXT,
    "status" "campaign_status" NOT NULL DEFAULT 'ACTIVE',
    "currency" CHAR(3) NOT NULL,
    "daily_budget_minor" BIGINT,
    "start_date" DATE,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_client_id_status_idx" ON "campaigns"("client_id", "status");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (ADR 0018): one platform id per client and platform, used to
-- match the rows of an imported CSV file (step 4.3). Several campaigns may
-- have no platform id (manual campaigns).
CREATE UNIQUE INDEX "campaigns_client_platform_external_key"
  ON "campaigns"("client_id", "platform", "external_id") WHERE "external_id" IS NOT NULL;

-- Hand-written (ADR 0018): data rules enforced by the database itself.
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_name_check"
  CHECK ("name" = btrim("name") AND "name" <> '');
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_external_id_check"
  CHECK ("external_id" IS NULL OR ("external_id" = btrim("external_id") AND "external_id" <> ''));
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');
-- Money in the smallest unit of the currency, e.g. cents (ADR 0008).
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_budget_check"
  CHECK ("daily_budget_minor" IS NULL OR "daily_budget_minor" >= 0);
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_dates_check"
  CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date");

-- Hand-written (ADR 0018): campaigns are never deleted, only archived.
REVOKE DELETE, TRUNCATE ON "campaigns" FROM alaa_app;
