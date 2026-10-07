-- AlterTable
ALTER TABLE "ScheduledPost" ADD COLUMN     "approvalDecidedAt" TIMESTAMP(3),
ADD COLUMN     "approvalDecidedById" TEXT,
ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvalStatus" TEXT;

-- CreateIndex
CREATE INDEX "ScheduledPost_approvalStatus_createdAt_idx" ON "ScheduledPost"("approvalStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledPost_accountId_approvalStatus_idx" ON "ScheduledPost"("accountId", "approvalStatus");

