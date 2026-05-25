-- Tokens for first-time invite + password reset flows.
--
-- A row is inserted when:
--   1. An admin creates a user (users.controller.create) - the new user
--      receives an email containing /reset-password?token=<token> so they
--      can set their initial password.
--   2. A user hits POST /api/auth/forgot-password - same token, sent to
--      their email so they can recover access.
--
-- Tokens are single-use: `used_at` is stamped on POST /api/auth/reset-password.
-- Tokens expire after PASSWORD_RESET_TTL_MIN (default 1440 = 24h).
--
-- We never store the raw token - the `token_hash` column holds a sha256 of
-- the token, so a DB leak doesn't expose live reset links.

CREATE TABLE IF NOT EXISTS `password_resets` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `token_hash` CHAR(64)        NOT NULL,
  `purpose`    ENUM('invite','reset') NOT NULL DEFAULT 'reset',
  `expires_at` DATETIME        NOT NULL,
  `used_at`    DATETIME        NULL,
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_password_resets_token_hash` (`token_hash`),
  KEY `idx_password_resets_user` (`user_id`, `used_at`),
  CONSTRAINT `fk_password_resets_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
