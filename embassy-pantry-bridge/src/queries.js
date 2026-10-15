// Embassy pantry aggregation queries.
//
// Verbatim ports of Q1–Q6 from the Embassy integration brief
// (see README.md § "Query reference"). Each query is parameterised with
// positional placeholders so mysql2's `.query(sql, params)` can bind them.
//
// Window semantics:
//   • `from` / `to` are ISO datetime strings ('YYYY-MM-DD HH:MM:SS').
//   • "Created in window" uses created_at (datetime).
//   • "Delivered in window" uses dlvrd_on (datetime, with the MySQL
//     zero-datetime sentinel guarded against — legacy rows exist).
//
// Status enum (from brief §3):
//   2 = Order Confirmed       (initial state)
//   3 = Order Cancelled
//   4 = Order Accepted
//   6 = Order Delivered       (dlvrd_on also set)
//   9 = Order Reached         (customer confirmed)

const db = require('./db');

// Shared predicate for "delivered" — guards against the legacy zero-datetime.
const DELIVERED_PREDICATE =
  "ord_status = 6 AND dlvrd_on IS NOT NULL AND dlvrd_on <> '0000-00-00 00:00:00'";

async function q1CreatedCount(pcId, from, to) {
  const rows = await db.query(
    'SELECT COUNT(*) AS n ' +
    '  FROM `60_pntry_order` ' +
    ' WHERE pc_id = ? ' +
    '   AND created_at >= ? AND created_at < ?',
    [pcId, from, to]
  );
  return Number((rows[0] || {}).n || 0);
}

async function q2DeliveredCount(pcId, from, to) {
  const rows = await db.query(
    'SELECT COUNT(*) AS n ' +
    '  FROM `60_pntry_order` ' +
    ' WHERE pc_id = ? ' +
    '   AND ' + DELIVERED_PREDICATE + ' ' +
    '   AND dlvrd_on >= ? AND dlvrd_on < ?',
    [pcId, from, to]
  );
  return Number((rows[0] || {}).n || 0);
}

async function q3InProgressCount(pcId, from, to) {
  const rows = await db.query(
    'SELECT COUNT(*) AS n ' +
    '  FROM `60_pntry_order` ' +
    ' WHERE pc_id = ? ' +
    '   AND created_at >= ? AND created_at < ? ' +
    '   AND ord_status NOT IN (3, 6) ' +
    "   AND (dlvrd_on IS NULL OR dlvrd_on = '0000-00-00 00:00:00')",
    [pcId, from, to]
  );
  return Number((rows[0] || {}).n || 0);
}

async function q4AvgDeliveryMinutes(pcId, from, to) {
  const rows = await db.query(
    'SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, dlvrd_on)) / 60.0 AS avg_min ' +
    '  FROM `60_pntry_order` ' +
    ' WHERE pc_id = ? ' +
    '   AND ' + DELIVERED_PREDICATE + ' ' +
    '   AND dlvrd_on >= ? AND dlvrd_on < ?',
    [pcId, from, to]
  );
  const raw = (rows[0] || {}).avg_min;
  if (raw === null || raw === undefined) return null;
  // Return minutes rounded to the nearest whole minute — the FM widget
  // just shows "N min" so sub-minute precision isn't useful.
  return Math.round(Number(raw));
}

async function q5DailyCounts(pcId, from, to) {
  const rows = await db.query(
    'SELECT DATE(created_at) AS day, COUNT(*) AS orders ' +
    '  FROM `60_pntry_order` ' +
    ' WHERE pc_id = ? ' +
    '   AND created_at >= ? AND created_at < ? ' +
    ' GROUP BY DATE(created_at) ' +
    ' ORDER BY day',
    [pcId, from, to]
  );
  return rows.map(function (r) {
    return { day: String(r.day), orders: Number(r.orders) };
  });
}

async function q6TopItems(pcId, from, to, limit = 4) {
  const rows = await db.query(
    'SELECT fim.item_name AS name, SUM(itm.order_qty) AS orders ' +
    '  FROM `60_pntry_order_itm` AS itm ' +
    '  INNER JOIN `60_pntry_order`      AS ord ON ord.order_id = itm.order_id ' +
    '  INNER JOIN `60_food_item_master` AS fim ON fim.item_id  = itm.item_id ' +
    ' WHERE ord.pc_id = ? ' +
    '   AND ord.created_at >= ? AND ord.created_at < ? ' +
    ' GROUP BY fim.item_id, fim.item_name ' +
    ' ORDER BY orders DESC ' +
    ' LIMIT ' + Number(limit),
    [pcId, from, to]
  );
  return rows.map(function (r) {
    return { name: r.name, orders: Number(r.orders) };
  });
}

// Convenience aggregator — runs all six in parallel and bundles the
// results into a single object. The transformer takes it from here.
async function aggregateAll(pcId, from, to) {
  const [created, delivered, inProgress, avgDeliveryMin, daily, topItems] = await Promise.all([
    q1CreatedCount(pcId, from, to),
    q2DeliveredCount(pcId, from, to),
    q3InProgressCount(pcId, from, to),
    q4AvgDeliveryMinutes(pcId, from, to),
    q5DailyCounts(pcId, from, to),
    q6TopItems(pcId, from, to, 4),
  ]);
  return { created, delivered, inProgress, avgDeliveryMin, daily, topItems };
}

module.exports = {
  q1CreatedCount, q2DeliveredCount, q3InProgressCount,
  q4AvgDeliveryMinutes, q5DailyCounts, q6TopItems,
  aggregateAll,
};
