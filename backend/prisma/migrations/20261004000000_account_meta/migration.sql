-- Brings migration history in line with the schema already in use:
-- SocialAccount.meta and the (provider, externalId) unique index were added
-- to schema.prisma without a migration.
ALTER TABLE "SocialAccount" ADD COLUMN "meta" TEXT;

CREATE UNIQUE INDEX "SocialAccount_provider_externalId_key" ON "SocialAccount"("provider", "externalId");
