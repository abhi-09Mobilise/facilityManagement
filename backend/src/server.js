// Facility Management API entrypoint.
// Started with: npm run dev  (or npm start)

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const config = require('./config');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const mailer = require('./utils/mailer');
const checkoutSweeper = require('./jobs/checkoutSweeper'); // F02

const app = express();

// CORS — accepts a comma-separated list in CORS_ORIGIN, or '*' for open.
// Each entry is matched literally against the request Origin header. We also
// log declined origins once so an operator can spot a typo'd domain in .env.
const corsList = (config.corsOrigin === '*' ? null : config.corsOrigin
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean));
const corsSeen = new Set(); // for one-line logging of unknown origins
app.use(cors({
  origin: function corsOriginFn(origin, cb) {
    // Non-browser callers (curl, server-to-server, healthchecks) send no
    // Origin header — allow through so /api/health and cron endpoints work.
    if (!origin) return cb(null, true);
    // Wildcard mode (CORS_ORIGIN=* or unset) — allow any origin.
    if (corsList === null) return cb(null, true);
    if (corsList.includes(origin)) return cb(null, true);
    if (!corsSeen.has(origin)) {
      corsSeen.add(origin);
      console.warn('[cors] declined origin: ' + origin + '  (allowed: ' + corsList.join(', ') + ')');
    }
    return cb(new Error('CORS: origin ' + origin + ' not allowed'));
  },
  credentials: true,
  // Some browsers don't send 200 on preflight unless we say so.
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

// Serve uploaded files (ticket attachments etc.)
app.use('/uploads', express.static(path.resolve(config.uploads.dir)));

// F03 - public portal (no auth, separate from /api).
app.use('/public', require('./modules/public/public.routes'));

// API
app.use('/api', routes);

// 404
app.use((req, res) => res.status(404).json({ status: false, msg: 'Route not found' }));

// Central error handler — must be last
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`FM API listening on http://localhost:${config.port} (${config.nodeEnv})`);
  // Probe SMTP so the operator knows whether outbound mail will work.
  mailer.verifyConnection();
  // F02 - start the check-out sweeper (every 5 minutes by default).
  checkoutSweeper.start(Number(process.env.CHECKOUT_SWEEP_MS) || undefined);
});
