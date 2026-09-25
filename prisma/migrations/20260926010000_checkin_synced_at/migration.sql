-- When the server recorded the check-in (differs from checkedInAt for scans synced from the offline queue).
ALTER TABLE `CheckIn` ADD COLUMN `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
UPDATE `CheckIn` SET `syncedAt` = `checkedInAt`;
CREATE INDEX `CheckIn_sessionId_syncedAt_idx` ON `CheckIn`(`sessionId`, `syncedAt`);
