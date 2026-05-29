// Outbound mail helper. Wraps nodemailer with a single lazily-built
// transporter + a set of templated senders.
//
// Logging:
//   - verifyConnection()  prints SMTP OK / unreachable / "no auth" warning
//                         once at server boot.
//   - sendMail()          logs both success ([mailer] sent ...) and failure.
//   - Each high-level helper (approvalRequested, tenantCreated, ...) logs a
//     "triggered" line BEFORE handing off to sendMail.
//
// All sends are fire-and-forget. Errors are logged but never thrown.
//
// Configure via .env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE,
// MAIL_FROM, APP_PUBLIC_URL, PASSWORD_RESET_TTL_MIN.

const nodemailer = require('nodemailer');
const config = require('../config');
const templates = require('./mailTemplates');

let _transporter = null;

function hasAuth() {
  return Boolean(config.mail.user && config.mail.pass);
}

function getTransporter() {
  if (_transporter) return _transporter;
  if (!config.mail.host) {
    console.warn('[mailer] SMTP_HOST is empty - emails will be skipped');
    return null;
  }
  _transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: hasAuth()
      ? { user: config.mail.user, pass: config.mail.pass }
      : undefined,
    // Honor SMTP_REJECT_UNAUTHORIZED so internal company SMTP with
    // self-signed certs works. Defaults to true (Node's normal behavior).
    tls: { rejectUnauthorized: config.mail.rejectUnauthorized },
  });
  return _transporter;
}

// Extract just the email address from a "Name <addr@domain>" From string.
function extractFromAddr(from) {
  if (!from) return '';
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}
function domainOf(addr) {
  const at = addr.indexOf('@');
  return at >= 0 ? addr.slice(at + 1) : '';
}

async function verifyConnection() {
  if (!config.mail.host) {
    console.warn('[mailer] SMTP_HOST is empty - mail service disabled');
    return { ok: false, err: new Error('SMTP_HOST not set') };
  }
  const tx = getTransporter();
  if (!tx) return { ok: false, err: new Error('No transporter') };
  try {
    await tx.verify();
    if (hasAuth()) {
      console.log(
        `[mailer] SMTP OK (${config.mail.host}:${config.mail.port}` +
        `${config.mail.secure ? ', TLS' : ''}) - authenticated as ${config.mail.user}`
      );
      // Warn when MAIL_FROM is on a different domain than the authenticated
      // SMTP user. The send call succeeds but receivers fail SPF/DKIM/DMARC.
      const fromAddr = extractFromAddr(config.mail.from);
      const fromDomain = domainOf(fromAddr);
      const userDomain = domainOf((config.mail.user || '').toLowerCase());
      if (fromDomain && userDomain && fromDomain !== userDomain) {
        console.warn(
          `[mailer] WARNING From=${fromAddr} (domain "${fromDomain}") does not match ` +
          `SMTP user "${config.mail.user}" (domain "${userDomain}"). ` +
          'External receivers will likely reject this on SPF/DKIM/DMARC, ' +
          'so the SMTP call may succeed but the email never gets delivered. ' +
          'Change MAIL_FROM in .env to an @' + userDomain + ' address.'
        );
      }
    } else {
      console.warn(
        `[mailer] SMTP reachable at ${config.mail.host}:${config.mail.port} ` +
        'BUT no SMTP_USER/SMTP_PASS configured. ' +
        'Most providers will reject sendMail with "530 Authentication required". ' +
        'Fill in SMTP_USER and SMTP_PASS in .env and restart.'
      );
    }
    return { ok: true, authenticated: hasAuth() };
  } catch (err) {
    console.error(
      `[mailer] SMTP unreachable (${config.mail.host}:${config.mail.port}):`,
      err && err.message
    );
    return { ok: false, err };
  }
}

async function sendMail({ to, subject, html, text }) {
  if (!to || (Array.isArray(to) && to.length === 0)) {
    return { ok: false, err: new Error('No recipient') };
  }
  const tx = getTransporter();
  if (!tx) return { ok: false, err: new Error('No transporter') };

  const recipients = Array.isArray(to) ? to.join(', ') : to;
  try {
    const info = await tx.sendMail({
      from: config.mail.from,
      to: recipients,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
    // Log richer detail so we can tell "server accepted" from "server
    // silently dropped" without guessing.
    const accepted = Array.isArray(info.accepted) ? info.accepted.join(', ') : '';
    const rejected = Array.isArray(info.rejected) ? info.rejected.join(', ') : '';
    console.log(
      `[mailer] sent  -> to=${recipients}  subject="${subject}"  id=${info.messageId || '-'}`
    );
    console.log(
      `[mailer]   accepted=[${accepted}]  rejected=[${rejected}]  response="${info.response || ''}"`
    );
    if (rejected) {
      console.warn(
        `[mailer]   WARNING server rejected recipient(s): ${rejected}. ` +
        'The "sent" line above means the API call succeeded but the listed addresses will NOT receive the email.'
      );
    }
    return { ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error(`[mailer] FAILED -> to=${recipients}  subject="${subject}": ${msg}`);
    // Give the operator a one-line hint for the most common misconfigs.
    if (/authentication required|535|530/i.test(msg)) {
      console.error(
        '[mailer]   hint: SMTP server requires AUTH. Set SMTP_USER + SMTP_PASS in .env and restart.'
      );
    } else if (/mailbox unavailable|recipient.*not.*found|550/i.test(msg)) {
      console.error(
        '[mailer]   hint: recipient address is invalid or unknown to the SMTP server.'
      );
    }
    return { ok: false, err };
  }
}

function fireAndForget(promise) {
  Promise.resolve(promise).catch((err) => {
    console.error('[mailer] background send failed:', err && err.message);
  });
}

function trigger(label, to, subject, html) {
  const recipients = Array.isArray(to) ? to.join(', ') : to;
  console.log(`[mailer] trigger ${label} -> to=${recipients}  subject="${subject}"`);
  fireAndForget(sendMail({ to, subject, html }));
}

// ----- High-level template helpers ---------------------------------------

function tenantCreated({ to, tenantName, slug }) {
  if (!to) return;
  const { subject, html } = templates.tenantCreated({
    tenantName, slug, publicUrl: config.mail.publicUrl,
  });
  trigger('tenantCreated', to, subject, html);
}

function siteCreated({ to, tenantName, siteName, code, address }) {
  if (!to || (Array.isArray(to) && to.length === 0)) return;
  const { subject, html } = templates.siteCreated({
    tenantName, siteName, code, address, publicUrl: config.mail.publicUrl,
  });
  trigger('siteCreated', to, subject, html);
}

function floorCreated({ to, tenantName, siteName, floorName, levelNumber }) {
  if (!to || (Array.isArray(to) && to.length === 0)) return;
  const { subject, html } = templates.floorCreated({
    tenantName, siteName, floorName, levelNumber,
    publicUrl: config.mail.publicUrl,
  });
  trigger('floorCreated', to, subject, html);
}

function departmentCreated({ to, tenantName, deptName, managerName }) {
  if (!to) return;
  const { subject, html } = templates.departmentCreated({
    tenantName, deptName, managerName,
    publicUrl: config.mail.publicUrl,
  });
  trigger('departmentCreated', to, subject, html);
}

function userInvited({ to, name, username, tenantName, resetToken }) {
  if (!to) return;
  const resetUrl =
    config.mail.publicUrl.replace(/\/$/, '') +
    '/reset-password?token=' + encodeURIComponent(resetToken);
  const { subject, html } = templates.userInvited({
    name, username, tenantName, resetUrl,
    ttlHours: Math.round(config.mail.resetTtlMin / 60),
  });
  trigger('userInvited', to, subject, html);
}

function passwordResetRequested({ to, name, resetToken }) {
  if (!to) return;
  const resetUrl =
    config.mail.publicUrl.replace(/\/$/, '') +
    '/reset-password?token=' + encodeURIComponent(resetToken);
  const { subject, html } = templates.passwordResetRequested({
    name, resetUrl,
    ttlHours: Math.round(config.mail.resetTtlMin / 60),
  });
  trigger('passwordResetRequested', to, subject, html);
}

function approvalRequested(opts) {
  const {
    to, approverName, bookerName, facilityName, facilityType,
    startAt, endAt, title, remarks, stepOrder, totalSteps,
    priorDecisions, token,
  } = opts || {};
  if (!to) return;
  const actUrl =
    config.mail.publicUrl.replace(/\/$/, '') +
    '/approvals/act?token=' + encodeURIComponent(token);
  const { subject, html } = templates.approvalRequested({
    approverName, bookerName, facilityName, facilityType,
    startAt, endAt, title, remarks, stepOrder, totalSteps,
    priorDecisions, actUrl,
    ttlHours: Math.round(config.mail.resetTtlMin / 60),
  });
  trigger('approvalRequested', to, subject, html);
}

// F07 - sent to booker on approved booking. The caller passes the two raw
// action tokens (one each for reschedule + cancel) so we can embed the
// deep links. We never log or persist the raw tokens here.
function bookingConfirmed(opts) {
  const {
    to, bookerName, bookingId, facilityName, facilityType,
    startAt, endAt, attendeeCount,
    rescheduleToken, cancelToken,
  } = opts || {};
  if (!to) return;
  const base = config.mail.publicUrl.replace(/\/$/, '');
  const buildUrl = function (token, action) {
    return base + '/bookings/' + encodeURIComponent(bookingId) +
      '/act?token=' + encodeURIComponent(token) +
      '&action=' + encodeURIComponent(action);
  };
  const { subject, html } = templates.bookingConfirmed({
    bookerName, facilityName, facilityType, startAt, endAt, attendeeCount,
    rescheduleUrl: buildUrl(rescheduleToken, 'reschedule'),
    cancelUrl:     buildUrl(cancelToken, 'cancel'),
    ttlDays: 7,
  });
  trigger('bookingConfirmed', to, subject, html);
}

// Facility notification - sent to admin-configured recipients on
// booking-approved or booking-cancelled events. Doesn't carry any action
// tokens; it's purely informational ("FYI someone booked the boardroom").
function bookingNotification(opts) {
  const {
    to, recipientName, event, bookerName, facilityName, facilityType,
    startAt, endAt, attendeeCount, title,
  } = opts || {};
  if (!to) return;
  const eventLabel = event === 'cancelled' ? 'Cancelled' : 'Confirmed';
  const heading    = event === 'cancelled'
    ? 'A booking has been cancelled'
    : 'A booking has been confirmed';
  const subject = `[${eventLabel}] ${facilityName || 'Facility'} - ${startAt}`;
  const html = `
    <p>Hi ${recipientName || 'there'},</p>
    <p>${heading} on a facility you're set to be notified about:</p>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;line-height:1.5">
      <tr><td style="padding:2px 8px;color:#64748b">Facility</td><td><b>${facilityName || ''}</b>${facilityType ? ' <span style="color:#64748b">(' + facilityType + ')</span>' : ''}</td></tr>
      ${title ? `<tr><td style="padding:2px 8px;color:#64748b">Title</td><td>${title}</td></tr>` : ''}
      <tr><td style="padding:2px 8px;color:#64748b">When</td><td>${startAt} &nbsp;&rarr;&nbsp; ${endAt}</td></tr>
      ${bookerName ? `<tr><td style="padding:2px 8px;color:#64748b">Booker</td><td>${bookerName}</td></tr>` : ''}
      ${attendeeCount ? `<tr><td style="padding:2px 8px;color:#64748b">Attendees</td><td>${attendeeCount}</td></tr>` : ''}
    </table>
    <p style="color:#64748b;font-size:12px">You're receiving this because an admin added you to the facility notification list.</p>
  `;
  trigger('bookingNotification', to, subject, html);
}

// Sent to the booker right after a booking lands in the approval queue.
// Lets them see the request was accepted and who they're waiting on.
function bookingSubmitted(opts) {
  const {
    to, bookerName, facilityName, facilityType, startAt, endAt,
    attendeeCount, title, totalSteps, firstApproverName,
  } = opts || {};
  if (!to) return;
  const { subject, html } = templates.bookingSubmitted({
    bookerName, facilityName, facilityType, startAt, endAt,
    attendeeCount, title, totalSteps, firstApproverName,
  });
  trigger('bookingSubmitted', to, subject, html);
}

// Sent to the booker each time an approver acts. For intermediate steps
// it surfaces the decision + who's next. For the final-rejected case it
// flips to the rejection wording. (Final-approved still goes through the
// bookingConfirmed helper because that one carries the reschedule + cancel
// action tokens.)
function bookingStepDecision(opts) {
  const {
    to, bookerName, facilityName, facilityType, startAt, endAt,
    stepOrder, totalSteps, decision, decidedBy, remark,
    finalStatus, nextApproverName,
  } = opts || {};
  if (!to) return;
  const { subject, html } = templates.bookingStepDecision({
    bookerName, facilityName, facilityType, startAt, endAt,
    stepOrder, totalSteps, decision, decidedBy, remark,
    finalStatus, nextApproverName,
  });
  trigger('bookingStepDecision', to, subject, html);
}

// Pre-end cleanup notification. Fired by the cron to the facility's
// cleanup chain recipients N minutes before end_at. No action links — it's
// a heads-up email so the cleaner / maintenance team can plan turnover.
function bookingEndingSoon(opts) {
  const {
    to, recipientName, leadMinutes, facilityName, facilityType,
    startAt, endAt, bookerName, attendeeCount, title,
  } = opts || {};
  if (!to) return;
  const { subject, html } = templates.bookingEndingSoon({
    recipientName, leadMinutes, facilityName, facilityType,
    startAt, endAt, bookerName, attendeeCount, title,
  });
  trigger('bookingEndingSoon', to, subject, html);
}

module.exports = {
  sendMail,
  fireAndForget,
  verifyConnection,
  tenantCreated,
  siteCreated,
  floorCreated,
  departmentCreated,
  userInvited,
  passwordResetRequested,
  approvalRequested,
  bookingConfirmed,
  bookingNotification,
  bookingSubmitted,
  bookingStepDecision,
  bookingEndingSoon,
};
