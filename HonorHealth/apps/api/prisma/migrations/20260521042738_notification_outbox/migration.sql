-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipientId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "sentAt" DATETIME,
    "deliveryStatus" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Notification" ("attempts", "channel", "createdAt", "deliveryStatus", "id", "lastError", "nextAttemptAt", "recipientId", "sentAt", "template", "updatedAt") SELECT "attempts", "channel", "createdAt", "deliveryStatus", "id", "lastError", "nextAttemptAt", "recipientId", "sentAt", "template", "updatedAt" FROM "Notification";
DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";
CREATE INDEX "Notification_recipientId_idx" ON "Notification"("recipientId");
CREATE INDEX "Notification_deliveryStatus_idx" ON "Notification"("deliveryStatus");
CREATE INDEX "Notification_nextAttemptAt_idx" ON "Notification"("nextAttemptAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
