/**
 * validateTrack.js — body-validation middleware for POST /api/track.
 *
 * Runs AFTER express.json() has parsed the body and AFTER the rate limiter.
 * On any validation failure it responds 400 with a user-safe message and does
 * NOT call next() (the route handler never runs). On success it normalizes the
 * body and attaches the cleaned input as req.trackInput, then calls next().
 *
 * Rules:
 *   - body must be a plain object
 *   - tracking_numbers must be an Array of strings, length 1..MAX_TRACKING_NUMBERS
 *   - each entry, after trim, must be non-empty, length MIN..MAX (5..50)
 *   - each entry must match a safe charset: letters, digits, spaces, dashes only
 *   - carrier must be 'auto' or one of the CARRIER_CODE_LIST codes
 *
 * Security: this is the public boundary — every downstream node trusts that
 * req.trackInput is already validated, so being strict here is load-bearing.
 */
'use strict';

const {
  MAX_TRACKING_NUMBERS,
  MIN_NUMBER_LENGTH,
  MAX_NUMBER_LENGTH,
  CARRIER_CODE_LIST,
} = require('../contracts');

// Safe charset: A-Z, a-z, 0-9, space, dash. Anything else is rejected.
const SAFE_CHARSET_RE = /^[A-Za-z0-9 -]+$/;

const VALID_CARRIERS = new Set(['auto', ...CARRIER_CODE_LIST]);

/**
 * Respond with a 400 validation error. Centralized so the shape stays
 * consistent. Never includes the offending value (could leak input).
 */
function fail(res, message) {
  return res.status(400).json({ success: false, error: message });
}

/**
 * validateTrack — the middleware.
 */
function validateTrack(req, res, next) {
  const { body } = req;

  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return fail(res, 'Invalid request body: expected a JSON object.');
  }

  // --- tracking_numbers ---------------------------------------------------
  const { tracking_numbers } = body;

  if (!Array.isArray(tracking_numbers)) {
    return fail(res, 'tracking_numbers must be an array of strings.');
  }

  if (tracking_numbers.length < 1 || tracking_numbers.length > MAX_TRACKING_NUMBERS) {
    return fail(
      res,
      `tracking_numbers must contain between 1 and ${MAX_TRACKING_NUMBERS} items.`
    );
  }

  const cleaned = [];
  for (let i = 0; i < tracking_numbers.length; i++) {
    const entry = tracking_numbers[i];

    if (typeof entry !== 'string') {
      return fail(res, `tracking_numbers[${i}] must be a string.`);
    }

    const trimmed = entry.trim();
    if (trimmed === '') {
      return fail(res, `tracking_numbers[${i}] must not be empty.`);
    }

    if (trimmed.length < MIN_NUMBER_LENGTH || trimmed.length > MAX_NUMBER_LENGTH) {
      return fail(
        res,
        `tracking_numbers[${i}] must be between ${MIN_NUMBER_LENGTH} and ${MAX_NUMBER_LENGTH} characters.`
      );
    }

    if (!SAFE_CHARSET_RE.test(trimmed)) {
      return fail(
        res,
        `tracking_numbers[${i}] contains invalid characters. Only letters, digits, spaces, and dashes are allowed.`
      );
    }

    cleaned.push(trimmed);
  }

  // --- carrier ------------------------------------------------------------
  const { carrier } = body;
  const carrierStr = carrier == null ? 'auto' : String(carrier).trim().toLowerCase();

  if (!VALID_CARRIERS.has(carrierStr)) {
    return fail(
      res,
      "carrier must be 'auto' or a supported carrier code."
    );
  }

  // Attach normalized input for the route handler.
  req.trackInput = {
    tracking_numbers: cleaned,
    carrier: carrierStr,
  };

  return next();
}

module.exports = validateTrack;
