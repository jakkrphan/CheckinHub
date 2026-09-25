ALTER TABLE `Event` ADD COLUMN `deletedAt` DATETIME(3) NULL;
CREATE INDEX `Event_deletedAt_idx` ON `Event`(`deletedAt`);

ALTER TABLE `CheckIn`
  ADD COLUMN `voidedAt` DATETIME(3) NULL,
  ADD COLUMN `voidedById` VARCHAR(191) NULL,
  ADD COLUMN `activeKey` VARCHAR(191) NULL,
  ADD COLUMN `clientEventId` VARCHAR(191) NULL;
UPDATE `CheckIn` SET `activeKey` = CONCAT(`registrantId`, ':', `sessionId`);
CREATE INDEX `CheckIn_registrantId_idx` ON `CheckIn`(`registrantId`);
ALTER TABLE `CheckIn` DROP INDEX `CheckIn_registrantId_sessionId_key`;
CREATE UNIQUE INDEX `CheckIn_activeKey_key` ON `CheckIn`(`activeKey`);
CREATE UNIQUE INDEX `CheckIn_clientEventId_key` ON `CheckIn`(`clientEventId`);
CREATE INDEX `CheckIn_sessionId_voidedAt_checkedInAt_idx` ON `CheckIn`(`sessionId`, `voidedAt`, `checkedInAt`);
ALTER TABLE `CheckIn` ADD CONSTRAINT `CheckIn_voidedById_fkey` FOREIGN KEY (`voidedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
