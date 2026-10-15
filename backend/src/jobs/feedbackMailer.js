// Feedback request mailer.
//
// Runs every FEEDBACK_MAIL_SWEEP_MS ms (default 10 min). For every booking
// that is:
//   • status = 'completed'                 (user actually used the facility)
//   • end_at < NOW() - FEEDBACK_DELAY_MIN  (small buffer so we don't email
//                                           the instant checkoutSweeper
//                                           flips the row)
//   • feedback_email_sent_at IS NULL       (not yet asked)
//   • trash = 0
// it sends one feedback-request email to the booker and stamps
// feedback_email_sent_at = NOW() so the next sweep skips the row.
//
// Note on the status filter: 'completed' is the ONLY status that implies
// the user turned up. 'released' = no-show, 'cancelled' = withdrew,
// 'rejected' = admin didn't approve, 'pending'/'approved' = booking not
// finished yet. None of those should receive a feedback request.
//
// Modes (FEEDBACK_MAIL_SWEEP_MODE env):
//   'enforce' (default) - send emails + stamp feedback_email_sent_at
//   'log'               - dry run; log who would be emailed, write nothing

const { query } = require('../db/pool');
const config = require('../config');
const mailer = require('../utils/mailer');
const ratingToken = require('../utils/ratingToken');

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_DELAY_MIN = 5;                // buffer after end_at
const DEFAULT_BATCH = 25;                   // emails per sweep
let timer = null;

function mode() {
  return String(process.env.FEEDBACK_MAIL_SWEEP_MODE || 'enforce').toLowerCase() === 'log'
    ? 'log' : 'enforce';
}

function delayMin() {
  const n = Number(process.env.FEEDBACK_DELAY_MIN);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DELAY_MIN;
}

function batchSize() {
  const n = Number(process.env.FEEDBACK_MAIL_BATCH);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_BATCH;
}

function publicUrlBase() {
  // Reuse the same public URL base used by other email flows.
  return String((config.mail && config.mail.publicUrl) || '').replace(/\/$/, '');
}

async function sweepOnce() {
  const dMin = delayMin();
  const m = mode();

  // Pull candidate rows + the join metadata the email needs in a single
  // query — keeps per-row work to Node (sign token, call mailer).
  const rows = await query(
    "SELECT b.id, b.user_id, b.start_at, b.end_at, " +
    "       f.name AS facility_name, f.type AS facility_type, " +
    "       s.name AS site_name, " +
    "       u.email AS booker_email, " +
    "       TRIM(CONCAT_WS(' ', u.name, u.lname)) AS booker_name " +
    "  FROM `bookings` b " +
    "  INNER JOIN `facilities` f ON f.id = b.facility_id " +
    "  LEFT JOIN `sites` s ON s.id = f.site_id " +
    "  INNER JOIN `users` u ON u.id = b.user_id " +
    " WHERE b.status = 'completed' " +
    "   AND b.trash = 0 " +
    "   AND b.feedback_email_sent_at IS NULL " +
    "   AND b.end_at < DATE_SUB(NOW(), INTERVAL ? MINUTE) " +
    " ORDER BY b.end_at ASC LIMIT " + batchSize(),
    [dMin]
  );

  if (rows.length === 0) return { processed: 0 };

  let processed = 0;
  for (const r of rows) {
    try {
      if (!r.booker_email) {
        // No email on file — stamp so we don't keep re-scanning this row
        // every tick for nothing.
        if (m === 'enforce') {
          await query(
            'UPDATE `bookings` SET feedback_email_sent_at = NOW() WHERE id = ?',
            [r.id]
          );
        }
        continue;
      }

      const token = ratingToken.sign(r.id, r.user_id);
      const base = publicUrlBase();
      const ratingUrl = (base ? base : '') + '/rate/' + encodeURIComponent(token);

      if (m === 'log') {
        console.log(
          '[feedbackMailer] WOULD send to', r.booker_email,
          'for booking', r.id, '→', ratingUrl
        );
      } else {
        mailer.feedbackRequest({
          to: r.booker_email,
          bookerName: r.booker_name || null,
          facilityName: r.facility_name,
          facilityType: r.facility_type,
          siteName: r.site_name,
          startAt: r.start_at,
          endAt: r.end_at,
          ratingUrl,
        });
        // Stamp immediately — mailer.feedbackRequest is fire-and-forget,
        // we don't want a transient SMTP hiccup to re-trigger on the
        // next tick. Admin can grep '[mailer] sent feedbackRequest' logs
        // to confirm actual delivery.
        await query(
          'UPDATE `bookings` SET feedback_email_sent_at = NOW() WHERE id = ?',
          [r.id]
        );
      }
      processed++;
    } catch (err) {
      console.error('[feedbackMailer] booking #' + r.id + ' failed:', err && err.message);
    }
  }

  if (processed > 0) {
    console.log('[feedbackMailer] processed ' + processed + ' booking(s) in ' + m + ' mode');
  }
  return { processed };
}

function start(intervalMs) {
  const ms = Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_INTERVAL_MS;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    sweepOnce().catch((e) => console.error('[feedbackMailer] sweep failed:', e && e.message));
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(
    `[feedbackMailer] started (every ${Math.round(ms / 1000)}s, mode=${mode()}, delay=${delayMin()}m)`
  );
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, sweepOnce };
