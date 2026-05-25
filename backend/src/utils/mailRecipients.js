// Look up email recipients for the various "X created" notifications.
//
// All helpers swallow DB errors and return [] - email is fire-and-forget so we
// never want the create-handler to fail just because we couldn't load the
// recipient list.

const { query } = require('../db/pool');

/**
 * All active tenant_admin email addresses for a tenant. Used by Site / Floor
 * create notifications.
 */
async function tenantAdminEmails(tenantId) {
  if (!tenantId) return [];
  try {
    const rows = await query(
      "SELECT email FROM `users` " +
      " WHERE tenant_id = ? AND role = 'tenant_admin' AND trash = 0 AND status = 1 " +
      "   AND email IS NOT NULL AND email <> ''",
      [tenantId]
    );
    return rows.map((r) => r.email).filter(Boolean);
  } catch (err) {
    console.error('[mailRecipients] tenantAdminEmails failed:', err && err.message);
    return [];
  }
}

/**
 * Looks up a single user's email + display name by id.
 * Returns { email, name } or null. Returns null if the user has no email.
 */
async function userContact(userId) {
  if (!userId) return null;
  try {
    const rows = await query(
      'SELECT email, name, lname FROM `users` ' +
      ' WHERE id = ? AND trash = 0 LIMIT 1',
      [userId]
    );
    if (rows.length === 0 || !rows[0].email) return null;
    const u = rows[0];
    return {
      email: u.email,
      name: [u.name, u.lname].filter(Boolean).join(' ') || null,
    };
  } catch (err) {
    console.error('[mailRecipients] userContact failed:', err && err.message);
    return null;
  }
}

/**
 * Convenience: returns tenant.name for a given id, or null.
 */
async function tenantName(tenantId) {
  if (!tenantId) return null;
  try {
    const rows = await query(
      'SELECT name FROM `tenants` WHERE id = ? LIMIT 1',
      [tenantId]
    );
    return rows.length > 0 ? rows[0].name : null;
  } catch (err) {
    console.error('[mailRecipients] tenantName failed:', err && err.message);
    return null;
  }
}

module.exports = { tenantAdminEmails, userContact, tenantName };
