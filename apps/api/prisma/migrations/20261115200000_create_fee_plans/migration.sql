-- Step 5.1 (ADR 0019): fee plans. Every rule below is enforced by PostgreSQL
-- itself, not only by the application.

-- ---------------------------------------------------------------------------
-- 1) ISO 4217 currencies, with their minor units (decimals). Read only for
--    the application: the list only changes through a reviewed migration.
--    Excluded: superseded codes (HRK, BGN -> EUR; ZWL -> ZWG; SLL -> SLE;
--    ANG -> XCG; CUC withdrawn) and units of account (XDR, XSU).
-- ---------------------------------------------------------------------------
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "minor_units" SMALLINT NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "currencies_code_check" CHECK ("code" ~ '^[A-Z]{3}$'),
    CONSTRAINT "currencies_minor_units_check" CHECK ("minor_units" BETWEEN 0 AND 4)
);

INSERT INTO "currencies" ("code", "minor_units") VALUES
  ('AED', 2), ('AFN', 2), ('ALL', 2), ('AMD', 2), ('AOA', 2), ('ARS', 2),
  ('AUD', 2), ('AWG', 2), ('AZN', 2), ('BAM', 2), ('BBD', 2), ('BDT', 2),
  ('BHD', 3), ('BIF', 0), ('BMD', 2), ('BND', 2), ('BOB', 2), ('BRL', 2),
  ('BSD', 2), ('BTN', 2), ('BWP', 2), ('BYN', 2), ('BZD', 2), ('CAD', 2),
  ('CDF', 2), ('CHF', 2), ('CLP', 0), ('CNY', 2), ('COP', 2), ('CRC', 2),
  ('CUP', 2), ('CVE', 2), ('CZK', 2), ('DJF', 0), ('DKK', 2), ('DOP', 2),
  ('DZD', 2), ('EGP', 2), ('ERN', 2), ('ETB', 2), ('EUR', 2), ('FJD', 2),
  ('FKP', 2), ('GBP', 2), ('GEL', 2), ('GHS', 2), ('GIP', 2), ('GMD', 2),
  ('GNF', 0), ('GTQ', 2), ('GYD', 2), ('HKD', 2), ('HNL', 2), ('HTG', 2),
  ('HUF', 2), ('IDR', 2), ('ILS', 2), ('INR', 2), ('IQD', 3), ('IRR', 2),
  ('ISK', 0), ('JMD', 2), ('JOD', 3), ('JPY', 0), ('KES', 2), ('KGS', 2),
  ('KHR', 2), ('KMF', 0), ('KPW', 2), ('KRW', 0), ('KWD', 3), ('KYD', 2),
  ('KZT', 2), ('LAK', 2), ('LBP', 2), ('LKR', 2), ('LRD', 2), ('LSL', 2),
  ('LYD', 3), ('MAD', 2), ('MDL', 2), ('MGA', 2), ('MKD', 2), ('MMK', 2),
  ('MNT', 2), ('MOP', 2), ('MRU', 2), ('MUR', 2), ('MVR', 2), ('MWK', 2),
  ('MXN', 2), ('MYR', 2), ('MZN', 2), ('NAD', 2), ('NGN', 2), ('NIO', 2),
  ('NOK', 2), ('NPR', 2), ('NZD', 2), ('OMR', 3), ('PAB', 2), ('PEN', 2),
  ('PGK', 2), ('PHP', 2), ('PKR', 2), ('PLN', 2), ('PYG', 0), ('QAR', 2),
  ('RON', 2), ('RSD', 2), ('RUB', 2), ('RWF', 0), ('SAR', 2), ('SBD', 2),
  ('SCR', 2), ('SDG', 2), ('SEK', 2), ('SGD', 2), ('SHP', 2), ('SLE', 2),
  ('SOS', 2), ('SRD', 2), ('SSP', 2), ('STN', 2), ('SVC', 2), ('SYP', 2),
  ('SZL', 2), ('THB', 2), ('TJS', 2), ('TMT', 2), ('TND', 3), ('TOP', 2),
  ('TRY', 2), ('TTD', 2), ('TWD', 2), ('TZS', 2), ('UAH', 2), ('UGX', 0),
  ('USD', 2), ('UYU', 2), ('UZS', 2), ('VES', 2), ('VND', 0), ('VUV', 0),
  ('WST', 2), ('XAF', 0), ('XCD', 2), ('XCG', 2), ('XOF', 0), ('XPF', 0),
  ('YER', 2), ('ZAR', 2), ('ZMW', 2), ('ZWG', 2);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "currencies" FROM alaa_app;

-- ---------------------------------------------------------------------------
-- 2) btree_gist: lets ONE exclusion constraint combine "=" (client) and "&&"
--    (overlapping months). A trusted extension: the database owner
--    (alaa_migrator) may create it.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 3) Fee plans: one row per period of a client's fees. Amounts in minor
--    units (ADR 0008); the percentage in basis points (10% = 1000).
-- ---------------------------------------------------------------------------
CREATE TABLE "fee_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fixed_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "percent_basis_points" INTEGER NOT NULL DEFAULT 0,
    "minimum_fee_minor" BIGINT,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fee_plans_client_id_fkey" FOREIGN KEY ("client_id")
      REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fee_plans_currency_fkey" FOREIGN KEY ("currency")
      REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- Amounts never negative; at most 100%; a plan charges something.
    CONSTRAINT "fee_plans_values_check" CHECK (
      "fixed_fee_minor" >= 0
      AND "percent_basis_points" BETWEEN 0 AND 10000
      AND ("minimum_fee_minor" IS NULL OR "minimum_fee_minor" >= 0)
      AND ("fixed_fee_minor" > 0 OR "percent_basis_points" > 0)
    ),
    -- Whole months: starts on the 1st, ends on the last day of a month.
    CONSTRAINT "fee_plans_months_check" CHECK (
      "starts_on" = date_trunc('month', "starts_on")::date
      AND ("ends_on" IS NULL OR (
        "ends_on" >= "starts_on"
        AND "ends_on" = (date_trunc('month', "ends_on") + interval '1 month - 1 day')::date
      ))
    ),
    -- Two plans of one client never cover the same day (cancelled plans
    -- excepted). An open plan (no end) runs without limit.
    CONSTRAINT "fee_plans_no_overlap" EXCLUDE USING gist (
      "client_id" WITH =,
      daterange("starts_on", "ends_on", '[]') WITH &&
    ) WHERE ("cancelled_at" IS NULL)
);

CREATE INDEX "fee_plans_client_id_starts_on_idx" ON "fee_plans"("client_id", "starts_on");

-- ---------------------------------------------------------------------------
-- 4) History protection (all dates are UTC, ADR 0007).
--    INSERT: timestamps set by the database; never born cancelled; only the
--            FIRST plan of a client may start before the current month.
--    UPDATE: terms never change. A plan is closed once, at the end of the
--            current month at the earliest (a change made during a month
--            applies from the next month). Only a plan that has not started
--            can be cancelled, once. updated_at always refreshed.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "fee_plans_guard_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- "Today" in UTC (ADR 0007), whatever the TimeZone of the session.
  "today" DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
BEGIN
  NEW."created_at" := CURRENT_TIMESTAMP;
  NEW."updated_at" := CURRENT_TIMESTAMP;
  IF NEW."cancelled_at" IS NOT NULL THEN
    RAISE EXCEPTION 'a new fee plan cannot be cancelled' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."starts_on" < date_trunc('month', "today")::date AND EXISTS (
    SELECT 1 FROM "fee_plans"
    WHERE "client_id" = NEW."client_id" AND "cancelled_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'only the first fee plan of a client may start in a past month'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "fee_plans_guard_insert" BEFORE INSERT ON "fee_plans"
  FOR EACH ROW EXECUTE FUNCTION "fee_plans_guard_insert"();

CREATE FUNCTION "fee_plans_guard_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- "Today" in UTC (ADR 0007), whatever the TimeZone of the session.
  "today" DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;
BEGIN
  IF NEW."id" <> OLD."id"
     OR NEW."client_id" <> OLD."client_id"
     OR NEW."currency" <> OLD."currency"
     OR NEW."fixed_fee_minor" <> OLD."fixed_fee_minor"
     OR NEW."percent_basis_points" <> OLD."percent_basis_points"
     OR NEW."minimum_fee_minor" IS DISTINCT FROM OLD."minimum_fee_minor"
     OR NEW."starts_on" <> OLD."starts_on"
     OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'fee plan terms cannot change: create a new plan'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."ends_on" IS DISTINCT FROM OLD."ends_on" THEN
    IF OLD."ends_on" IS NOT NULL THEN
      RAISE EXCEPTION 'a closed fee plan cannot be reopened or moved'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."ends_on" < (date_trunc('month', "today") + interval '1 month - 1 day')::date THEN
      RAISE EXCEPTION 'a fee plan closes at the end of the current month at the earliest'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at" THEN
    IF OLD."cancelled_at" IS NOT NULL OR NEW."cancelled_at" IS NULL
       OR OLD."starts_on" <= "today" THEN
      RAISE EXCEPTION 'only a fee plan that has not started can be cancelled, once'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;

CREATE TRIGGER "fee_plans_guard_update" BEFORE UPDATE ON "fee_plans"
  FOR EACH ROW EXECUTE FUNCTION "fee_plans_guard_update"();

-- ---------------------------------------------------------------------------
-- 5) The fee of ONE month, computed in NUMERIC (no float, no overflow while
--    computing), rounded half up to the minor unit:
--      fee = MAX(fixed + ROUND(spend * basis_points / 10000), minimum)
--    The minimum applies to the TOTAL (fixed + variable). NULL is refused
--    for every input except the minimum, where NULL means "no minimum".
-- ---------------------------------------------------------------------------
CREATE FUNCTION "monthly_fee_minor"(
  "p_spend_minor" NUMERIC,
  "p_fixed_fee_minor" BIGINT,
  "p_percent_basis_points" INTEGER,
  "p_minimum_fee_minor" BIGINT
) RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  "fee" NUMERIC;
BEGIN
  IF "p_spend_minor" IS NULL OR "p_fixed_fee_minor" IS NULL OR "p_percent_basis_points" IS NULL THEN
    RAISE EXCEPTION 'monthly_fee_minor: spend, fixed fee and percentage are required'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;
  IF "p_spend_minor" < 0 OR "p_spend_minor" <> trunc("p_spend_minor") THEN
    RAISE EXCEPTION 'monthly_fee_minor: spend must be a whole number of minor units, 0 or more'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF "p_fixed_fee_minor" < 0 THEN
    RAISE EXCEPTION 'monthly_fee_minor: the fixed fee cannot be negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF "p_percent_basis_points" NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'monthly_fee_minor: the percentage must be between 0 and 10000 basis points'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF "p_minimum_fee_minor" < 0 THEN
    RAISE EXCEPTION 'monthly_fee_minor: the minimum fee cannot be negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  "fee" := GREATEST(
    "p_fixed_fee_minor"::numeric + round("p_spend_minor" * "p_percent_basis_points" / 10000),
    COALESCE("p_minimum_fee_minor", 0)::numeric
  );
  IF "fee" > 9223372036854775807 THEN
    RAISE EXCEPTION 'monthly_fee_minor: the fee is too large'
      USING ERRCODE = 'numeric_value_out_of_range';
  END IF;
  RETURN "fee"::bigint;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Financial data is never deleted.
-- ---------------------------------------------------------------------------
REVOKE DELETE, TRUNCATE ON "fee_plans" FROM alaa_app;
