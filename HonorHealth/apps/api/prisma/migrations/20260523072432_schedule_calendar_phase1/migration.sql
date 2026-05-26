-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "currentOfficerId" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "location" TEXT NOT NULL,
    "roleRequired" TEXT NOT NULL,
    "armedRequired" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Assigned',
    "scheduledById" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'Manual',
    "notes" TEXT,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Shift" ("armedRequired", "createdAt", "currentOfficerId", "endAt", "id", "location", "roleRequired", "startAt", "status", "updatedAt") SELECT "armedRequired", "createdAt", "currentOfficerId", "endAt", "id", "location", "roleRequired", "startAt", "status", "updatedAt" FROM "Shift";
DROP TABLE "Shift";
ALTER TABLE "new_Shift" RENAME TO "Shift";
CREATE INDEX "Shift_currentOfficerId_idx" ON "Shift"("currentOfficerId");
CREATE INDEX "Shift_status_idx" ON "Shift"("status");
CREATE INDEX "Shift_startAt_idx" ON "Shift"("startAt");
CREATE INDEX "Shift_endAt_idx" ON "Shift"("endAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
