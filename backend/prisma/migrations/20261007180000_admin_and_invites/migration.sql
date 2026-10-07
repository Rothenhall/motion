-- Multi-client workspaces, phase 2 (additive): invites and password-reset links, an admin audit log, login lockout and
-- session versioning, and soft disconnect of channels (disconnectedAt). Nothing is removed or changed for existing rows.
-- One constraint is relaxed: the old per-user channel rule is dropped (see below).

-- Staff connect channels for every client, so "one channel per connecting user" no longer means anything: it stopped staff
-- moving a channel from one client to another. Ownership is by client now (unique client + provider + externalId, from phase 1)
-- and a channel is connected to at most one client at a time (the partial index at the end of this file).
DROP INDEX "SocialAccount_userId_provider_externalId_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "invitedById" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "disconnectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "clientId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "meta" JSONB,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_type_idx" ON "AuthToken"("userId", "type");

-- CreateIndex
CREATE INDEX "AdminAuditLog_clientId_at_idx" ON "AdminAuditLog"("clientId", "at");

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A channel can be connected to only one client at a time. Prisma cannot express a partial unique index, so it is written by
-- hand here (do not let a generated migration drop it). If connected duplicates already exist the index is skipped with a
-- notice, the app still refuses new duplicates itself, and the index can be created once the duplicates are resolved.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SocialAccount" WHERE "disconnectedAt" IS NULL GROUP BY "provider", "externalId" HAVING count(*) > 1) THEN
    RAISE NOTICE 'Connected channels with the same provider and externalId exist; SocialAccount_connected_channel_key was NOT created. Resolve them, then run: CREATE UNIQUE INDEX "SocialAccount_connected_channel_key" ON "SocialAccount"("provider", "externalId") WHERE "disconnectedAt" IS NULL;';
  ELSE
    CREATE UNIQUE INDEX "SocialAccount_connected_channel_key" ON "SocialAccount"("provider", "externalId") WHERE "disconnectedAt" IS NULL;
  END IF;
END
$$;
