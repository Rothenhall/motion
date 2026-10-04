-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "niche" TEXT NOT NULL,
    "audience" TEXT,
    "voice" TEXT,
    "pillars" TEXT NOT NULL DEFAULT '[]',
    "platforms" TEXT NOT NULL DEFAULT '["instagram"]',
    "autopilot" BOOLEAN NOT NULL DEFAULT false,
    "ideasPerRun" INTEGER NOT NULL DEFAULT 5,
    "lastAutopilotAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ContentIdea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "angle" TEXT,
    "format" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "pillar" TEXT,
    "caption" TEXT,
    "hashtags" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "topic" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Hook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "platform" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SEED',
    "topic" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ContentIdea_status_createdAt_idx" ON "ContentIdea"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Hook_category_idx" ON "Hook"("category");

