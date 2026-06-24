/**
 * track.js — POST /api/track route (mounted inside the BASE_PATH sub-app).
 *
 * Exposes a FACTORY `makeTrackRouter(deps)` so index.js can inject every
 * collaborator (router, config, crypto helpers, db query, logger). This keeps
 * the route handler thin, side-effect-free to construct, and unit-testable
 * without spinning up express.
 *
 * Flow per request:
 *   1. Read validated input from req.trackInput (set by validateTrack).
 *   2. For each number, in order:
 *        - detect carrier (auto) or use the explicit selection
 *        - if unknown: synthesize an 'unknown' result
 *        - else: ask the adapter to track, then map to the API shape
 *        - compute masked + hash + ipHash (PII-safe)
 *        - persist asynchronously (never blocks the response): writes a
 *          tracking_shipments row (when a real carrier was used), a
 *          tracking_requests summary row, and per-number api_usage_logs rows
 *   3. Respond 200 { success:true, results:[...] }
 *
 * PRIVACY: the plaintext `number` exists only as a local variable. Anything
 * that leaves this scope — the response, the DB, logs — uses masked or hashed
 * forms only.
 *
 * FK NOTE: tracking_shipments.carrier_code is NOT NULL and references
 * carriers(carrier_code). For AUTO_UNKNOWN results there is no valid carrier
 * code, so we skip the tracking_shipments insert for those rows (we still log
 * the request to tracking_requests). This avoids FK violations without
 * modifying the Wave-1 schema.
 */
'use strict';

const express = require('express');
const crypto = require('crypto');

const {
  AUTO_UNKNOWN,
  CARRIER_NAMES,
  CARRIER_PROVIDER_LABEL,
  STATUS_THAI,
  STATUS_ENGLISH,
} = require('../contracts');
const { buildApiResult } = require('../normalizer');

/**
 * makeTrackRouter — build an express.Router wired to the given deps.
 *
 * @param {object} deps
 * @param {CarrierRouter} deps.router
 * @param {object} deps.config             frozen config (needs TRACKING_HASH_SALT)
 * @param {function} deps.maskNumber       (raw) -> masked
 * @param {function} deps.hashNumber       (raw, salt) -> hex
 * @param {function} deps.hashIp           (ip, salt) -> hex
 * @param {function} deps.query            db query(text, params)
 * @param {object} deps.logger             { error, info }
 * @returns {import('express').Router}
 */
function makeTrackRouter(deps) {
  const {
    router,
    config,
    maskNumber,
    hashNumber,
    hashIp,
    query,
    logger,
  } = deps;

  const trackRouter = express.Router();

  trackRouter.post('/', async (req, res) => {
    const { tracking_numbers, carrier } = req.trackInput;

    // Per-request artifacts for the audit row.
    const requestId = crypto.randomUUID();
    const ipHash = hashIp(req.ip, config.TRACKING_HASH_SALT);

    const results = [];
    /** Per-number persistence payloads (collected, written after the loop). */
    const persistRows = [];

    for (let i = 0; i < tracking_numbers.length; i++) {
      // Plaintext lives ONLY in this local.
      const number = tracking_numbers[i];

      const detected = carrier === 'auto' ? router.detect(number) : carrier;

      let apiResult;

      if (detected === AUTO_UNKNOWN || !router.has(detected)) {
        // Could not map to a real carrier. Build an explicit unknown result.
        apiResult = {
          tracking_number_masked: maskNumber(number),
          carrier_code: null,
          carrier_name: null,
          status_category: 'unknown',
          status_text_original: STATUS_ENGLISH.unknown,
          status_text_thai: STATUS_THAI.unknown,
          last_update_time: null,
          provider_used: null,
          events: [],
          error: 'Could not detect carrier; please select the carrier manually.',
        };
      } else {
        const adapter = router.get(detected);
        const tracked = await adapter.track([number]);
        const r = tracked && Array.isArray(tracked.results) ? tracked.results[0] : null;
        const safeR = r || {
          status_category: 'unknown',
          status_text_original: STATUS_ENGLISH.unknown,
          status_text_thai: STATUS_THAI.unknown,
          last_update_time: null,
          events: [],
          error: 'Adapter returned no result',
        };

        const providerUsed = CARRIER_PROVIDER_LABEL[detected] || null;
        apiResult = buildApiResult({
          r: safeR,
          masked: maskNumber(number),
          carrierCode: detected,
          carrierName: CARRIER_NAMES[detected] || null,
          providerUsed,
        });

        // Queue persistence for this number (real carrier only — satisfies FK).
        persistRows.push({
          masked: apiResult.tracking_number_masked,
          hash: hashNumber(number, config.TRACKING_HASH_SALT),
          carrierCode: detected,
          statusCategory: apiResult.status_category,
          statusTextOriginal: apiResult.status_text_original,
          statusTextThai: apiResult.status_text_thai,
          lastUpdateTime: apiResult.last_update_time,
          providerUsed,
          providerConfigured: adapter.isConfigured(),
        });
      }

      results.push(apiResult);
    }

    // Respond FIRST, then persist. Persistence must never block or break the
    // user-facing response.
    res.status(200).json({ success: true, results });

    // Asynchronous persistence — fire and forget, log on failure.
    setImmediate(() => {
      persistRequestAudit({
        query,
        logger,
        requestId,
        ipHash,
        userAgent: req.get('user-agent'),
        carrierRequested: carrier,
        numbersCount: tracking_numbers.length,
        persistRows,
      }).catch((err) => {
        // setImmediate already wrapped internals in try/catch; this is a belt.
        logger.error(err, { stage: 'persistRequestAudit', requestId });
      });
    });
  });

  return trackRouter;
}

/**
 * persistRequestAudit — write the request summary + per-number rows.
 *
 * Writes (best-effort, all failures are logged, never thrown to the client):
 *   - 1 row to tracking_requests (request-level audit; no raw PII)
 *   - N rows to tracking_shipments (only for numbers with a real carrier)
 *   - N rows to api_usage_logs  (only for numbers with a real carrier)
 *
 * The plaintext tracking number is NEVER stored — only masked + hash.
 *
 * @returns {Promise<void>}
 */
async function persistRequestAudit({
  query,
  logger,
  requestId,
  ipHash,
  userAgent,
  carrierRequested,
  numbersCount,
  persistRows,
}) {
  // Hash the user agent so it is identifiable but not directly revealing.
  const userAgentHash = userAgent
    ? crypto.createHash('sha256').update(String(userAgent), 'utf8').digest('hex')
    : null;

  try {
    // 1) Request-level audit row.
    await query(
      `INSERT INTO tracking_requests
         (request_id, client_ip_hash, user_agent_hash, carrier_requested,
          selected_carrier, numbers_count, success, error_message)
       VALUES ($1, $2, $3, $4, NULL, $5, TRUE, NULL);`,
      [requestId, ipHash, userAgentHash, carrierRequested, numbersCount]
    );
  } catch (err) {
    logger.error(err, { stage: 'tracking_requests', requestId });
    // continue — per-number writes are independent and still useful
  }

  for (const row of persistRows) {
    try {
      // 2) tracking_shipments — one row per real-carrier number.
      //    Hash column has no unique constraint, so we INSERT each time
      //    (history-preserving). No ON CONFLICT needed.
      await query(
        `INSERT INTO tracking_shipments
           (tracking_number_masked, tracking_number_hash, carrier_code,
            detected_carrier_code, current_status_category,
            current_status_text_original, current_status_text_thai,
            last_update_time, provider_used, raw_response_json)
         VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, NULL);`,
        [
          row.masked,
          row.hash,
          row.carrierCode,
          row.statusCategory,
          row.statusTextOriginal,
          row.statusTextThai,
          row.lastUpdateTime, // ISO string | null -> timestamptz
          row.providerUsed,
        ]
      );
    } catch (err) {
      logger.error(err, { stage: 'tracking_shipments', requestId });
    }

    try {
      // 3) api_usage_logs — provider call observability.
      //    providerConfigured true  -> a live API path ran (ok/error); in the
      //    prototype this branch is never reached because isConfigured()=false.
      //    providerConfigured false -> no credentials, so the adapter short-
      //    circuited to the not-configured result without calling any API.
      const callStatus = row.providerConfigured ? 'ok' : 'not_configured';
      await query(
        `INSERT INTO api_usage_logs
           (provider_code, carrier_code, request_id, api_call_status,
            response_time_ms, error_code, error_message)
         VALUES ($1, $2, $3, $4, NULL, NULL, NULL);`,
        [
          row.providerUsed || row.carrierCode,
          row.carrierCode,
          requestId,
          callStatus,
        ]
      );
    } catch (err) {
      logger.error(err, { stage: 'api_usage_logs', requestId });
    }
  }
}

module.exports = {
  makeTrackRouter,
  // exported for testing
  _persistRequestAudit: persistRequestAudit,
};
