-- Multi-client workspaces (phase 1, additive).
-- Adds clients, per-client feature switches and media ownership, and a nullable clientId on everything a client owns.
-- Nobody is promoted to admin here: existing users stay ordinary users (each with a workspace of their own) and staff are
-- named with the ADMIN_EMAILS setting. Nothing is removed except five indexes that are replaced by client-based ones. Existing rows get their client from
-- the TenancyBackfillService on the next app start (see src/tenancy/backfill.service.ts), so this is safe to run on live data.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CLIENT_POC', 'CLIENT_MEMBER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- DropIndex
DROP INDEX "BrandProfile_userId_key";

-- DropIndex
DROP INDEX "ContentIdea_userId_status_createdAt_idx";

-- DropIndex
DROP INDEX "Hook_userId_category_idx";

-- DropIndex
DROP INDEX "ContentCheck_userId_createdAt_idx";

-- DropIndex
DROP INDEX "PostDraft_userId_updatedAt_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'CLIENT_POC',
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "ScheduledPost" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "ContentIdea" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "Hook" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "ContentCheck" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "PostDraft" ADD COLUMN     "clientId" TEXT;

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "seatLimit" INTEGER NOT NULL DEFAULT 3,
    "requireApproval" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFeatureFlag" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFile" (
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaFile_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientFeatureFlag_clientId_featureKey_key" ON "ClientFeatureFlag"("clientId", "featureKey");

-- CreateIndex
CREATE INDEX "MediaFile_clientId_idx" ON "MediaFile"("clientId");

-- CreateIndex
CREATE INDEX "User_clientId_idx" ON "User"("clientId");

-- CreateIndex
CREATE INDEX "SocialAccount_clientId_idx" ON "SocialAccount"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_clientId_provider_externalId_key" ON "SocialAccount"("clientId", "provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_clientId_key" ON "BrandProfile"("clientId");

-- CreateIndex
CREATE INDEX "BrandProfile_userId_idx" ON "BrandProfile"("userId");

-- CreateIndex
CREATE INDEX "ContentIdea_clientId_status_createdAt_idx" ON "ContentIdea"("clientId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Hook_clientId_category_idx" ON "Hook"("clientId", "category");

-- CreateIndex
CREATE INDEX "ContentCheck_clientId_createdAt_idx" ON "ContentCheck"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "PostDraft_clientId_updatedAt_idx" ON "PostDraft"("clientId", "updatedAt");

-- AddForeignKey
ALTER TABLE "ClientFeatureFlag" ADD CONSTRAINT "ClientFeatureFlag_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFile" ADD CONSTRAINT "MediaFile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentIdea" ADD CONSTRAINT "ContentIdea_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hook" ADD CONSTRAINT "Hook_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCheck" ADD CONSTRAINT "ContentCheck_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostDraft" ADD CONSTRAINT "PostDraft_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

