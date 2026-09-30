-- AlterTable
ALTER TABLE `Registrant` ADD COLUMN `lineNotifiedDays` JSON NULL;

-- CreateTable
CREATE TABLE `NotificationLog` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `registrantId` VARCHAR(191) NOT NULL,
    `channel` ENUM('EMAIL', 'LINE', 'BOTH') NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `status` ENUM('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'QUEUED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `retryKey` CHAR(36) NOT NULL,
    `error` VARCHAR(255) NULL,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `NotificationLog_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `NotificationLog_registrantId_createdAt_idx`(`registrantId`, `createdAt`),
    INDEX `NotificationLog_eventId_status_idx`(`eventId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NotificationLog` ADD CONSTRAINT `NotificationLog_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationLog` ADD CONSTRAINT `NotificationLog_registrantId_fkey` FOREIGN KEY (`registrantId`) REFERENCES `Registrant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

