// Deterministic mock aggregator — returns an FM-shaped payload without
// touching Embassy MySQL. Used when BRIDGE_MODE=mock so dev workstations
// that can't reach the 10.86.x private subnet can still exercise the
// bridge wiring end-to-end.
//
// Deterministic (seed = pcId) so repeated calls on the same scope return
// the same numbers, which makes manual verification easier.

const { toFmShape } = require('./transformer');

function seeded(n) {
  // tiny LCG — plenty for mock data
  let x = n * 9301 + 49297;
  return function () {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}

function buildMockAggregator(pcId, from, to) {
  const rand = seeded(Number(pcId) || 7);

  // Daily counts across the window
  const daily = [];
  const start = new Date(from);
  const end = new Date(to);
  const dayMs = 24 * 60 * 60 * 1000;
  for (let t = start.getTime(); t < end.getTime(); t += dayMs) {
    const d = new Date(t);
    const ymd = d.toISOString().slice(0, 10);
    const orders = Math.floor(rand() * 30) + 5;
    daily.push({ day: ymd, orders });
  }

  const created   = daily.reduce(function (s, r) { return s + r.orders; }, 0);
  const delivered = Math.max(0, created - Math.floor(created * 0.07));
  const inProgress = created - delivered - Math.floor(created * 0.03);
  const avgDeliveryMin = Math.round(5 + rand() * 10);

  const items = [
    { name: 'Masala chai',     orders: Math.floor(created * 0.35) },
    { name: 'Filter coffee',   orders: Math.floor(created * 0.22) },
    { name: 'Water bottle',    orders: Math.floor(created * 0.15) },
    { name: 'Veggie sandwich', orders: Math.floor(created * 0.10) },
  ];

  return { created, delivered, inProgress: Math.max(0, inProgress), avgDeliveryMin, daily, topItems: items };
}

function mockAggregate(pcId, from, to) {
  const agg = buildMockAggregator(pcId, from, to);
  return toFmShape(agg, { from: String(from).slice(0, 10), to: String(to).slice(0, 10) });
}

module.exports = { mockAggregate };
