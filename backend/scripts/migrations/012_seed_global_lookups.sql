-- Global lookup data. Idempotent: INSERT IGNORE keeps re-runs safe.

-- Currencies ---------------------------------------------------------------
INSERT IGNORE INTO `currencies` (`code`,`name`,`symbol`,`decimals`) VALUES
  ('INR','Indian Rupee',          '₹', 2),
  ('USD','US Dollar',              '$', 2),
  ('EUR','Euro',                   '€', 2),
  ('GBP','Pound Sterling',         '£', 2),
  ('AED','UAE Dirham',         'د.إ', 2),
  ('SGD','Singapore Dollar',  'S$', 2);

-- Timezones (just the common ones — extend as you onboard new regions) ----
INSERT IGNORE INTO `timezones` (`name`,`display_name`,`utc_offset`) VALUES
  ('Asia/Kolkata',      'India Standard Time',         '+05:30'),
  ('Asia/Dubai',        'Gulf Standard Time',          '+04:00'),
  ('Asia/Singapore',    'Singapore Time',              '+08:00'),
  ('Europe/London',     'Greenwich Mean Time',         '+00:00'),
  ('America/New_York',  'Eastern Time',                '-05:00'),
  ('Australia/Sydney',  'Australian Eastern Time',     '+10:00');

-- Locales -----------------------------------------------------------------
INSERT IGNORE INTO `locales` (`code`,`name`,`native_name`) VALUES
  ('en-IN', 'English (India)',         'English'),
  ('en-US', 'English (United States)', 'English'),
  ('en-GB', 'English (UK)',            'English'),
  ('hi-IN', 'Hindi',                   'हिन्दी'),
  ('ar-AE', 'Arabic (UAE)',            'العربية');
