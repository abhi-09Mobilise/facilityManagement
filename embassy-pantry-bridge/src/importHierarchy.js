// Embassy org-hierarchy -> FM masters importer (runs INSIDE the bridge).
//
// READS Embassy via orgHierarchy.js (read-only; live or mock per BRIDGE_MODE),
// WRITES the FM database via fmDb.js. Idempotent: every FM row is keyed to its
// Embassy source PK via (tenant_id, source_system='embassy', source_ref) —
// FM migration 051 — so a daily run UPSERTS instead of duplicating.
//
// Mapping (Embassy org_id 13 == FM tenant 10):
//   0_org_pl          -> organisations  (source_ref = pl_id)
//   0_org_pc          -> lookup only: block.pc_id -> pl_id -> FM organisation
//   0_org_pc_block    -> sites          (source_ref = id)
//   0_org_pc_building -> buildings      (source_ref = id)
//   0_org_pc_floor    -> floors         (source_ref = id; floor_img -> layout_image_url)

const fmDb = require('./fmDb');
const orgHierarchy = require('./orgHierarchy');

const SRC = 'embassy';

function currentMode() {
  return String(process.env.BRIDGE_MODE || 'mock').toLowerCase() === 'live' ? 'live' : 'mock';
}
function slugify(s) {
  const b = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
  return b || 'org';
}
const fmStatus = (s) => (Number(s) === 1 ? 1 : 0);

async function findBySource(conn, table, tenantId, sourceRef) {
  const [rows] = await conn.execute(
    'SELECT id FROM `' + table + '` WHERE tenant_id = ? AND source_system = ? AND source_ref = ? LIMIT 1',
    [tenantId, SRC, sourceRef]
  );
  return rows.length ? rows[0].id : null;
}

async function upsertOrganisation(conn, tenantId, pl, stats) {
  const existing = await findBySource(conn, 'organisations', tenantId, pl.pl_id);
  if (existing) {
    await conn.execute('UPDATE `organisations` SET name = ?, logo_url = ?, status = ? WHERE id = ?',
      [pl.pl_name, pl.logo || null, fmStatus(pl.status), existing]);
    stats.organisations.updated++; return existing;
  }
  let slug = slugify(pl.pl_name);
  const [clash] = await conn.execute('SELECT id FROM `organisations` WHERE tenant_id = ? AND slug = ? LIMIT 1', [tenantId, slug]);
  if (clash.length) slug = (slug + '-' + pl.pl_id).slice(0, 80);
  const [r] = await conn.execute(
    'INSERT INTO `organisations` (tenant_id, name, slug, logo_url, status, source_system, source_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [tenantId, pl.pl_name, slug, pl.logo || null, fmStatus(pl.status), SRC, pl.pl_id]);
  stats.organisations.inserted++; return r.insertId;
}

async function upsertSite(conn, tenantId, block, organisationId, stats) {
  const existing = await findBySource(conn, 'sites', tenantId, block.id);
  if (existing) {
    await conn.execute('UPDATE `sites` SET organisation_id = ?, name = ?, status = ? WHERE id = ?',
      [organisationId, block.block_name, fmStatus(block.status), existing]);
    stats.sites.updated++; return existing;
  }
  const [r] = await conn.execute(
    'INSERT INTO `sites` (tenant_id, organisation_id, name, status, source_system, source_ref) VALUES (?, ?, ?, ?, ?, ?)',
    [tenantId, organisationId, block.block_name, fmStatus(block.status), SRC, block.id]);
  stats.sites.inserted++; return r.insertId;
}

async function upsertBuilding(conn, tenantId, b, organisationId, siteId, stats) {
  const existing = await findBySource(conn, 'buildings', tenantId, b.id);
  if (existing) {
    await conn.execute('UPDATE `buildings` SET organisation_id = ?, site_id = ?, name = ?, status = ? WHERE id = ?',
      [organisationId, siteId, b.building_name, fmStatus(b.status), existing]);
    stats.buildings.updated++; return existing;
  }
  const [r] = await conn.execute(
    'INSERT INTO `buildings` (tenant_id, organisation_id, site_id, name, status, source_system, source_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [tenantId, organisationId, siteId, b.building_name, fmStatus(b.status), SRC, b.id]);
  stats.buildings.inserted++; return r.insertId;
}

async function upsertFloor(conn, tenantId, f, siteId, buildingId, stats) {
  const img = f.floor_img && String(f.floor_img).trim() ? String(f.floor_img) : null;
  const existing = await findBySource(conn, 'floors', tenantId, f.id);
  if (existing) {
    await conn.execute('UPDATE `floors` SET site_id = ?, building_id = ?, name = ?, layout_image_url = ?, status = ? WHERE id = ?',
      [siteId, buildingId, f.floor_name, img, fmStatus(f.status), existing]);
    stats.floors.updated++; return existing;
  }
  const [r] = await conn.execute(
    'INSERT INTO `floors` (tenant_id, site_id, building_id, name, layout_image_url, status, source_system, source_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [tenantId, siteId, buildingId, f.floor_name, img, fmStatus(f.status), SRC, f.id]);
  stats.floors.inserted++; return r.insertId;
}

/**
 * Pull the Embassy hierarchy for `orgId` and upsert into FM tenant `tenantId`.
 * dryRun rolls the transaction back (writes nothing). Returns a summary.
 */
async function runImport({ orgId = 13, tenantId = 10, dryRun = false } = {}) {
  const tree = currentMode() === 'mock'
    ? orgHierarchy.mockHierarchy(orgId)
    : await orgHierarchy.fetchHierarchyLive(orgId);

  const pcToPl = new Map(tree.pcMap.map((m) => [m.pc_id, m.pl_id]));
  const stats = {
    organisations: { inserted: 0, updated: 0 }, sites: { inserted: 0, updated: 0 },
    buildings: { inserted: 0, updated: 0 }, floors: { inserted: 0, updated: 0 },
  };
  const skipped = [];

  const conn = await fmDb.getConnection();
  try {
    await conn.beginTransaction();

    const plToFm = new Map();
    for (const pl of tree.organisations) plToFm.set(pl.pl_id, await upsertOrganisation(conn, tenantId, pl, stats));

    const blockToSite = new Map();
    const blockToOrg = new Map();
    for (const block of tree.sites) {
      const plId = pcToPl.get(block.pc_id);
      const fmOrg = plId != null ? plToFm.get(plId) : null;
      if (!fmOrg) { skipped.push(`site ${block.id} (${block.block_name}) — pc_id ${block.pc_id} has no org in scope`); continue; }
      const fmSite = await upsertSite(conn, tenantId, block, fmOrg, stats);
      blockToSite.set(block.id, fmSite); blockToOrg.set(block.id, fmOrg);
    }

    const buildingToFm = new Map();
    for (const b of tree.buildings) {
      const fmSite = blockToSite.get(b.block_id);
      const fmOrg = blockToOrg.get(b.block_id);
      if (!fmSite) { skipped.push(`building ${b.id} (${b.building_name}) — block_id ${b.block_id} not imported`); continue; }
      buildingToFm.set(b.id, await upsertBuilding(conn, tenantId, b, fmOrg, fmSite, stats));
    }

    for (const f of tree.floors) {
      const fmSite = blockToSite.get(f.block_id);
      const fmBuilding = buildingToFm.get(f.building_id);
      if (!fmSite || !fmBuilding) {
        const missing = [!fmSite ? `block_id ${f.block_id}` : null, !fmBuilding ? `building_id ${f.building_id}` : null].filter(Boolean).join(' + ');
        skipped.push(`floor ${f.id} (${f.floor_name}) — unresolved parent: ${missing} (trashed or out of org scope)`);
        continue;
      }
      await upsertFloor(conn, tenantId, f, fmSite, fmBuilding, stats);
    }

    if (dryRun) await conn.rollback();
    else await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  return {
    orgId, tenantId, dryRun, mode: currentMode(),
    fetched: {
      organisations: tree.organisations.length, sites: tree.sites.length,
      buildings: tree.buildings.length, floors: tree.floors.length,
    },
    stats, skipped,
  };
}

module.exports = { runImport };
