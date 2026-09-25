-- Staff accounts: invited users have no password until they accept the invitation.
ALTER TABLE `User` MODIFY `passwordHash` VARCHAR(191) NULL;

CREATE TABLE `UserToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` ENUM('INVITE', 'RESET') NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `UserToken_tokenHash_key`(`tokenHash`),
    INDEX `UserToken_userId_kind_idx`(`userId`, `kind`),
    INDEX `UserToken_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `UserToken` ADD CONSTRAINT `UserToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserToken` ADD CONSTRAINT `UserToken_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `LoginAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `keyHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `LoginAttempt_keyHash_createdAt_idx`(`keyHash`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Form schema versioning.
ALTER TABLE `Event` ADD COLUMN `fieldsVersion` INTEGER NOT NULL DEFAULT 1;

-- Registrant: consent evidence, reject reason, and dedupe key that is released on cancel/reject.
ALTER TABLE `Registrant`
    ADD COLUMN `fieldsVersion` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `consentVersion` VARCHAR(191) NULL,
    ADD COLUMN `consentIp` VARCHAR(64) NULL,
    ADD COLUMN `dedupeKey` VARCHAR(191) NULL,
    ADD COLUMN `rejectReason` TEXT NULL;
UPDATE `Registrant` SET `dedupeKey` = LOWER(TRIM(`email`)) WHERE `email` IS NOT NULL AND `status` NOT IN ('CANCELLED', 'REJECTED');
UPDATE `Registrant` SET `consentVersion` = 'v1' WHERE `consentedAt` IS NOT NULL;
CREATE INDEX `Registrant_eventId_email_idx` ON `Registrant`(`eventId`, `email`);
CREATE UNIQUE INDEX `Registrant_eventId_dedupeKey_key` ON `Registrant`(`eventId`, `dedupeKey`);
DROP INDEX `Registrant_eventId_email_key` ON `Registrant`;

-- Check-in override for staff with full access.
ALTER TABLE `CheckIn`
    ADD COLUMN `isOverride` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `overrideNote` VARCHAR(500) NULL;
