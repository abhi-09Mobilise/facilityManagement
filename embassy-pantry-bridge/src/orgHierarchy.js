// Embassy org-hierarchy reader.
//
// SEPARATE from the pantry queries (queries.js) on purpose — this feeds the FM
// masters import (organisations / sites / buildings / floors), not the pantry
// widget. READ-ONLY: only SELECTs, never writes to the Embassy DB.
//
// Embassy hierarchy (scoped by org_id — Embassy = org_id 13):
//   0_org (13)                         -> FM tenant (fixed, not imported)
//   0_org_pl      (pl_id)              -> FM organisations
//   0_org_pc      (pc_id, pl_id)       -> NOT an FM level; used only to map a
//                                         block's pc_id up to its pl (org)
//   0_org_pc_block    (id, pc_id)              -> FM sites
//   0_org_pc_building (id, block_id)           -> FM buildings
//   0_org_pc_floor    (id, block_id, building_id, floor_img) -> FM floors
//
// All lists are filtered to `org_id = ? AND trash = 0`. The FM importer
// resolves parents from these via source_ref (the Embassy PKs).

const db = require('./db');

// Each query returns only the columns the FM importer needs. trash=0 excludes
// soft-deleted rows; status is passed through for the importer to map.
async function fetchHierarchyLive(orgId) {
  const [organisations, pcMap, sites, buildings, floors] = await Promise.all([
    db.query(
      'SELECT pl_id, pl_name, logo, status ' +
      '  FROM `0_org_pl` WHERE org_id = ? AND trash = 0 ORDER BY pl_id',
      [orgId]
    ),
    db.query(
      'SELECT pc_id, pl_id ' +
      '  FROM `0_org_pc` WHERE org_id = ? AND trash = 0',
      [orgId]
    ),
    db.query(
      'SELECT id, pc_id, block_name, status ' +
      '  FROM `0_org_pc_block` WHERE org_id = ? AND trash = 0 ORDER BY id',
      [orgId]
    ),
    db.query(
      'SELECT id, block_id, building_name, status ' +
      '  FROM `0_org_pc_building` WHERE org_id = ? AND trash = 0 ORDER BY id',
      [orgId]
    ),
    db.query(
      'SELECT id, block_id, building_id, floor_name, floor_img, status ' +
      '  FROM `0_org_pc_floor` WHERE org_id = ? AND trash = 0 ORDER BY id',
      [orgId]
    ),
  ]);

  return {
    org_id: Number(orgId),
    organisations: organisations.map((r) => ({
      pl_id: Number(r.pl_id), pl_name: r.pl_name, logo: r.logo || null, status: Number(r.status),
    })),
    pcMap: pcMap.map((r) => ({ pc_id: Number(r.pc_id), pl_id: Number(r.pl_id) })),
    sites: sites.map((r) => ({
      id: Number(r.id), pc_id: Number(r.pc_id), block_name: r.block_name, status: Number(r.status),
    })),
    buildings: buildings.map((r) => ({
      id: Number(r.id), block_id: Number(r.block_id), building_name: r.building_name, status: Number(r.status),
    })),
    floors: floors.map((r) => ({
      id: Number(r.id), block_id: Number(r.block_id), building_id: Number(r.building_id),
      floor_name: r.floor_name, floor_img: r.floor_img || null, status: Number(r.status),
    })),
  };
}

// Deterministic mock tree so BRIDGE_MODE=mock exercises the FM importer wiring
// end-to-end without the Embassy subnet. 2 orgs -> 1 pc each -> 2 sites ->
// 1 building each -> 2 floors each.
function mockHierarchy(orgId) {
  const organisations = [
    { pl_id: 101, pl_name: 'Embassy TechVillage', logo: null, status: 1 },
    { pl_id: 102, pl_name: 'Embassy GolfLinks',   logo: null, status: 1 },
  ];
  const pcMap = [
    { pc_id: 201, pl_id: 101 },
    { pc_id: 202, pl_id: 102 },
  ];
  const sites = [
    { id: 301, pc_id: 201, block_name: 'TechVillage Block A', status: 1 },
    { id: 302, pc_id: 201, block_name: 'TechVillage Block B', status: 1 },
    { id: 303, pc_id: 202, block_name: 'GolfLinks Block A',   status: 1 },
  ];
  const buildings = [
    { id: 401, block_id: 301, building_name: 'Tower 1', status: 1 },
    { id: 402, block_id: 302, building_name: 'Tower 2', status: 1 },
    { id: 403, block_id: 303, building_name: 'Tower 1', status: 1 },
  ];
  const floors = [
    { id: 501, block_id: 301, building_id: 401, floor_name: 'Ground', floor_img: null, status: 1 },
    { id: 502, block_id: 301, building_id: 401, floor_name: 'Level 1', floor_img: null, status: 1 },
    { id: 503, block_id: 303, building_id: 403, floor_name: 'Ground', floor_img: null, status: 1 },
  ];
  return { org_id: Number(orgId) || 13, organisations, pcMap, sites, buildings, floors };
}

module.exports = { fetchHierarchyLive, mockHierarchy };
