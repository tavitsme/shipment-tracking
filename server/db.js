/**
 * db.js — PostgreSQL connection pool + query helper
 *
 * Reads DATABASE_URL from the environment (never logs it — it contains the
 * password). Exposes a single shared Pool plus a thin `query()` helper and an
 * `end()` for graceful shutdown.
 *
 * No secrets are stored in this file.
 */
'use strict';

const { Pool } = require('pg');

// Single shared pool for the whole process. pg parses the connection string
// (including ?sslmode=... etc.) from DATABASE_URL automatically.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * query — thin wrapper around pool.query so callers don't import `pool`
 * directly. Forwards (text, params) untouched.
 *
 * On connection failure we throw a generic error; the real message from pg
 * (which may echo the connection string / password) is intentionally not
 * surfaced verbatim to higher layers.
 */
async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    // Re-throw a sanitized error. Do NOT log err.message here — it can contain
    // connection details. Let the caller decide how to report.
    const safe = new Error('Database query failed');
    safe.code = err.code || 'DB_ERROR';
    throw safe;
  }
}

/**
 * end — close the pool cleanly. Used by graceful shutdown handlers and tests.
 */
async function end() {
  await pool.end();
}

// ---------------------------------------------------------------------------
// Graceful shutdown — close the pool on SIGTERM/SIGINT so the process exits
// without leaving connections half-open.
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  try {
    await pool.end();
  } catch (_) {
    // Best-effort during shutdown; ignore.
  }
  // Exit after letting the event loop flush.
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = {
  pool,
  query,
  end,
};
