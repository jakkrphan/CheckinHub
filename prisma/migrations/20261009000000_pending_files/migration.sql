-- Journal of stored files that may be orphaned, so the orphan sweep deletes only files this database wrote.

-- CreateTable
CREATE TABLE `PendingFile` (
    `key` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PendingFile_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
