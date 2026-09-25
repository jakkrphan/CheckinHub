-- Remembers which event a draft was cloned from, for the "cloned from" chip on the project list.
ALTER TABLE `Event` ADD COLUMN `clonedFromId` VARCHAR(191) NULL;
CREATE INDEX `Event_clonedFromId_idx` ON `Event`(`clonedFromId`);
ALTER TABLE `Event` ADD CONSTRAINT `Event_clonedFromId_fkey` FOREIGN KEY (`clonedFromId`) REFERENCES `Event`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
