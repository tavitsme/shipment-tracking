/**
 * index.js — application entrypoint.
 *
 * Boot order (each step guards the next):
 *   1. dotenv loads .env (also loaded defensively inside env.js).
 *   2. env.assertEnv() throws if DATABASE_URL or TRACKING_HASH_SALT is missing
 *      or blank — fail fast, never serve with weak hashing.
 *   3. config parsed (frozen singleton).
 *   4. runMigrations() — on failure, log + exit(1). We refuse to serve a
 *      half-broken app.
 *   5. Build the 6 adapter instances and the CarrierRouter.
 *   6. Build the express app:
 *        - helmet + morgan('combined') on the main app
 *        - a sub-app mounted at BASE_PATH:
 *            * express.json({ limit:'32kb' })
 *            * express.static(public/)        serves the frontend
 *            * /api/track  -> rateLimit, validateTrack, trackRouter(deps)
 *            * errorHandler (last)
 *        - mainApp.use(notFound) catch-all 404
 *   7. listen(config.PORT).
 *
 * Graceful: SIGTERM/SIGINT -> db.end() then exit(0). (db.js also has its own
 * handler; we attach one here so the exit is explicit from this entrypoint.)
 */
'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const { assertEnv } = require('./env');
const config = require('./config');
const logger = require('./logger');
const { runMigrations } = require('./migrate');
const { query, end: dbEnd } = require('./db');
const { CarrierRouter } = require('./carrierRouter');
const { maskNumber, hashNumber, hashIp } = require('./crypto');

// Adapters (each exports a class)
const ThailandPostAdapter = require('./adapters/ThailandPostAdapter');
const DhlExpressAdapter = require('./adapters/DhlExpressAdapter');
const FedExExpressAdapter = require('./adapters/FedExExpressAdapter');
const UpsExpressAdapter = require('./adapters/UpsExpressAdapter');
const AramexExpressAdapter = require('./adapters/AramexExpressAdapter');
const SfExpressAdapter = require('./adapters/SfExpressAdapter');

// Middleware
const rateLimit = require('./middleware/rateLimit');
const validateTrack = require('./middleware/validateTrack');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Route factory
const { makeTrackRouter } = require('./routes/track');

/**
 * buildAdapters — construct the 6 carrier adapter instances in a fixed order.
 * @returns {Array<BaseAdapter>}
 */
function buildAdapters() {
  return [
    new ThailandPostAdapter(),
    new DhlExpressAdapter(),
    new FedExExpressAdapter(),
    new UpsExpressAdapter(),
    new AramexExpressAdapter(),
    new SfExpressAdapter(),
  ];
}

/**
 * boot — async startup sequence. Exits the process on hard failure.
 */
async function boot() {
  // 1 + 2: env must be present before anything reads it.
  // dotenv is also required inside env.js; requiring it here first matches the
  // documented boot order and is harmless (idempotent).
  require('dotenv').config();
  assertEnv(); // throws -> process exits below

  // 3: config (frozen singleton) is now safe to read.

  // 4: migrations. On failure we exit(1) rather than serving a broken app.
  try {
    await runMigrations();
  } catch (err) {
    logger.error(err, { stage: 'migrations' });
    process.exit(1);
  }

  // 5: adapters + router (DI keeps construction single & testable).
  const adapters = buildAdapters();
  const router = new CarrierRouter(adapters);

  // 6: express app.
  const deps = {
    router,
    config,
    maskNumber,
    hashNumber,
    hashIp,
    query,
    logger,
  };

  const mainApp = express();

  // Trust the single Traefik reverse-proxy hop so req.ip / X-Forwarded-For are
  // honored (rate-limit keying + client_ip_hash). Without this, express-rate-limit
  // emits ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and keys everyone as the same IP.
  mainApp.set('trust proxy', 1);

  // Security + observability on the main app (applies to every mount).
  mainApp.use(helmet());
  mainApp.use(morgan('combined')); // no body logging — morgan never sees req.body

  // Sub-app scoped to BASE_PATH. Keeps the frontend, API, and error handling
  // under one prefix (e.g. /tracking) so the VPS reverse proxy is simple.
  const subApp = express();

  // Body parser: small cap to bound request cost. Runs on the sub-app so the
  // 404/error handlers on the main app are not affected.
  subApp.use(express.json({ limit: '32kb' }));

  // Static frontend. public/index.html declares <meta name="api-base"> so the
  // SPA knows the API lives at the same BASE_PATH it was served from.
  subApp.use(express.static(path.join(__dirname, '..', 'public')));

  // API route — rate limit first, then body validation, then handler.
  const trackRouter = makeTrackRouter(deps);
  subApp.use('/api/track', rateLimit, validateTrack, trackRouter);

  // Sub-app error handler (last). Caches errors raised inside the sub-app.
  subApp.use(errorHandler);

  // Mount the sub-app under BASE_PATH. When BASE_PATH is '' (local dev) it is
  // mounted at root.
  mainApp.use(config.BASE_PATH, subApp);

  // Catch-all 404 on the main app (after the sub-app so unmatched sub-app
  // paths also 404 via this handler).
  mainApp.use(notFound);

  // 7: listen.
  mainApp.listen(config.PORT, () => {
    logger.info(
      `listening on ${config.PORT} under ${JSON.stringify(config.BASE_PATH)} (env=${config.NODE_ENV})`
    );
  });

  // Graceful shutdown.
  const shutdown = async (signal) => {
    logger.info(`received ${signal}, shutting down`);
    try {
      await dbEnd();
    } catch (err) {
      logger.error(err, { stage: 'shutdown' });
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Run boot. Surface any synchronous throw (e.g. assertEnv) as a clean exit.
boot().catch((err) => {
  // logger may not be initialized fully yet; fall back to console for the
  // boot-critical message. Never log env values here.
  try {
    logger.error(err, { stage: 'boot' });
  } catch (_) {
    console.error('[boot] fatal error during startup');
  }
  process.exit(1);
});

module.exports = { boot, buildAdapters };
