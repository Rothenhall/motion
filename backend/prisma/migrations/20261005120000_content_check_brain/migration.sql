-- Per-second simulated cortical map for the pre-flight brain view, kept out of `signals` so lists stay small.
ALTER TABLE "ContentCheck" ADD COLUMN "brain" TEXT;
ALTER TABLE "ContentCheck" ADD COLUMN "brainStatus" TEXT;
