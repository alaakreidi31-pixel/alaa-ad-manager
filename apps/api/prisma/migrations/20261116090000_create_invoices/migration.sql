-- Step 6.1 (ADR 0020): invoices and payments. Every rule below is enforced
-- by PostgreSQL itself, not only by the application.

CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'ISSUED', 'VOID');
CREATE TYPE "payment_method" AS ENUM ('BANK_TRANSFER', 'CASH', 'CARD', 'OTHER');

-- ---------------------------------------------------------------------------
-- 1) Invoice numbers AMG-YYYY-NNNN: one counter per year, written ONLY by the
--    issue trigger (SECURITY DEFINER below). The application cannot touch it.
--    The counter is updated inside the issuing transaction: if the issue
--    fails, the number is not used, so there is never a gap.
-- ---------------------------------------------------------------------------
CREATE TABLE "invoice_number_counters" (
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_number_counters_pkey" PRIMARY KEY ("year"),
    CONSTRAINT "invoice_number_counters_check" CHECK ("year" BETWEEN 2000 AND 9999 AND "last_number" >= 0)
);
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON "invoice_number_counters" FROM alaa_app;

CREATE FUNCTION "next_invoice_number"("p_year" INTEGER) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  "next" INTEGER;
BEGIN
  -- Only the invoice trigger may take a number: a direct call would burn
  -- numbers and leave gaps.
  IF pg_trigger_depth() = 0 THEN
    RAISE EXCEPTION 'invoice numbers are only given when an invoice is issued'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO "invoice_number_counters" ("year", "last_number") VALUES ("p_year", 1)
  ON CONFLICT ("year") DO UPDATE SET "last_number" = "invoice_number_counters"."last_number" + 1
  RETURNING "last_number" INTO "next";
  RETURN 'AMG-' || "p_year" || '-' || lpad("next"::text, 4, '0');
END $$;
REVOKE ALL ON FUNCTION "next_invoice_number"(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "next_invoice_number"(INTEGER) TO alaa_app;

-- ---------------------------------------------------------------------------
-- 2) Invoices: the agency fee of ONE client for ONE ended month. The amounts
--    are a snapshot of the fee plan and of the spend at the time of the
--    draft, and they must equal monthly_fee_minor (CHECK below).
--    DRAFT -> ISSUED (number, date, due date) -> VOID (with a reason).
-- ---------------------------------------------------------------------------
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "fee_plan_id" UUID NOT NULL,
    "period_month" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "spend_minor" NUMERIC(30,0) NOT NULL,
    "fixed_fee_minor" BIGINT NOT NULL,
    "percent_basis_points" INTEGER NOT NULL,
    "minimum_fee_minor" BIGINT,
    "variable_fee_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT,
    "issued_at" TIMESTAMPTZ(3),
    "due_on" DATE,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id")
      REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invoices_fee_plan_id_fkey" FOREIGN KEY ("fee_plan_id")
      REFERENCES "fee_plans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "invoices_currency_fkey" FOREIGN KEY ("currency")
      REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "invoices_period_check"
      CHECK ("period_month" = date_trunc('month', "period_month")::date),
    CONSTRAINT "invoices_values_check" CHECK (
      "spend_minor" >= 0 AND "fixed_fee_minor" >= 0
      AND "percent_basis_points" BETWEEN 0 AND 10000
      AND ("minimum_fee_minor" IS NULL OR "minimum_fee_minor" >= 0)
    ),
    -- The amounts are exactly the fee formula (ADR 0019), never typed by hand.
    CONSTRAINT "invoices_total_check" CHECK (
      "variable_fee_minor" = monthly_fee_minor("spend_minor", 0, "percent_basis_points", NULL)
      AND "total_minor" = monthly_fee_minor("spend_minor", "fixed_fee_minor",
                                            "percent_basis_points", "minimum_fee_minor")
    ),
    CONSTRAINT "invoices_status_check" CHECK (
      ("status" = 'DRAFT' AND "number" IS NULL AND "issued_at" IS NULL
        AND "due_on" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL)
      OR ("status" = 'ISSUED' AND "number" IS NOT NULL AND "issued_at" IS NOT NULL
        AND "due_on" IS NOT NULL AND "voided_at" IS NULL AND "void_reason" IS NULL)
      OR ("status" = 'VOID' AND "voided_at" IS NOT NULL
        AND "void_reason" IS NOT NULL AND btrim("void_reason") <> '')
    ),
    CONSTRAINT "invoices_number_check"
      CHECK ("number" IS NULL OR "number" ~ '^AMG-[0-9]{4}-[0-9]{4,}$'),
    CONSTRAINT "invoices_due_check"
      CHECK ("due_on" IS NULL OR "due_on" >= ("issued_at" AT TIME ZONE 'UTC')::date),
    CONSTRAINT "invoices_text_check" CHECK (
      ("notes" IS NULL OR length("notes") <= 2000)
      AND ("void_reason" IS NULL OR length("void_reason") <= 500)
    )
);

CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");
-- One invoice per client and month, except voided ones (a voided invoice
-- is replaced by a new one, with a new number).
CREATE UNIQUE INDEX "invoices_client_period_key"
  ON "invoices"("client_id", "period_month") WHERE "status" <> 'VOID';
CREATE INDEX "invoices_status_due_on_idx" ON "invoices"("status", "due_on");

-- ---------------------------------------------------------------------------
-- 3) Invoice rules (UTC, ADR 0007).
--    INSERT: always a DRAFT, for a month that is over.
--    DRAFT:  amounts may be refreshed (same plan rules); may be ISSUED (the
--            number and date are set HERE, never by the application) or
--            VOIDED (a discarded draft).
--    ISSUED: nothing changes, except VOID with a reason, and only while no
--            payment is recorded on it.
--    VOID:   final. Never deleted.
--    The fee plan must belong to the client, cover the month, not be
--    cancelled, and its terms must be copied exactly.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "invoices_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  "today" DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
  "plan" "fee_plans"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."created_at" := CURRENT_TIMESTAMP;
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'a new invoice is always a draft' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."period_month" >= date_trunc('month', "today")::date THEN
      RAISE EXCEPTION 'an invoice is only for a month that is over' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW."id" <> OLD."id" OR NEW."client_id" <> OLD."client_id"
       OR NEW."period_month" <> OLD."period_month" OR NEW."created_at" <> OLD."created_at" THEN
      RAISE EXCEPTION 'the client and month of an invoice cannot change' USING ERRCODE = 'check_violation';
    END IF;

    IF OLD."status" = 'VOID' THEN
      RAISE EXCEPTION 'a voided invoice cannot change' USING ERRCODE = 'check_violation';
    END IF;

    IF OLD."status" = 'ISSUED' THEN
      IF NEW."status" <> 'VOID'
         OR NEW."fee_plan_id" <> OLD."fee_plan_id" OR NEW."currency" <> OLD."currency"
         OR NEW."spend_minor" <> OLD."spend_minor" OR NEW."fixed_fee_minor" <> OLD."fixed_fee_minor"
         OR NEW."percent_basis_points" <> OLD."percent_basis_points"
         OR NEW."minimum_fee_minor" IS DISTINCT FROM OLD."minimum_fee_minor"
         OR NEW."variable_fee_minor" <> OLD."variable_fee_minor" OR NEW."total_minor" <> OLD."total_minor"
         OR NEW."number" <> OLD."number" OR NEW."issued_at" <> OLD."issued_at"
         OR NEW."due_on" <> OLD."due_on" OR NEW."notes" IS DISTINCT FROM OLD."notes" THEN
        RAISE EXCEPTION 'an issued invoice cannot change: void it and issue a new one'
          USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM "payments" WHERE "invoice_id" = OLD."id" AND "voided_at" IS NULL) THEN
        RAISE EXCEPTION 'an invoice with payments cannot be voided: void the payments first'
          USING ERRCODE = 'check_violation';
      END IF;
      -- An issued invoice keeps its number and dates when voided.
      NEW."number" := OLD."number";
      NEW."issued_at" := OLD."issued_at";
      NEW."due_on" := OLD."due_on";
    END IF;

    IF OLD."status" = 'DRAFT' AND NEW."status" = 'ISSUED' THEN
      IF NEW."number" IS DISTINCT FROM OLD."number" OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at" THEN
        RAISE EXCEPTION 'the number and date of an invoice are set by the database'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW."issued_at" := CURRENT_TIMESTAMP;
      NEW."number" := "next_invoice_number"(EXTRACT(YEAR FROM "today")::integer);
      NEW."due_on" := COALESCE(NEW."due_on", "today" + 14);
      IF NEW."due_on" < "today" THEN
        RAISE EXCEPTION 'the due date cannot be in the past' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
      IF NEW."number" IS NOT NULL OR NEW."issued_at" IS NOT NULL OR NEW."due_on" IS NOT NULL THEN
        RAISE EXCEPTION 'the number and date of an invoice are set by the database'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW."status" = 'VOID' AND OLD."status" <> 'VOID' THEN
      NEW."voided_at" := CURRENT_TIMESTAMP;
    END IF;
  END IF;

  -- The plan: same client, covers the month, not cancelled, same terms.
  IF NEW."status" = 'DRAFT' OR TG_OP = 'INSERT' OR OLD."status" = 'DRAFT' THEN
    SELECT * INTO "plan" FROM "fee_plans" WHERE "id" = NEW."fee_plan_id";
    IF "plan"."client_id" IS DISTINCT FROM NEW."client_id"
       OR "plan"."cancelled_at" IS NOT NULL
       OR "plan"."starts_on" > NEW."period_month"
       OR ("plan"."ends_on" IS NOT NULL AND "plan"."ends_on" < NEW."period_month")
       OR "plan"."currency" <> NEW."currency"
       OR "plan"."fixed_fee_minor" <> NEW."fixed_fee_minor"
       OR "plan"."percent_basis_points" <> NEW."percent_basis_points"
       OR "plan"."minimum_fee_minor" IS DISTINCT FROM NEW."minimum_fee_minor" THEN
      RAISE EXCEPTION 'the invoice must copy the fee plan of this client for this month'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;

CREATE TRIGGER "invoices_guard" BEFORE INSERT OR UPDATE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "invoices_guard"();

-- ---------------------------------------------------------------------------
-- 4) Payments: partial payments allowed, in the invoice currency, only on an
--    ISSUED invoice, never more than what is left to pay. A wrong payment is
--    voided (with a reason), never deleted nor changed.
-- ---------------------------------------------------------------------------
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id")
      REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "payments_amount_check" CHECK ("amount_minor" > 0),
    CONSTRAINT "payments_void_check" CHECK (
      ("voided_at" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL AND btrim("void_reason") <> '')
    ),
    CONSTRAINT "payments_text_check" CHECK (
      ("reference" IS NULL OR length("reference") <= 200)
      AND ("void_reason" IS NULL OR length("void_reason") <= 500)
    )
);
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

CREATE FUNCTION "payments_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  "today" DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
  "invoice" "invoices"%ROWTYPE;
  "paid" BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."created_at" := CURRENT_TIMESTAMP;
    IF NEW."voided_at" IS NOT NULL THEN
      RAISE EXCEPTION 'a new payment cannot be voided' USING ERRCODE = 'check_violation';
    END IF;
    -- Lock the invoice: two payments at the same time cannot both pass.
    SELECT * INTO "invoice" FROM "invoices" WHERE "id" = NEW."invoice_id" FOR UPDATE;
    IF "invoice"."status" IS DISTINCT FROM 'ISSUED' THEN
      RAISE EXCEPTION 'payments are only recorded on an issued invoice' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."paid_on" > "today" + 1 THEN
      RAISE EXCEPTION 'a payment cannot be dated in the future' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(SUM("amount_minor"), 0) INTO "paid"
      FROM "payments" WHERE "invoice_id" = NEW."invoice_id" AND "voided_at" IS NULL;
    IF "paid" + NEW."amount_minor" > "invoice"."total_minor" THEN
      RAISE EXCEPTION 'the payments would exceed the invoice total' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW."id" <> OLD."id" OR NEW."invoice_id" <> OLD."invoice_id"
       OR NEW."amount_minor" <> OLD."amount_minor" OR NEW."paid_on" <> OLD."paid_on"
       OR NEW."method" <> OLD."method" OR NEW."reference" IS DISTINCT FROM OLD."reference"
       OR NEW."created_at" <> OLD."created_at" THEN
      RAISE EXCEPTION 'a payment cannot change: void it and record a new one'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."voided_at" IS NOT NULL OR NEW."voided_at" IS NULL THEN
      RAISE EXCEPTION 'a payment can only be voided, once' USING ERRCODE = 'check_violation';
    END IF;
    NEW."voided_at" := CURRENT_TIMESTAMP;
  END IF;
  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;

CREATE TRIGGER "payments_guard" BEFORE INSERT OR UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "payments_guard"();

-- ---------------------------------------------------------------------------
-- 5) Financial data is never deleted.
-- ---------------------------------------------------------------------------
REVOKE DELETE, TRUNCATE ON "invoices" FROM alaa_app;
REVOKE DELETE, TRUNCATE ON "payments" FROM alaa_app;
