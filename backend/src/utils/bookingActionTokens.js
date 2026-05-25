// One-time tokens used in booking-confirmation emails so the booker can
// reschedule or cancel without re-logging-in twice. Mirrors the approval
// action token pattern: raw token is emailed, only the sha256 hash is
// persisted, and the consuming endpoint STILL requires a logged-in session
// whose req.user.id matches the row's user_id.

const crypto = require('crypto');
const { query, execute } = require('../db/pool');
const config = require('../config');

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function issueToken(bookingId, userId, action, ttlMin) {
  if (!['cancel', 'reschedule'].includes(action)) {
    throw new Error('Invalid action: ' + action);
  }
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(raw);
  const minutes = ttlMin || (7 * 24 * 60); // 7 days
  const expires = new Date(Date.now() + minutes * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  await execute(
    'INSERT INTO `booking_action_tokens` ' +
    '(booking_id, user_id, action, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
    [bookingId, userId, action, hash, expires]
  );
  return raw;
}

async function consumeToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const hash = hashToken(raw);
  const rows = await query(
    'SELECT id, booking_id, user_id, action, expires_at, used_at ' +
    '  FROM `booking_action_tokens` WHERE token_hash = ? LIMIT 1',
    [hash]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

async function markUsed(id) {
  await execute('UPDATE `booking_action_tokens` SET used_at = NOW() WHERE id = ?', [id]);
}

// Use in emails to print eg. {APP_URL}/bookings/42/act?token=...&action=cancel
function buildActionUrl(appUrl, bookingId, action, rawToken) {
  const u = new URL(`${appUrl.replace(/\/$/, '')}/bookings/${bookingId}/act`);
  u.searchParams.set('token', rawToken);
  u.searchParams.set('action', action);
  return u.toString();
}

// `config.mail.resetTtlMin` is reused indirectly via default fallback above;
// no direct usage here, keep the import only when needed.
void config;

module.exports = { issueToken, consumeToken, markUsed, buildActionUrl };
