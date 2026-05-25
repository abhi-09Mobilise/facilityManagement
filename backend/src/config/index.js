require('dotenv').config();

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
