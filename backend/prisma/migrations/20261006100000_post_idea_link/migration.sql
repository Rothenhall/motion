-- A scheduled post can point back at the content idea it was written from.
ALTER TABLE "ScheduledPost" ADD COLUMN "ideaId" TEXT;
CREATE INDEX "ScheduledPost_ideaId_idx" ON "ScheduledPost"("ideaId");
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ContentIdea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
