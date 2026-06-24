/**
 * env.js — boot-time environment assertion.
 *
 * Loads dotenv (so .env is honored in local dev) and throws synchronously if a
 * required variable is missing or empty. Failing fast at boot is safer than
 * discovering a missing salt mid-request (which would silently weaken hashing).
 *
 * Required:
 *   - DATABASE_URL          Postgres connection string (read by db.js / pg).
 *   - TRACKING_HASH_SALT    Salt for hashNumber() / hashIp() (crypto.js).
 *
 * Security: never logs the VALUES of these vars — only their presence.
 */
'use strict';

// Load .env into process.env (no-op if the file is absent, e.g. on the VPS
// where env vars come from the process environment / docker). dotenv is an
// optional loader: if it is somehow unavailable we still work, because env
// vars may already be set by the process environment / container.
try {
  // eslint-disable-next-line global-require
  const dotenv = require('dotenv');
  if (dotenv && typeof dotenv.config === 'function') {
    dotenv.config();
  }
} catch (_) {
  // dotenv not installed (e.g. before `npm install`). proceed; assertEnv()
  // will still enforce the required vars against process.env.
}

const REQUIRED = ['DATABASE_URL', 'TRACKING_HASH_SALT'];

/**
 * assertEnv — throw on first missing/empty required var. Called once at boot
 * from index.js before anything else (before db pool is used, before the
 * server listens).
 *
 * @throws {Error} when one or more required vars are missing or blank.
 */
function assertEnv() {
  const missing = [];

  for (const key of REQUIRED) {
    const v = process.env[key];
    if (typeof v !== 'string' || v.trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    // List keys only — never values. Keep the message stable for logs.
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Set them in your environment or .env file before starting the server.'
    );
  }
}

module.exports = {
  assertEnv,
  REQUIRED,
};
