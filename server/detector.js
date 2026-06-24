/**
 * detector.js — carrier detection from a tracking number's shape.
 *
 * Pure function: no env, no I/O, no side effects. Iterates DETECT_PATTERNS
 * (from contracts, ordered by priority) and returns the first matching
 * carrierCode. If nothing matches, returns AUTO_UNKNOWN.
 *
 * Detection is best-effort — it is only used when the client selects 'auto'.
 * A wrong/unknown detection never breaks a request; the route falls back to a
 * user-facing "please select carrier manually" result.
 */
'use strict';

const { DETECT_PATTERNS, AUTO_UNKNOWN } = require('./contracts');

/**
 * detectCarrier — first-match carrier detection.
 *
 * Normalizes whitespace + case before matching so '1Z...' and ' 1z... ' both
 * resolve consistently. Does NOT mutate the caller's string.
 *
 * @param {string} number  raw tracking number
 * @returns {string} carrierCode from CARRIER_CODES, or AUTO_UNKNOWN
 */
function detectCarrier(number) {
  const s = String(number == null ? '' : number).trim().toUpperCase();

  if (s === '') {
    return AUTO_UNKNOWN;
  }

  for (const { carrierCode, re } of DETECT_PATTERNS) {
    if (re.test(s)) {
      return carrierCode;
    }
  }
  return AUTO_UNKNOWN;
}

module.exports = {
  detectCarrier,
  AUTO_UNKNOWN,
};
