/**
 * logger.js — tiny internal logger.
 *
 * Writes to stdout/stderr; in production the container runtime / docker
 * collects these. Two responsibilities:
 *
 *   1. logger.error(err, context?) — log a structured error with an optional
 *      context object. The full error is logged for operators (stack included
 *      when present) so postmortems are possible, BUT the caller is responsible
 *      for never passing secrets. This module additionally scrubs a few known
 *      dangerous field names (password / token / secret / authorization /
 *      connection strings) from any context object before logging.
 *
 *   2. logger.info(msg) — plain informational line.
 *
 * SECURITY — non-negotiable rules enforced here:
 *   - NEVER log a plaintext tracking number. Routes work with `number` locally
 *     and pass only masked + hashed forms to the logger / DB.
 *   - NEVER log DATABASE_URL or TRACKING_HASH_SALT.
 *   - Context objects are scrubbed of common secret-bearing keys.
 */
'use strict';

const SECRET_KEY_RE =
  /^(pass(word|wd)?|secret|token|apikey|api_key|authorization|auth|cookie|salt|database_url|connection_string|privatekey|private_key)$/i;

const SECRET_VALUE_HINTS = [
  'postgresql://',
  'postgres://',
  'mysql://',
  'mongodb://',
];

/**
 * deepScrub — return a copy of value with secret-looking keys replaced by
 * '***REDACTED***'. Recurses into plain objects/arrays. Non-objects returned
 * as-is unless they look like a connection string (then redacted).
 */
function deepScrub(value, seen) {
  if (value == null || typeof value !== 'object') {
    // Redact string values that smell like a connection string.
    if (typeof value === 'string' && SECRET_VALUE_HINTS.some((h) => value.toLowerCase().startsWith(h))) {
      return '***REDACTED***';
    }
    return value;
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((v) => deepScrub(v, seen));
  }

  const out = {};
  for (const key of Object.keys(value)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = '***REDACTED***';
    } else {
      out[key] = deepScrub(value[key], seen);
    }
  }
  return out;
}

/**
 * error — log an error with optional context.
 *
 * @param {Error|any} err
 * @param {object} [context]  optional key/value bag (scrubbed before logging)
 */
function error(err, context) {
  const payload = {
    level: 'error',
    time: new Date().toISOString(),
    message: err && err.message ? err.message : String(err),
  };
  if (err && err.stack) {
    payload.stack = err.stack;
  }
  if (err && err.code) {
    payload.code = err.code;
  }
  if (context != null) {
    try {
      payload.context = deepScrub(context, new WeakSet());
    } catch (_) {
      payload.context = '[unserializable]';
    }
  }
  process.stderr.write(JSON.stringify(payload) + '\n');
}

/**
 * info — log a plain info line.
 *
 * @param {string} msg
 * @param {object} [context]  optional scrubbed context
 */
function info(msg, context) {
  const payload = {
    level: 'info',
    time: new Date().toISOString(),
    message: String(msg),
  };
  if (context != null) {
    try {
      payload.context = deepScrub(context, new WeakSet());
    } catch (_) {
      payload.context = '[unserializable]';
    }
  }
  process.stdout.write(JSON.stringify(payload) + '\n');
}

module.exports = {
  error,
  info,
  // exported for tests
  _deepScrub: deepScrub,
};
