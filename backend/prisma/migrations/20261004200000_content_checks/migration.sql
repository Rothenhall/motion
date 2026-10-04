-- CreateTable
CREATE TABLE "ContentCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT,
    "label" TEXT,
    "kind" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "caption" TEXT,
    "text" TEXT,
    "mediaUrls" TEXT NOT NULL DEFAULT '[]',
    "mediaHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "engine" TEXT,
    "signals" TEXT,
    "report" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentCheck_userId_createdAt_idx" ON "ContentCheck"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentCheck_status_createdAt_idx" ON "ContentCheck"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentCheck_groupId_idx" ON "ContentCheck"("groupId");

-- AddForeignKey
ALTER TABLE "ContentCheck" ADD CONSTRAINT "ContentCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
