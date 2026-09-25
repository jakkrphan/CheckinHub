ALTER TABLE `RegistrantEventDay`
  ADD COLUMN `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WAITLISTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `waitlistedAt` DATETIME(3) NULL;

UPDATE `RegistrantEventDay` AS `day`
JOIN `Registrant` AS `person` ON `person`.`id` = `day`.`registrantId`
SET `day`.`status` = `person`.`status`,
    `day`.`waitlistedAt` = CASE WHEN `person`.`status` = 'WAITLISTED' THEN `person`.`registeredAt` ELSE NULL END;

CREATE INDEX `RegistrantEventDay_eventDayId_status_waitlistedAt_idx`
  ON `RegistrantEventDay`(`eventDayId`, `status`, `waitlistedAt`);

DROP INDEX `RegistrantEventDay_eventDayId_idx` ON `RegistrantEventDay`;
