-- Registrant self-service edits are audited without a staff actor.
ALTER TABLE `AuditLog` MODIFY `actorId` VARCHAR(191) NULL;

-- How a check-in was recorded: camera | scanner | manual | kiosk | override.
ALTER TABLE `CheckIn` ADD COLUMN `method` VARCHAR(16) NULL;

-- PDPA retention: personal data is anonymized retentionDays after the last event day.
ALTER TABLE `Event` ADD COLUMN `anonymizedAt` DATETIME(3) NULL,
    ADD COLUMN `retentionDays` INTEGER NOT NULL DEFAULT 365;
ALTER TABLE `Registrant` ADD COLUMN `anonymizedAt` DATETIME(3) NULL;

-- Explicit session order, backfilled from the previous implicit order (day, then label).
ALTER TABLE `Session` ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0;
UPDATE `Session` s
JOIN (
  SELECT se.`id`, ROW_NUMBER() OVER (PARTITION BY se.`eventId` ORDER BY ed.`date` IS NULL, ed.`date`, se.`label`, se.`id`) AS rn
  FROM `Session` se LEFT JOIN `EventDay` ed ON ed.`id` = se.`eventDayId`
) ordered ON ordered.`id` = s.`id`
SET s.`sortOrder` = ordered.rn;
