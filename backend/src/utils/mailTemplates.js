// HTML email templates. Each function returns { subject, html }.
// Keep them simple - inline styles only, no external assets. Most mail
// clients strip <style> blocks anyway.

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Common wrapper - lightweight card layout with a brand header.
function wrap(bodyHtml, opts) {
  const o = opts || {};
  const title = o.title || 'Facility Booking';
  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#f5f6fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f6fa;padding:24px 0;">',
        '<tr><td align="center">',
          '<table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">',
            '<tr><td style="background:#1976d2;padding:18px 28px;color:#ffffff;font-size:18px;font-weight:600;">',
              esc(title),
            '</td></tr>',
            '<tr><td style="padding:28px;font-size:14px;line-height:1.55;">',
              bodyHtml,
            '</td></tr>',
            '<tr><td style="padding:14px 28px;background:#f9fafb;border-top:1px solid #eef0f3;color:#6b7280;font-size:12px;">',
              'This is an automated message from Facility Booking. Please do not reply.',
            '</td></tr>',
          '</table>',
        '</td></tr>',
      '</table>',
    '</body></html>',
  ].join('');
}

// Reusable button-link.
function btn(label, href) {
  return (
    '<a href="' + esc(href) + '" ' +
    'style="display:inline-block;background:#1976d2;color:#ffffff;text-decoration:none;' +
    'padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;">' +
    esc(label) +
    '</a>'
  );
}

// ----- tenantCreated ------------------------------------------------------

exports.tenantCreated = function ({ tenantName, slug, publicUrl }) {
  const loginUrl = (publicUrl || '').replace(/\/$/, '') + '/login';
  const body =
    '<p style="font-size:16px;margin:0 0 12px;">Welcome aboard!</p>' +
    '<p>Your organisation <strong>' + esc(tenantName) + '</strong> has been provisioned ' +
    'on Facility Booking.</p>' +
    '<p style="margin:18px 0;color:#374151;">' +
      '<strong>Tenant slug:</strong> ' + esc(slug) +
    '</p>' +
    '<p>You can sign in here:</p>' +
    '<p style="margin:20px 0;">' + btn('Sign in', loginUrl) + '</p>' +
    '<p style="color:#6b7280;font-size:13px;">' +
      'If a tenant-admin account hasn\'t been issued yet, an Anthropic / Socampus ' +
      'operator will follow up shortly with credentials.' +
    '</p>';
  return {
    subject: 'Your Facility Booking tenant "' + tenantName + '" is ready',
    html: wrap(body, { title: 'Tenant provisioned' }),
  };
};

// ----- siteCreated --------------------------------------------------------

exports.siteCreated = function ({ tenantName, siteName, code, address, publicUrl }) {
  const sitesUrl = (publicUrl || '').replace(/\/$/, '') + '/admin/sites';
  const body =
    '<p style="font-size:16px;margin:0 0 12px;">A new site was added</p>' +
    '<p><strong>' + esc(siteName) + '</strong>' +
      (code ? ' <span style="color:#6b7280;">(' + esc(code) + ')</span>' : '') +
      ' is now part of <strong>' + esc(tenantName) + '</strong>.</p>' +
    (address
      ? '<p style="margin:14px 0;color:#374151;"><strong>Address:</strong> ' + esc(address) + '</p>'
      : '') +
    '<p style="margin:20px 0;">' + btn('Manage sites', sitesUrl) + '</p>';
  return {
    subject: 'New site added: ' + siteName,
    html: wrap(body, { title: 'Site created' }),
  };
};

// ----- floorCreated -------------------------------------------------------

exports.floorCreated = function ({ tenantName, siteName, floorName, levelNumber, publicUrl }) {
  const floorsUrl = (publicUrl || '').replace(/\/$/, '') + '/admin/floors';
  const body =
    '<p style="font-size:16px;margin:0 0 12px;">A new floor was added</p>' +
    '<p><strong>' + esc(floorName) + '</strong>' +
      (levelNumber != null ? ' <span style="color:#6b7280;">(level ' + esc(levelNumber) + ')</span>' : '') +
      ' has been added to <strong>' + esc(siteName) + '</strong>' +
      (tenantName ? ' for <strong>' + esc(tenantName) + '</strong>' : '') +
      '.</p>' +
    '<p style="margin:20px 0;">' + btn('Manage floors', floorsUrl) + '</p>';
  return {
    subject: 'New floor added: ' + floorName + (siteName ? ' (' + siteName + ')' : ''),
    html: wrap(body, { title: 'Floor created' }),
  };
};

// ----- departmentCreated --------------------------------------------------

exports.departmentCreated = function ({ tenantName, deptName, managerName, publicUrl }) {
  const deptsUrl = (publicUrl || '').replace(/\/$/, '') + '/admin/departments';
  const body =
    '<p style="font-size:16px;margin:0 0 12px;">' +
      'Hi' + (managerName ? ' ' + esc(managerName) : '') + ',' +
    '</p>' +
    '<p>You have been assigned as the <strong>manager</strong> of the ' +
      '<strong>' + esc(deptName) + '</strong> department' +
      (tenantName ? ' at <strong>' + esc(tenantName) + '</strong>' : '') +
      '.</p>' +
    '<p>You\'ll start receiving notifications about your team\'s facility ' +
      'bookings and approvals.</p>' +
    '<p style="margin:20px 0;">' + btn('Open Facility Booking', deptsUrl) + '</p>';
  return {
    subject: 'You\'re now managing the ' + deptName + ' department',
    html: wrap(body, { title: 'Department assigned' }),
  };
};

// ----- userInvited (new user / reset password) ----------------------------

exports.userInvited = function ({ name, username, tenantName, resetUrl, ttlHours }) {
  const body =
    '<p style="font-size:16px;margin:0 0 12px;">' +
      'Hi' + (name ? ' ' + esc(name) : '') + ',' +
    '</p>' +
    '<p>An account has been created for you on Facility Booking' +
      (tenantName ? ' for <strong>' + esc(tenantName) + '</strong>' : '') + '.</p>' +
    '<p style="margin:14px 0;color:#374151;">' +
      '<strong>Username:</strong> ' + esc(username) +
    '</p>' +
    '<p>To finish setting up your account, please set your password using the link below:</p>' +
    '<p style="margin:20px 0;">' + btn('Set my password', resetUrl) + '</p>' +
    '<p style="color:#6b7280;font-size:13px;">' +
      'This link will expire in about ' + esc(ttlHours) + ' hours. ' +
      'If the button doesn\'t work, copy this URL into your browser:<br>' +
      '<span style="word-break:break-all;color:#1976d2;">' + esc(resetUrl) + '</span>' +
    '</p>';
  return {
    subject: 'Welcome to Facility Booking - set your password',
    html: wrap(body, { title: 'Welcome to Facility Booking' }),
  };
};

// ----- passwordResetRequested --------------------------------------------

exports.passwordResetRequested = function ({ name, resetUrl, ttlHours }) {
  const body =
    '<p style="font-size:16px;margin:0 0 12px;">' +
      'Hi' + (name ? ' ' + esc(name) : '') + ',' +
    '</p>' +
    '<p>We received a request to reset your Facility Booking password. ' +
      'Click below to choose a new one:</p>' +
    '<p style="margin:20px 0;">' + btn('Reset my password', resetUrl) + '</p>' +
    '<p style="color:#6b7280;font-size:13px;">' +
      'This link will expire in about ' + esc(ttlHours) + ' hours. ' +
      'If you didn\'t request a reset, you can safely ignore this email.' +
    '</p>';
  return {
    subject: 'Reset your Facility Booking password',
    html: wrap(body, { title: 'Password reset' }),
  };
};

// ----- approvalRequested (sent to each step's approver) ------------------

exports.approvalRequested = function (opts) {
  const {
    approverName, bookerName, facilityName, facilityType,
    startAt, endAt, title, remarks, stepOrder, totalSteps,
    priorDecisions, actUrl, ttlHours,
  } = opts || {};

  const summary =
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" ' +
      'style="width:100%;margin:14px 0;border-collapse:collapse;font-size:14px;">' +
      '<tr><td style="padding:6px 0;color:#6b7280;width:140px;">Facility</td>' +
        '<td style="padding:6px 0;"><strong>' + esc(facilityName) + '</strong> ' +
        '<span style="color:#6b7280;">(' + esc(facilityType) + ')</span></td></tr>' +
      '<tr><td style="padding:6px 0;color:#6b7280;">Requested by</td>' +
        '<td style="padding:6px 0;">' + esc(bookerName) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#6b7280;">From</td>' +
        '<td style="padding:6px 0;">' + esc(startAt) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#6b7280;">To</td>' +
        '<td style="padding:6px 0;">' + esc(endAt) + '</td></tr>' +
      (title ? (
        '<tr><td style="padding:6px 0;color:#6b7280;">Title</td>' +
          '<td style="padding:6px 0;">' + esc(title) + '</td></tr>'
      ) : '') +
      (remarks ? (
        '<tr><td style="padding:6px 0;color:#6b7280;">Remarks</td>' +
          '<td style="padding:6px 0;">' + esc(remarks) + '</td></tr>'
      ) : '') +
      '<tr><td style="padding:6px 0;color:#6b7280;">Your step</td>' +
        '<td style="padding:6px 0;">' + esc(stepOrder) + ' of ' + esc(totalSteps) + '</td></tr>' +
    '</table>';

  let prior = '';
  if (Array.isArray(priorDecisions) && priorDecisions.length > 0) {
    prior =
      '<p style="margin-top:18px;color:#6b7280;font-size:13px;"><strong>Earlier decisions:</strong></p>' +
      '<ul style="margin:6px 0 18px 18px;padding:0;color:#374151;font-size:13px;">' +
      priorDecisions.map((d) =>
        '<li>Step ' + esc(d.step_order) + ' &mdash; ' +
        '<strong>' + esc(d.decision) + '</strong>' +
        (d.approver_name ? ' by ' + esc(d.approver_name) : '') +
        (d.remark ? ' &mdash; <em>' + esc(d.remark) + '</em>' : '') +
        '</li>'
      ).join('') +
      '</ul>';
  }

  const body =
    '<p style="font-size:16px;margin:0 0 12px;">' +
      'Hi' + (approverName ? ' ' + esc(approverName) : '') + ',' +
    '</p>' +
    '<p>A booking is waiting for your approval.</p>' +
    summary +
    prior +
    '<p style="margin:22px 0;">' + btn('Review & decide', actUrl) + '</p>' +
    '<p style="color:#6b7280;font-size:13px;">' +
      'This link will expire in about ' + esc(ttlHours) + ' hours. ' +
      'You\'ll need to sign in with your Facility Booking account before you ' +
      'can act on this request.' +
    '</p>';

  return {
    subject: 'Approval needed: ' + facilityName +
      ' for ' + bookerName + ' on ' + (startAt || '').slice(0, 10),
    html: wrap(body, { title: 'Booking awaiting your approval' }),
  };
};

// ----- bookingConfirmed (F07) ---------------------------------------------
// Sent to the booker once a booking is APPROVED. Includes Reschedule + Cancel
// buttons backed by booking_action_tokens. Both links require login.

// Coloured button helper (Reschedule = amber, Cancel = red, default = navy).
function colorBtn(label, href, color) {
  return (
    '<a href="' + esc(href) + '" ' +
    'style="display:inline-block;background:' + (color || '#1976d2') +
    ';color:#ffffff;text-decoration:none;' +
    'padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;margin-right:8px;">' +
    esc(label) +
    '</a>'
  );
}

exports.bookingConfirmed = function (opts) {
  const {
    bookerName, facilityName, facilityType, startAt, endAt,
    attendeeCount, rescheduleUrl, cancelUrl, ttlDays,
  } = opts || {};

  const summary =
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" ' +
      'style="width:100%;margin:14px 0;border-collapse:collapse;font-size:14px;">' +
      '<tr><td style="padding:6px 0;color:#6b7280;width:140px;">Facility</td>' +
        '<td style="padding:6px 0;"><strong>' + esc(facilityName) + '</strong> ' +
        '<span style="color:#6b7280;">(' + esc(facilityType) + ')</span></td></tr>' +
      '<tr><td style="padding:6px 0;color:#6b7280;">From</td>' +
        '<td style="padding:6px 0;">' + esc(startAt) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#6b7280;">To</td>' +
        '<td style="padding:6px 0;">' + esc(endAt) + '</td></tr>' +
      (attendeeCount ? (
        '<tr><td style="padding:6px 0;color:#6b7280;">Attendees</td>' +
          '<td style="padding:6px 0;">' + esc(attendeeCount) + '</td></tr>'
      ) : '') +
    '</table>';

  const body =
    '<p style="font-size:16px;margin:0 0 12px;">' +
      'Hi' + (bookerName ? ' ' + esc(bookerName) : '') + ',' +
    '</p>' +
    '<p>Your booking has been <strong>confirmed</strong>.</p>' +
    summary +
    '<p style="margin:22px 0 8px;">Plans changed? Manage your booking below:</p>' +
    '<p style="margin:6px 0 16px;">' +
      colorBtn('Reschedule', rescheduleUrl, '#d97706') +
      colorBtn('Cancel',     cancelUrl,     '#dc2626') +
    '</p>' +
    '<p style="color:#6b7280;font-size:13px;">' +
      'These links expire in about ' + esc(ttlDays || 7) + ' days. ' +
      'You\'ll need to sign in with your Facility Booking account before they take effect.' +
    '</p>';

  return {
    subject: 'Booking confirmed: ' + facilityName + ' on ' + (startAt || '').slice(0, 10),
    html: wrap(body, { title: 'Booking confirmed' }),
  };
};
