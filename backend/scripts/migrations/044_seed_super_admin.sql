-- Seed: a single super-admin login so the app is usable on a fresh DB.
--
-- Username: superadmin
-- Password: admin123   (bcrypt hash below, cost 10)
--
-- IDEMPOTENT: uses INSERT IGNORE against the UNIQUE KEY on `username`, so
-- re-running is a no-op if the row is already there. If the super admin
-- already exists (from an earlier seed run or another migration), the
-- password / other fields are left untouched — that's intentional so this
-- migration never clobbers a rotated password.
--
-- tenant_id / organisation_id are NULL because super_admin is platform-
-- scoped (not tied to any tenant or org). The users.organisation_id column
-- was added in migration 036 and stays NULLable for exactly this reason.

INSERT IGNORE INTO `users`
  (`tenant_id`, `organisation_id`, `username`, `password`,
   `name`, `lname`, `email`,
   `role`, `status`, `is_approved`, `is_approver`, `trash`)
VALUES
  (NULL, NULL, 'superadmin',
   '$2a$10$ReEPWiZW3UsEVy.fJ6rr7Ou06O3.o3dbptED7PdCYkgRRuRdGPPk2',
   'Super', 'Admin', 'superadmin@local',
   'super_admin', 1, 1, 0, 0);
