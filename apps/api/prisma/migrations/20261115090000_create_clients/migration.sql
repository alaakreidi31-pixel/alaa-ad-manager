-- CreateEnum
CREATE TYPE "client_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "country" CHAR(2),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "website" TEXT,
    "business_industry" TEXT,
    "status" "client_status" NOT NULL DEFAULT 'ACTIVE',
    "internal_notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_status_created_at_idx" ON "clients"("status", "created_at");

-- Hand-written (ADR 0016): data rules enforced by the database itself.
ALTER TABLE "clients" ADD CONSTRAINT "clients_name_check"
  CHECK ("name" = btrim("name") AND "name" <> '');
ALTER TABLE "clients" ADD CONSTRAINT "clients_email_normalized_check"
  CHECK ("email" IS NULL OR ("email" = lower(btrim("email")) AND "email" <> ''));
ALTER TABLE "clients" ADD CONSTRAINT "clients_country_check"
  CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$');
ALTER TABLE "clients" ADD CONSTRAINT "clients_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- Hand-written (ADR 0016): clients are never deleted, only archived.
-- alaa_app received DELETE through the default privileges (ADR 0009);
-- here it loses DELETE and TRUNCATE on this table only.
REVOKE DELETE, TRUNCATE ON "clients" FROM alaa_app;
