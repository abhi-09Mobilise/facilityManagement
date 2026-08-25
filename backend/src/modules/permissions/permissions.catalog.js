// Permission catalog — the single source of truth for every permission key
// in the product, plus the hard-coded default matrix.
//
// Adding a feature? Register its permission here ONCE and it automatically
// appears in the Roles & permissions matrix UI and in /permissions/effective.
//
// Values: 'yes' | 'team' | 'no'
//   'team' = limited to direct reports / own department ("Team only").
//
// super_admin is intentionally NOT in the matrix — it is implicitly 'yes'
// for every key and locked in the UI, so nobody can lock themselves out.

const ROLES = ['tenant_admin', 'org_admin', 'approver', 'employee'];

// [key, label, group, { tenant_admin, org_admin, approver, employee }]
const CATALOG = [
  // ---- Booking ----
  ['booking.book_self',      'Book a facility for myself',            'Booking',
    { tenant_admin: 'yes', org_admin: 'yes', approver: 'yes', employee: 'yes' }],
  ['booking.book_on_behalf', 'Book on behalf of others',              'Booking',
    { tenant_admin: 'yes', org_admin: 'yes', approver: 'team', employee: 'no' }],
  ['booking.cancel_any',     'Cancel any booking',                    'Booking',
    { tenant_admin: 'yes', org_admin: 'yes', approver: 'no', employee: 'no' }],
  ['booking.approve',        'Approve / reject bookings',             'Booking',
    { tenant_admin: 'yes', org_admin: 'yes', approver: 'yes', employee: 'no' }],
  ['booking.manual_release', 'Release a booking manually',            'Booking',
    { tenant_admin: 'yes', org_admin: 'yes', approver: 'no', employee: 'no' }],

  // ---- Seating & visibility ----
  ['seating.view_team',      'See own team seating',                  'Seating & visibility',
    { tenant_admin: 'yes', org_admin: 'yes', approver: 'yes', employee: 'yes' }],
  ['seating.view_all',       'See all seating (ignores privacy)',     'Seating & visibility',
    { tenant_admin: 'yes', org_admin: 'yes', approver: 'team', employee: 'no' }],

  // ---- Workplace administration ----
  ['admin.block_desks',      'Block desks / maintenance',             'Workplace administration',
    { tenant_admin: 'yes', org_admin: 'yes', approver: 'no', employee: 'no' }],
  ['admin.edit_rules',       'Edit booking rules & grace periods',    'Workplace administration',
    { tenant_admin: 'yes', org_admin: 'no', approver: 'no', employee: 'no' }],
  ['masters.manage',         'Manage masters (sites, floors, desks)', 'Workplace administration',
    { tenant_admin: 'yes', org_admin: 'team', approver: 'no', employee: 'no' }],
  ['users.manage',           'Manage employees & departments',        'Workplace administration',
    { tenant_admin: 'yes', org_admin: 'team', approver: 'no', employee: 'no' }],

  // ---- Analytics & reporting ----
  ['analytics.view',         'View dashboards & analytics',           'Analytics & reporting',
    { tenant_admin: 'yes', org_admin: 'yes', approver: 'team', employee: 'no' }],
  ['analytics.export',       'Export reports (Excel / PDF)',          'Analytics & reporting',
    { tenant_admin: 'yes', org_admin: 'yes', approver: 'no', employee: 'no' }],
  ['reports.schedule',       'Schedule report emails',                'Analytics & reporting',
    { tenant_admin: 'yes', org_admin: 'no', approver: 'no', employee: 'no' }],

  // ---- Governance ----
  ['audit.view',             'View the audit log',                    'Governance',
    { tenant_admin: 'yes', org_admin: 'no', approver: 'no', employee: 'no' }],
  ['roles.manage',           'Edit roles & permissions',              'Governance',
    { tenant_admin: 'yes', org_admin: 'no', approver: 'no', employee: 'no' }],
  ['integrations.manage',    'Manage integrations',                   'Governance',
    { tenant_admin: 'no', org_admin: 'no', approver: 'no', employee: 'no' }],
];

const KEYS = CATALOG.map((c) => c[0]);

function defaultsFor(role) {
  const out = {};
  CATALOG.forEach(([key, , , def]) => { out[key] = def[role] || 'no'; });
  return out;
}

module.exports = { ROLES, CATALOG, KEYS, defaultsFor };
