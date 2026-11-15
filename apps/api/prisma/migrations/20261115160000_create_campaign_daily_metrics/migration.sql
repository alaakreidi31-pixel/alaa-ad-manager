-- CreateEnum
CREATE TYPE "metric_source" AS ENUM ('MANUAL', 'CSV');

-- CreateTable
CREATE TABLE "campaign_daily_metrics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "spend_minor" BIGINT NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "conversions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "source" "metric_source" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaign_daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_daily_metrics_campaign_id_date_key" ON "campaign_daily_metrics"("campaign_id", "date");

-- AddForeignKey
ALTER TABLE "campaign_daily_metrics" ADD CONSTRAINT "campaign_daily_metrics_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (ADR 0018): no negative number. Spend is in minor units of
-- the campaign currency (ADR 0008); conversions may be fractional (Google).
ALTER TABLE "campaign_daily_metrics" ADD CONSTRAINT "campaign_daily_metrics_values_check"
  CHECK ("spend_minor" >= 0 AND "impressions" >= 0 AND "clicks" >= 0 AND "conversions" >= 0);

-- Hand-written (ADR 0018): a wrong day is corrected, never deleted.
REVOKE DELETE, TRUNCATE ON "campaign_daily_metrics" FROM alaa_app;
