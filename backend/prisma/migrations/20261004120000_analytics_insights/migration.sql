-- AlterTable
ALTER TABLE "ScheduledPost" ADD COLUMN "permalink" TEXT;

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN "insightsError" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN "insightsSyncedAt" DATETIME;
ALTER TABLE "SocialAccount" ADD COLUMN "meta" TEXT;

-- CreateTable
CREATE TABLE "AccountInsight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "metric" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountInsight_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostInsight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "views" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "engagements" INTEGER,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostInsight_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ScheduledPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostInsight_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AccountInsight_date_idx" ON "AccountInsight"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AccountInsight_accountId_date_metric_key" ON "AccountInsight"("accountId", "date", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "PostInsight_postId_key" ON "PostInsight"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_provider_externalId_key" ON "SocialAccount"("provider", "externalId");

