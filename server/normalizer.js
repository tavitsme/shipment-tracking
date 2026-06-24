/**
 * normalizer.js — helpers that turn an adapter result into the per-number API
 * response object, plus a status-text mapper for adapters that return only a
 * status_category.
 *
 * These helpers contain NO business secrets and never see the raw tracking
 * number — the route already passes the MASKED form in here. The raw number is
 * handled only inside the route scope (local variable) and is masked before it
 * touches anything this module produces.
 *
 * Two exports:
 *   - buildApiResult({ r, masked, carrierCode, carrierName, providerUsed })
 *       Maps adapter result `r` (ADAPTER_RESULT_SHAPE.results[i]) to the API
 *       RESPONSE_SHAPE per-result object, replacing tracking_number with the
 *       masked form and adding carrier_code / carrier_name / provider_used.
 *
 *   - statusTextsFromCategory(category)
 *       Returns { status_text_thai, status_text_original } from the shared
 *       STATUS_THAI / STATUS_ENGLISH maps. Used for adapters that emit a
 *       category but no text.
 */
'use strict';

const { STATUS_THAI, STATUS_ENGLISH } = require('./contracts');

/**
 * statusTextsFromCategory — look up Thai + English labels for a status category.
 * Falls back to the 'unknown' bucket if the category is missing/unrecognized,
 * so a malformed adapter response can never produce undefined strings.
 *
 * @param {string} category
 * @returns {{ status_text_thai: string, status_text_original: string }}
 */
function statusTextsFromCategory(category) {
  const cat = STATUS_THAI.hasOwnProperty(category) ? category : 'unknown';
  return {
    status_text_thai: STATUS_THAI[cat],
    status_text_original: STATUS_ENGLISH[cat],
  };
}

/**
 * buildApiResult — assemble the per-number API response object.
 *
 * @param {object} opts
 * @param {object} opts.r          adapter result row (has tracking_number, which
 *                                 is discarded in favor of `masked`)
 * @param {string} opts.masked     masked tracking number (e.g. "AB12****90")
 * @param {string|null} [opts.carrierCode]
 * @param {{en:string,th:string}|null} [opts.carrierName]
 * @param {string|null} [opts.providerUsed]
 * @returns {object} RESPONSE_SHAPE per-result
 */
function buildApiResult({ r, masked, carrierCode = null, carrierName = null, providerUsed = null }) {
  const events = Array.isArray(r && r.events) ? r.events : [];

  // carrier_name in the API is the display object { en, th }; null when unknown.
  return {
    tracking_number_masked: masked,
    carrier_code: carrierCode,
    carrier_name: carrierName,
    status_category: (r && r.status_category) || 'unknown',
    status_text_original:
      (r && r.status_text_original) || statusTextsFromCategory(r && r.status_category).status_text_original,
    status_text_thai:
      (r && r.status_text_thai) || statusTextsFromCategory(r && r.status_category).status_text_thai,
    last_update_time: r && r.last_update_time ? toIso(r.last_update_time) : null,
    provider_used: providerUsed,
    events,
    error: r && r.error ? r.error : null,
  };
}

/**
 * toIso — coerce a Date / ISO string / epoch into an ISO string. Returns null
 * for anything unparseable so the API never emits an invalid timestamp.
 */
function toIso(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = {
  buildApiResult,
  statusTextsFromCategory,
  toIso,
};
