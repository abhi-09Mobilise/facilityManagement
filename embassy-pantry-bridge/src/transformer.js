// Shapes the aggregator output into the exact JSON the FM dashboard's
// pantry widget expects. The shape mirrors FM's own backend
// `exports.pantryOrders` response so the frontend consumes bridge data
// with zero widget-side changes.
//
// FM shape (see backend/src/modules/dashboards/dashboards.controller.js
// around line 526):
//
//   { created, delivered, inProgress, avgDeliveryMin,
//     daily:    [ { day: 'Sept 8', orders: 24 }, ... ],
//     topItems: [ { name, orders, color }, ... ],
//     window:   { from, to },
//     as_of:    ISO timestamp }

// Convert a 'YYYY-MM-DD' date (string from mysql2's dateStrings:true) to the
// short display label used in the FM widget: "8 Sept", "16 Oct", etc.
function formatDayLabel(ymd) {
  if (!ymd) return '';
  const parts = String(ymd).split('-');
  if (parts.length !== 3) return String(ymd);
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(d.getTime())) return String(ymd);
  const day = d.getDate();
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sept','Oct','Nov','Dec'][d.getMonth()];
  return day + ' ' + mon;
}

// Hardcoded colour matches the pantry widget's single-colour bar palette.
const ITEM_COLOR = '#f97316';

function toFmShape(agg, window) {
  return {
    created:        Number(agg.created || 0),
    delivered:      agg.delivered === null || agg.delivered === undefined ? null : Number(agg.delivered),
    inProgress:     agg.inProgress === null || agg.inProgress === undefined ? null : Number(agg.inProgress),
    avgDeliveryMin: agg.avgDeliveryMin === null || agg.avgDeliveryMin === undefined ? null : Number(agg.avgDeliveryMin),
    daily: (agg.daily || []).map(function (row) {
      return { day: formatDayLabel(row.day), orders: Number(row.orders) };
    }),
    topItems: (agg.topItems || []).map(function (row) {
      return { name: String(row.name), orders: Number(row.orders), color: ITEM_COLOR };
    }),
    window: window || null,
    as_of: new Date().toISOString(),
  };
}

module.exports = { toFmShape, formatDayLabel };
