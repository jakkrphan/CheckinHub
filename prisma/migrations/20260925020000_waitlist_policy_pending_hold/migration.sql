ALTER TABLE `Event`
  ADD COLUMN `pendingHoldHours` INTEGER NULL,
  ADD COLUMN `waitlistPromotion` ENUM('MANUAL', 'AUTO') NOT NULL DEFAULT 'MANUAL';

-- Existing events keep the behavior they used before this setting existed.
UPDATE `Event` SET `waitlistPromotion` = 'AUTO';

ALTER TABLE `RegistrantEventDay` ADD COLUMN `pendingSince` DATETIME(3) NULL;

UPDATE `RegistrantEventDay` AS `day`
JOIN `Registrant` AS `person` ON `person`.`id` = `day`.`registrantId`
SET `day`.`pendingSince` = `person`.`registeredAt`
WHERE `day`.`status` = 'PENDING';

CREATE INDEX `RegistrantEventDay_status_pendingSince_idx`
  ON `RegistrantEventDay`(`status`, `pendingSince`);
