-- Super-admin owned. Lookup masters tenants pick from.
-- These are the only "globals" without a tenant_id.

CREATE TABLE IF NOT EXISTS `currencies` (
  `code`     VARCHAR(8)  NOT NULL,        -- ISO-4217: 'INR','USD','EUR'
  `name`     VARCHAR(80) NOT NULL,        -- 'Indian Rupee'
  `symbol`   VARCHAR(8)  NOT NULL,        -- '₹'
  `decimals` TINYINT     NOT NULL DEFAULT 2,
  `status`   TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `timezones` (
  `name`         VARCHAR(64)  NOT NULL,   -- IANA: 'Asia/Kolkata'
  `display_name` VARCHAR(120) NOT NULL,   -- 'India Standard Time'
  `utc_offset`   VARCHAR(8)   NOT NULL,   -- '+05:30'
  `status`       TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `locales` (
  `code`        VARCHAR(16) NOT NULL,     -- 'en-IN','en-US','ar-AE'
  `name`        VARCHAR(80) NOT NULL,     -- 'English (India)'
  `native_name` VARCHAR(80) NULL,
  `status`      TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
