-- AlterTable
ALTER TABLE "users" ADD COLUMN     "client_id" UUID,
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "users_client_id_idx" ON "users"("client_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (ADR 0016): every CLIENT_USER belongs to exactly one client,
-- and an administrator (SUPER_ADMIN) belongs to none.
ALTER TABLE "users" ADD CONSTRAINT "users_client_link_check"
  CHECK (("role" = 'CLIENT_USER') = ("client_id" IS NOT NULL));
