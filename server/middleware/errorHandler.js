/**
 * errorHandler.js — Express error-handling middleware + 404 handler.
 *
 * Two exports:
 *   - errorHandler(err, req, res, next)  registered LAST. Logs the full error
 *     for operators (via logger.error, which scrubs secret-looking context)
 *     and responds with a generic 500. NEVER sends err.stack or err.message
 *     to the client — internal details stay internal.
 *   - notFound(req, res)                 catch-all 404 for unmatched routes.
 *
 * Security: the client only ever sees { success:false, error:'...' } with a
 * fixed, user-safe string. Stack traces and raw messages live in server logs.
 */
'use strict';

const logger = require('../logger');

/**
 * Express error-handling middleware (4-arg signature is required by Express to
 * identify it as an error handler).
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Build a safe context: HTTP method, path (no query/body), and a request id
  // if present. NEVER include req.body (may contain tracking numbers) or
  // req.ip raw in logs beyond what logger already redacts.
  const context = {
    method: req.method,
    path: req.path,
    requestId: req.id || null,
  };

  logger.error(err, context);

  // Always respond with the same generic message. Status 500 unless the error
  // already carries a known numeric code in a safe range we want to honor —
  // but to keep behavior predictable we always send 500 here.
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
}

/**
 * notFound — terminal 404 for anything not matched by a route. Registered as
 * the very last middleware on the main app (after the BASE_PATH sub-app).
 */
function notFound(req, res) {
  res.status(404).json({ success: false, error: 'Not found' });
}

module.exports = {
  errorHandler,
  notFound,
};
