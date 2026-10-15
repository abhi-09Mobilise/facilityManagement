require('dotenv').config();

// Parse "6:7,12:3" → Map { 6 → 7, 12 → 3 }. Silently ignores malformed entries
// so a typo in one pair doesn't nuke the whole config.
function parseTenantMap(raw) {
  const out = new Map();
  for (const part of String(raw).split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [a, b] = trimmed.split(':').map(function (s) { return s.trim(); });
    const fmTid = Number(a);
    const pcId = Number(b);
    if (Number.isFinite(fmTid) && fmTid > 0 && Number.isFinite(pcId) && pcId > 0) {
      out.set(fmTid, pcId);
    }
  }
  return out;
}

const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'socampus_fm',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },
  uploads: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxBytes: (parseInt(process.env.MAX_UPLOAD_MB || '10', 10)) * 1024 * 1024,
  },
  // QR / arrival check-in window (docs/10_qr_checkin.md). Flat per-tenant
  // constants until the per-facility grace-config feature (M3) lands.
  checkin: {
    opensMin: parseInt(process.env.CHECKIN_OPENS_MIN || '15', 10), // how early you can check in
    graceMin: parseInt(process.env.CHECKIN_GRACE_MIN || '30', 10), // how late before it's a no-show
  },
  // Embassy pantry bridge (separate Node service that aggregates pantry
  // data from the external IFMS/Embassy MySQL). Only tenants listed in the
  // mapping proxy to the bridge; all others keep using FM's own pantry
  // tables. See embassy-pantry-bridge/README.md.
  //
  // EMBASSY_TENANT_MAP format: "<fm_tenant_id>:<embassy_pc_id>,..."
  //   e.g. "6:7"  →  FM tenant 6 is served by Embassy pc_id 7.
  //   e.g. "6:7,12:3"  →  two tenants mapped.
  // Empty / unset → bridge disabled, no tenant uses it.
  bridge: {
    pantryUrl:      process.env.PANTRY_BRIDGE_URL      || '',
    pantrySecret:   process.env.PANTRY_BRIDGE_SECRET   || '',
    pantryTimeoutMs: parseInt(process.env.PANTRY_BRIDGE_TIMEOUT_MS || '6000', 10),
    tenantMap:      parseTenantMap(process.env.EMBASSY_TENANT_MAP || ''),
  },
  mail: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    // Defaults to TRUE (Node rejects self-signed certs). Set
    // SMTP_REJECT_UNAUTHORIZED=false in .env when targeting a server with a
    // self-signed / private-CA cert (typical for internal company SMTP).
    rejectUnauthorized:
      String(process.env.SMTP_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false',
    from: process.env.MAIL_FROM || 'no-reply@example.com',
    publicUrl: process.env.APP_PUBLIC_URL || 'http://localhost:5173',
    resetTtlMin: parseInt(process.env.PASSWORD_RESET_TTL_MIN || '1440', 10),
  },
};

module.exports = config;
