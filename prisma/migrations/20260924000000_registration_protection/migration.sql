ALTER TABLE `Registrant` ADD COLUMN `consentedAt` DATETIME(3) NULL;

CREATE TABLE `RegistrationAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `ipHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RegistrationAttempt_ipHash_createdAt_idx`(`ipHash`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
