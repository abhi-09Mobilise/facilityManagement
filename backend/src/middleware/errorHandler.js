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
    return res.status(409).json({ status: false, msg: 'Duplicate entry' });
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
