-- Registrant name denormalized from answers for search/ordering (spec 1.7). Existing rows are filled by
-- scripts/backfill-display-names.mjs, which applies the same rules as the app.
ALTER TABLE `Registrant` ADD COLUMN `displayName` VARCHAR(191) NULL;
CREATE INDEX `Registrant_eventId_displayName_idx` ON `Registrant`(`eventId`, `displayName`);
