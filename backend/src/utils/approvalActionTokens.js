// One-time tokens for the "click to approve" links in approver emails.
// Mirrors the password_resets / passwordResetTokens pattern: raw tokens are
// emailed but only the sha256 hash is persisted.
//
// The token alone never authorizes - the decide endpoint still requires the
// caller to be logged in AND for req.user.id to match the approval row's
// approver_user_id. The token only identifies WHICH approval row this link
// is for, so we can land the approver on the right page.

const crypto = require('crypto');
const { query, execute } = require('../db/pool');
const config = require('../config');

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Mint a new one-time token for a booking_approvals row and return the raw
 * token string. Expires after `resetTtlMin` (reuses the same env var as
 * password resets - sensible default for action links too).
 */
async function issueToken(bookingApprovalId) {
  const raw = crypto.randomBytes(32).toString('hex'); // 64 hex chars
  const hash = hashToken(raw);
  const expires = new Date(Date.now() + config.mail.resetTtlMin * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  await execute(
    'INSERT INTO `approval_action_tokens` (token_hash, booking_approval_id, expires_at) ' +
    'VALUES (?, ?, ?)',
    [hash, bookingApprovalId, expires]
  );
  return raw;
}

/**
 * Look up an unused, unexpired token and return its row (with the joined
 * booking_approvals row id). Returns null if invalid.
 */
async function consumeToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const hash = hashToken(raw);
  const rows = await query(
    'SELECT id, booking_approval_id, expires_at, used_at ' +
    '  FROM `approval_action_tokens` WHERE token_hash = ? LIMIT 1',
    [hash]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

async function markUsed(id) {
  await execute('UPDATE `approval_action_tokens` SET used_at = NOW() WHERE id = ?', [id]);
}

module.exports = { issueToken, consumeToken, markUsed };
