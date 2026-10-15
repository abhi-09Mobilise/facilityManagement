// Embassy Pantry Bridge — HTTP service.
//
// Single endpoint:
//   GET /pantry/aggregated?scope_id=<pc_id>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>
//     Headers: X-Bridge-Secret: <BRIDGE_SECRET from .env>
//
// Returns the exact JSON shape the FM dashboard's pantry widget consumes
// (see src/transformer.js).
//
// Two run modes:
//   BRIDGE_MODE=mock → canned data, no DB touched (dev / FM-side wiring tests)
//   BRIDGE_MODE=live → runs Q1–Q6 against Embassy MySQL

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const db = require('./db');
const queries = require('./queries');
const { toFmShape } = require('./transformer');
const { mockAggregate } = require('./mock');

const app = express();

// --- CORS: comma-separated list in CORS_ORIGIN, or '*' for open ---
const corsEnv = process.env.CORS_ORIGIN || '*';
const corsList = corsEnv === '*'
  ? null
  : corsEnv.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
app.use(cors({
  origin: function corsOriginFn(origin, cb) {
    if (!origin) return cb(null, true);              // server-to-server / curl
    if (corsList === null) return cb(null, true);
    if (corsList.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: origin ' + origin + ' not allowed'));
  },
}));

app.use(express.json({ limit: '256kb' }));

// --- Shared-secret auth ---
// Every request must carry X-Bridge-Secret matching BRIDGE_SECRET. In mock
// mode we still enforce the header — this way the FM backend's auth
// contract is identical in both modes.
app.use(function sharedSecret(req, res, next) {
  // Health probe is open so uptime checks don't need to carry the secret.
  if (req.path === '/health') return next();
  const expected = String(process.env.BRIDGE_SECRET || '').trim();
  const got = String(req.header('x-bridge-secret') || '').trim();
  if (!expected) {
    return res.status(500).json({ status: false, msg: 'BRIDGE_SECRET not configured' });
  }
  if (got !== expected) {
    return res.status(401).json({ status: false, msg: 'Invalid bridge secret' });
  }
  return next();
});

// --- Health ---
app.get('/health', function (req, res) {
  res.json({
    status: true,
    mode: currentMode(),
    uptime_s: Math.round(process.uptime()),
  });
});

// --- Main aggregation endpoint ---
app.get('/pantry/aggregated', async function (req, res) {
  const pcId = parseInt(req.query.scope_id, 10);
  if (!Number.isFinite(pcId) || pcId <= 0) {
    return res.status(400).json({ status: false, msg: 'scope_id (pc_id) is required' });
  }

  const to = normaliseIsoDate(req.query.to, todayIso());
  const from = normaliseIsoDate(req.query.from, isoDaysAgo(to, 30));

  // Query window uses half-open [from, to+1day) so the "to" day is included.
  const fromDt = from + ' 00:00:00';
  const toDt   = isoDaysAgo(to, -1) + ' 00:00:00'; // to + 1 day

  try {
    if (currentMode() === 'mock') {
      const payload = mockAggregate(pcId, fromDt, toDt);
      // Overwrite window with the clean from/to we parsed (mock uses the
      // same, this is just cosmetic consistency).
      payload.window = { from, to };
      return res.json({ status: true, data: payload });
    }

    const agg = await queries.aggregateAll(pcId, fromDt, toDt);
    const payload = toFmShape(agg, { from, to });
    return res.json({ status: true, data: payload });
  } catch (err) {
    console.error('[bridge] aggregate failed:', err && err.message);
    return res.status(502).json({
      status: false,
      msg: 'Embassy aggregator failed',
      detail: err && err.message,
    });
  }
});

// --- Debug: discover which pc_ids actually have data + the overall
//     date range of orders in the table. Useful on first integration
//     to pick a scope_id that returns rows. Live mode only — mock mode
//     always returns empty here.
app.get('/pantry/debug/pc-ids', async function (req, res) {
  if (currentMode() !== 'live') {
    return res.json({ status: true, mode: 'mock', data: { note: 'debug endpoint is live-mode only' } });
  }
  try {
    const topPc = await db.query(
      'SELECT pc_id, COUNT(*) AS orders ' +
      '  FROM `60_pntry_order` ' +
      ' GROUP BY pc_id ' +
      ' ORDER BY orders DESC ' +
      ' LIMIT 10'
    );
    const range = await db.query(
      'SELECT COUNT(*) AS total, ' +
      '       MIN(created_at) AS min_created, ' +
      '       MAX(created_at) AS max_created ' +
      '  FROM `60_pntry_order`'
    );
    return res.json({
      status: true,
      mode: 'live',
      data: {
        total_orders: Number(range[0].total || 0),
        oldest_order: range[0].min_created,
        newest_order: range[0].max_created,
        top_pc_ids:   topPc.map(function (r) { return { pc_id: Number(r.pc_id), orders: Number(r.orders) }; }),
      },
    });
  } catch (err) {
    return res.status(502).json({ status: false, msg: 'debug query failed', detail: err && err.message });
  }
});

// --- Debug: inspect a single pc_id — order count, created_at + order_date
//     range, status breakdown, and 3 sample raw rows. Used to figure out
//     why an aggregated query returns zero despite the pc_id being listed
//     in /pantry/debug/pc-ids.
app.get('/pantry/debug/inspect', async function (req, res) {
  if (currentMode() !== 'live') {
    return res.json({ status: true, mode: 'mock', data: { note: 'debug endpoint is live-mode only' } });
  }
  const pcId = parseInt(req.query.pc_id, 10);
  if (!Number.isFinite(pcId) || pcId <= 0) {
    return res.status(400).json({ status: false, msg: 'pc_id is required' });
  }
  try {
    const summary = await db.query(
      'SELECT COUNT(*) AS total, ' +
      '       SUM(CASE WHEN created_at IS NULL OR created_at = "0000-00-00 00:00:00" THEN 1 ELSE 0 END) AS null_created, ' +
      '       MIN(created_at) AS min_created, MAX(created_at) AS max_created, ' +
      '       MIN(order_date) AS min_order_date, MAX(order_date) AS max_order_date ' +
      '  FROM `60_pntry_order` ' +
      ' WHERE pc_id = ?',
      [pcId]
    );
    const byStatus = await db.query(
      'SELECT ord_status, COUNT(*) AS n ' +
      '  FROM `60_pntry_order` ' +
      ' WHERE pc_id = ? ' +
      ' GROUP BY ord_status ' +
      ' ORDER BY n DESC',
      [pcId]
    );
    const sample = await db.query(
      'SELECT order_id, pc_id, loc_id, ord_status, ordr_type, order_date, created_at, dlvrd_on ' +
      '  FROM `60_pntry_order` ' +
      ' WHERE pc_id = ? ' +
      ' ORDER BY order_id DESC ' +
      ' LIMIT 3',
      [pcId]
    );
    return res.json({
      status: true,
      mode: 'live',
      data: {
        pc_id: pcId,
        summary: summary[0] || {},
        status_breakdown: byStatus.map(function (r) { return { ord_status: r.ord_status, n: Number(r.n) }; }),
        sample_rows: sample,
      },
    });
  } catch (err) {
    return res.status(502).json({ status: false, msg: 'inspect failed', detail: err && err.message });
  }
});

// --- 404 ---
app.use(function (req, res) {
  res.status(404).json({ status: false, msg: 'Route not found' });
});

// --- Boot ---
const PORT = Number(process.env.PORT || 4000);

function currentMode() {
  return String(process.env.BRIDGE_MODE || 'mock').toLowerCase() === 'live' ? 'live' : 'mock';
}

app.listen(PORT, function () {
  console.log('[bridge] Embassy pantry bridge up on :' + PORT + ' (mode=' + currentMode() + ')');
  if (currentMode() === 'live') {
    db.verifyConnection();
  }
});

// --- Tiny date helpers (local-tz; the bridge is deployed in the DB's tz) ---
function pad2(n) { return (n < 10 ? '0' : '') + n; }

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function normaliseIsoDate(input, fallback) {
  if (!input) return fallback;
  const s = String(input).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

function isoDaysAgo(iso, days) {
  const parts = String(iso).split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  d.setDate(d.getDate() - days);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
