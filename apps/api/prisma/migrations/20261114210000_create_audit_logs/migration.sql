-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "user_id" UUID,
    "ip" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- Hand-written (ADR 0014): the audit log is append-only for the application.
-- alaa_app received SELECT, INSERT, UPDATE, DELETE through the default
-- privileges (ADR 0009); here it loses UPDATE and DELETE on this table only.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM alaa_app;
