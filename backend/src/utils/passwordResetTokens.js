// Helpers for issuing + consuming one-time tokens stored in `password_resets`.
//
// Raw tokens are returned to the caller (so we can email them) but only the
// sha256 hash is persisted, so a DB read does not yield usable links.

const crypto = require('crypto');
const { query, execute } = require('../db/pool');
const config = require('../config');

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Mints a one-time token, inserts it into password_resets, and returns the
 * raw token string for the caller to email.
 *
 *   purpose: 'invite' (new user) or 'reset' (forgot password)
 */
async function issueToken(userId, purpose) {
  const raw = crypto.randomBytes(32).toString('hex'); // 64 hex chars
  const hash = hashToken(raw);
  const expires = new Date(Date.now() + config.mail.resetTtlMin * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  await execute(
    'INSERT INTO `password_resets` (user_id, token_hash, purpose, expires_at) ' +
    'VALUES (?, ?, ?, ?)',
    [userId, hash, purpose === 'invite' ? 'invite' : 'reset', expires]
  );
  return raw;
}

/**
 * Looks up a token (by raw value) and returns its row if valid + unused +
 * not expired. Returns null otherwise.
 */
async function consumeToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const hash = hashToken(raw);
  const rows = await query(
    'SELECT id, user_id, purpose, expires_at, used_at ' +
    '  FROM `password_resets` WHERE token_hash = ? LIMIT 1',
    [hash]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

async function markUsed(id) {
  await execute(
    'UPDATE `password_resets` SET used_at = NOW() WHERE id = ?',
    [id]
  );
}

module.exports = { issueToken, consumeToken, markUsed };
