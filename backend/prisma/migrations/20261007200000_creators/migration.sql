-- Creators tab: per-client shortlist of Instagram creators saved from search results.
CREATE TABLE "CreatorShortlist" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "creatorId" TEXT,
    "profilePictureUrl" TEXT,
    "biography" TEXT,
    "country" TEXT,
    "followers" INTEGER,
    "verified" BOOLEAN,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorShortlist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreatorShortlist_clientId_username_key" ON "CreatorShortlist"("clientId", "username");
CREATE INDEX "CreatorShortlist_clientId_createdAt_idx" ON "CreatorShortlist"("clientId", "createdAt");

ALTER TABLE "CreatorShortlist" ADD CONSTRAINT "CreatorShortlist_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
