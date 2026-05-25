// Uniform response envelope, mirrors the shape the Angular frontend was used to.
// Old API returned { status: true/false, msg, data, ... }; we keep the same so the
// migrated frontend service code feels familiar.

function ok(res, data = null, msg = 'OK', extra = {}) {
  return res.json({ status: true, msg, data, ...extra });
}

function created(res, data = null, msg = 'Created') {
  return res.status(201).json({ status: true, msg, data });
}

function fail(res, msg = 'Something went wrong', status = 400, extra = {}) {
  return res.status(status).json({ status: false, msg, ...extra });
}

function notFound(res, msg = 'Not found') {
  return res.status(404).json({ status: false, msg });
}

module.exports = { ok, created, fail, notFound };
