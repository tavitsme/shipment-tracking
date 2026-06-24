/**
 * crypto.js — PII-safe helpers for tracking numbers and client IPs
 *
 * Design rules:
 *  - Salt is ALWAYS passed in by the caller (read env in the app layer, e.g.
 *    process.env.TRACKING_HASH_SALT). This module never reads env directly, so
 *    it stays pure and unit-testable.
 *  - No secrets are hardcoded here.
 *  - Normalization is consistent across maskNumber/hashNumber/hashIp so the
 *    same input always produces the same mask and hash.
 */
'use strict';

const crypto = require('crypto');

/**
 * normalize — uppercase + trim. Used by every helper so casing/whitespace
 * never produces inconsistent masks or hashes.
 * @param {string} raw
 * @returns {string}
 */
function normalize(raw) {
  return String(raw == null ? '' : raw).trim().toUpperCase();
}

/**
 * maskNumber — produce a display-safe version of a tracking number.
 *   - length <= 4           -> '****'
 *   - length 5..8           -> first 2 + '****' + last 2
 *   - length > 8            -> first 4 + '****' + last 4
 * The middle is never exposed.
 *
 * @param {string} raw
 * @returns {string}
 */
function maskNumber(raw) {
  const s = normalize(raw);
  const len = s.length;

  if (len === 0) return '****';
  if (len <= 4) return '****';
  if (len <= 8) {
    return s.slice(0, 2) + '****' + s.slice(-2);
  }
  return s.slice(0, 4) + '****' + s.slice(-4);
}

/**
 * hashNumber — sha256(salt + normalizedNumber) as 64-char lowercase hex.
 * Used as the lookup key for tracking_shipments so the raw number is never
 * stored.
 *
 * @param {string} raw
 * @param {string} salt  REQUIRED — caller must provide (e.g. TRACKING_HASH_SALT)
 * @returns {string} 64-char hex digest
 */
function hashNumber(raw, salt) {
  const normalized = normalize(raw);
  return crypto
    .createHash('sha256')
    .update(String(salt) + normalized, 'utf8')
    .digest('hex');
}

/**
 * hashIp — sha256 hash of a client IP for audit storage. Salt is optional but
 * recommended (use a separate or shared salt from the caller). Returns 64-char
 * hex. IPs are hashed without upper-casing (IPv6 case is normalized to lower).
 *
 * @param {string} ip
 * @param {string} [salt='']  optional; pass a salt for stronger unlinkability
 * @returns {string} 64-char hex digest
 */
function hashIp(ip, salt = '') {
  const normalized = String(ip == null ? '' : ip).trim().toLowerCase();
  return crypto
    .createHash('sha256')
    .update(String(salt) + normalized, 'utf8')
    .digest('hex');
}

module.exports = {
  normalize,
  maskNumber,
  hashNumber,
  hashIp,
};
