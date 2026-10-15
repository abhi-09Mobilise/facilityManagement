// Minimal HTTP client for the Embassy Pantry Bridge.
//
// Called from dashboards.controller.js whenever the active FM tenant is
// mapped in config.bridge.tenantMap. Returns the bridge's `data` payload
// (already shaped like FM's own pantryOrders response), or null on any
// failure so the caller can fall back to the local DB without a 500.
//
// We use the global fetch available in Node 18+ (no new dependency). All
// network / timeout / JSON errors are swallowed into `null` + console
// warnings — the pantry widget stays non-fatal.

const config = require('../config');

async function fetchAggregated({ pcId, from, to }) {
  const base = String(config.bridge.pantryUrl || '').replace(/\/$/, '');
  if (!base) return null;

  const url = new URL(base + '/pantry/aggregated');
  url.searchParams.set('scope_id', String(pcId));
  if (from) url.searchParams.set('from', from);
  if (to)   url.searchParams.set('to', to);

  const controller = new AbortController();
  const t = setTimeout(function () { controller.abort(); }, config.bridge.pantryTimeoutMs);

  try {
    const r = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Bridge-Secret': config.bridge.pantrySecret,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    if (!r.ok) {
      console.warn('[pantryBridge] HTTP ' + r.status + ' from bridge for pc_id=' + pcId);
      return null;
    }

    const body = await r.json();
    if (!body || body.status !== true || !body.data) {
      console.warn('[pantryBridge] malformed body from bridge:', body && body.msg);
      return null;
    }
    return body.data;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      console.warn('[pantryBridge] timeout after ' + config.bridge.pantryTimeoutMs + 'ms for pc_id=' + pcId);
    } else {
      console.warn('[pantryBridge] fetch failed:', err && err.message);
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { fetchAggregated };
