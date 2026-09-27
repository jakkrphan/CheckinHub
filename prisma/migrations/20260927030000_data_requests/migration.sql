-- PDPA data-subject requests (delete my data) sent from the status page.
-- CreateTable
CREATE TABLE `DataRequest` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `registrantId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(32) NOT NULL DEFAULT 'DELETE',
    `status` ENUM('OPEN', 'COMPLETED', 'REJECTED') NOT NULL DEFAULT 'OPEN',
    `reason` TEXT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,
    `resolvedById` VARCHAR(191) NULL,
    `resolutionNote` TEXT NULL,

    INDEX `DataRequest_eventId_status_requestedAt_idx`(`eventId`, `status`, `requestedAt`),
    INDEX `DataRequest_registrantId_status_idx`(`registrantId`, `status`),
    INDEX `DataRequest_resolvedById_idx`(`resolvedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DataRequest` ADD CONSTRAINT `DataRequest_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DataRequest` ADD CONSTRAINT `DataRequest_registrantId_fkey` FOREIGN KEY (`registrantId`) REFERENCES `Registrant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DataRequest` ADD CONSTRAINT `DataRequest_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

