-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CommentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT,
    "platform" TEXT NOT NULL,
    "mediaId" TEXT,
    "commentId" TEXT NOT NULL,
    "senderId" TEXT,
    "text" TEXT,
    "replied" BOOLEAN NOT NULL DEFAULT false,
    "dmSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommentEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CommentEvent" ("commentId", "createdAt", "dmSent", "id", "mediaId", "platform", "replied", "senderId", "text") SELECT "commentId", "createdAt", "dmSent", "id", "mediaId", "platform", "replied", "senderId", "text" FROM "CommentEvent";
DROP TABLE "CommentEvent";
ALTER TABLE "new_CommentEvent" RENAME TO "CommentEvent";
CREATE UNIQUE INDEX "CommentEvent_accountId_commentId_key" ON "CommentEvent"("accountId", "commentId");
CREATE TABLE "new_SocialAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "accessToken" TEXT NOT NULL,
    "tokenExpires" DATETIME,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SocialAccount" ("accessToken", "createdAt", "externalId", "id", "meta", "name", "provider", "tokenExpires", "updatedAt") SELECT "accessToken", "createdAt", "externalId", "id", "meta", "name", "provider", "tokenExpires", "updatedAt" FROM "SocialAccount";
DROP TABLE "SocialAccount";
ALTER TABLE "new_SocialAccount" RENAME TO "SocialAccount";
CREATE INDEX "SocialAccount_provider_externalId_idx" ON "SocialAccount"("provider", "externalId");
CREATE UNIQUE INDEX "SocialAccount_userId_provider_externalId_key" ON "SocialAccount"("userId", "provider", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
