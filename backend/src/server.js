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

app.use(cors({
  origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
  credentials: true,
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
