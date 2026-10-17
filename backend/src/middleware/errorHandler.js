// Central error handler — keep the response envelope consistent.
// Express picks this up because it has 4 args.

module.exports = function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // Validation errors from express-validator
  if (err && err.array && typeof err.array === 'function') {
    return res.status(422).json({
      status: false,
      msg: 'Validation failed',
      errors: err.array(),
    });
  }

  // JWT errors
  if (err && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
    return res.status(401).json({ status: false, msg: 'Unauthorized: ' + err.message });
  }

  // MySQL / DB errors — don't leak internals in production.
  const code = err && err.code;

  if (code === 'ER_DUP_ENTRY') {
    // BUG-21 fix: raw sqlMessage used to leak key names + table internals
    // (e.g. "Duplicate entry '10-QAPUN' for key 'sites.uk_site_code'").
    // Parse the key name instead and return a human-friendly message.
    return res.status(409).json({
      status: false,
      msg: friendlyDuplicateMessage(err.sqlMessage || ''),
    });
  }

  // Common foreign-key violation — again, friendly message vs raw SQL.
  if (code === 'ER_NO_REFERENCED_ROW_2' || code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({
      status: false,
      msg: 'This record is linked to other data and cannot be used as-is. Check related records.',
    });
  }

  const status = err.status || 500;
  const msg = err.expose || process.env.NODE_ENV !== 'production'
    ? (err.message || 'Server error')
    : 'Server error';

  // Surface server errors to the logs in EVERY env so production crashes
  // don't disappear silently. The response body is still scrubbed above
  // when NODE_ENV=production, so nothing internal leaks to the caller.
  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, '-', err && (err.stack || err.message || err));
  } else if (process.env.NODE_ENV !== 'production') {
    console.error('[error]', err);
  }
  return res.status(status).json({ status: false, msg });
};

/**
 * Turn a MySQL ER_DUP_ENTRY sqlMessage into a user-friendly line.
 *
 * Input examples:
 *   "Duplicate entry '10-QAPUN' for key 'sites.uk_site_code'"
 *   "Duplicate entry 'Pune' for key 'sites.uk_tenant_site_name'"
 *   "Duplicate entry 'john.doe@acme.com' for key 'users.uk_user_email'"
 *
 * Output: "A site with this code already exists." / etc.
 */
function friendlyDuplicateMessage(sqlMessage) {
  const m = /Duplicate entry '([^']*)' for key '(?:[^.]+\.)?([^']+)'/i.exec(sqlMessage);
  if (!m) return 'This value already exists. Please pick a different one.';
  const value = m[1];
  const key = (m[2] || '').toLowerCase();
  // Infer the human field from the index name tail.
  let field = 'value';
  if (key.includes('email'))          field = 'email';
  else if (key.includes('username'))  field = 'username';
  else if (key.includes('slug'))      field = 'slug';
  else if (key.includes('code'))      field = 'code';
  else if (key.includes('name'))      field = 'name';
  else if (key.includes('mobile'))    field = 'mobile';
  else if (key.includes('token'))     field = 'token';
  return `A record with this ${field} ("${value}") already exists. Please choose a different ${field}.`;
}
