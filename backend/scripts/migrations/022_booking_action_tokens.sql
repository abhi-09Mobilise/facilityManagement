-- F07 - Reschedule / cancel via mail.
--
-- Tokens are emailed to the booker (raw); the sha256 hash is persisted.
-- The endpoint that consumes a token STILL requires login and STILL
-- verifies req.user.id === user_id. Token alone never authorizes.

CREATE TABLE IF NOT EXISTS `booking_action_tokens` (
  `id`         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `action`     ENUM('cancel','reschedule') NOT NULL,
  `token_hash` CHAR(64) NOT NULL UNIQUE,
  `expires_at` DATETIME NOT NULL,
  `used_at`    DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_bat_booking` (`booking_id`),
  KEY `idx_bat_user` (`user_id`),
  CONSTRAINT `fk_bat_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bat_user`    FOREIGN KEY (`user_id`)    REFERENCES `users`(`id`)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
