// Currencies / timezones / locales.
//   - Reads: any logged-in user (drives tenant signup + settings UIs)
//   - Writes: super_admin only

const { query, execute } = require('../../db/pool');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');

// ----- Currencies (PK = code) --------------------------------------------

exports.listCurrencies = asyncHandler(async function (_req, res) {
  const rows = await query(
    'SELECT code, name, symbol, decimals, status FROM `currencies` WHERE status = 1 ORDER BY code'
  );
  return ok(res, rows);
});

exports.createCurrency = asyncHandler(async function (req, res) {
  const b = req.body || {};
  if (!b.code || !b.name || !b.symbol) return fail(res, 'code, name, symbol are required', 422);
  await execute(
    'INSERT INTO `currencies` (code, name, symbol, decimals) VALUES (?, ?, ?, ?) ' +
    'ON DUPLICATE KEY UPDATE name = VALUES(name), symbol = VALUES(symbol), decimals = VALUES(decimals)',
    [b.code, b.name, b.symbol, b.decimals == null ? 2 : Number(b.decimals)]
  );
  return created(res, { code: b.code });
});

exports.updateCurrency = asyncHandler(async function (req, res) {
  const code = req.params.code;
  const b = req.body || {};
  await execute(
    'UPDATE `currencies` SET ' +
    '  name     = COALESCE(?, name), ' +
    '  symbol   = COALESCE(?, symbol), ' +
    '  decimals = COALESCE(?, decimals), ' +
    '  status   = COALESCE(?, status) ' +
    'WHERE code = ?',
    [b.name || null, b.symbol || null, b.decimals == null ? null : Number(b.decimals), b.status == null ? null : Number(b.status), code]
  );
  return ok(res, null, 'Currency updated');
});

// ----- Timezones (PK = name) ---------------------------------------------

exports.listTimezones = asyncHandler(async function (_req, res) {
  const rows = await query(
    'SELECT name, display_name, utc_offset, status FROM `timezones` WHERE status = 1 ORDER BY name'
  );
  return ok(res, rows);
});

exports.createTimezone = asyncHandler(async function (req, res) {
  const b = req.body || {};
  if (!b.name || !b.display_name || !b.utc_offset) {
    return fail(res, 'name, display_name, utc_offset are required', 422);
  }
  await execute(
    'INSERT INTO `timezones` (name, display_name, utc_offset) VALUES (?, ?, ?) ' +
    'ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), utc_offset = VALUES(utc_offset)',
    [b.name, b.display_name, b.utc_offset]
  );
  return created(res, { name: b.name });
});

// ----- Locales (PK = code) -----------------------------------------------

exports.listLocales = asyncHandler(async function (_req, res) {
  const rows = await query(
    'SELECT code, name, native_name, status FROM `locales` WHERE status = 1 ORDER BY code'
  );
  return ok(res, rows);
});

exports.createLocale = asyncHandler(async function (req, res) {
  const b = req.body || {};
  if (!b.code || !b.name) return fail(res, 'code and name are required', 422);
  await execute(
    'INSERT INTO `locales` (code, name, native_name) VALUES (?, ?, ?) ' +
    'ON DUPLICATE KEY UPDATE name = VALUES(name), native_name = VALUES(native_name)',
    [b.code, b.name, b.native_name || null]
  );
  return created(res, { code: b.code });
});
