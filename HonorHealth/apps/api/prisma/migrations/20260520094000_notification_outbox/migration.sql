ALTER TABLE "Notification" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Notification" ADD COLUMN "lastError" TEXT;
ALTER TABLE "Notification" ADD COLUMN "nextAttemptAt" DATETIME;
ALTER TABLE "Notification" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Notification_nextAttemptAt_idx" ON "Notification"("nextAttemptAt");
