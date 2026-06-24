/**
 * BaseAdapter.js — abstract base class for all carrier adapters.
 *
 * Every concrete carrier adapter (ThailandPost, DHL, FedEx, UPS, Aramex, SF)
 * extends this class and overrides:
 *   - carrierCode        (canonical code from CARRIER_CODES)
 *   - carrierName        ({ en, th } from CARRIER_NAMES)
 *   - requiredEnvKeys    (env var names from CARRIER_ENV_KEYS)
 *
 * The base class provides the shared plumbing:
 *   - isConfigured()           credential presence check
 *   - supports(code)           carrier-code matching
 *   - track(numbers)           template method (subclass overrides)
 *   - normalize(raw)           shape contract (subclass overrides)
 *   - notConfiguredResult(num) helper used by every adapter in the prototype
 *
 * Prototype phase rule: isConfigured() is always false (no real env creds),
 * so every tracking number resolves to notConfiguredResult(num). No real HTTP
 * calls execute and no data is fabricated.
 *
 * Language rule (parent CLAUDE.md): code/comments in English; user-facing
 * Thai strings are pulled from contracts.js, never hardcoded here.
 */

'use strict';

const { DEFAULT_PROVIDER_NOT_CONFIGURED } = require('../contracts');

class BaseAdapter {
  constructor() {
    // Prevent direct instantiation of the abstract base.
    if (this.constructor === BaseAdapter) {
      throw new Error('BaseAdapter is abstract and cannot be instantiated directly');
    }
  }

  /**
   * Canonical carrier code (e.g. 'dhl_express').
   * Subclasses MUST override. Pulled from CARRIER_CODES.
   */
  get carrierCode() {
    throw new Error(`${this.constructor.name} must override carrierCode`);
  }

  /**
   * Display name { en, th }. Subclasses MUST override.
   * Pulled from CARRIER_NAMES[<code>].
   */
  get carrierName() {
    throw new Error(`${this.constructor.name} must override carrierName`);
  }

  /**
   * Required env var names (e.g. ['DHL_API_KEY','DHL_API_SECRET']).
   * Subclasses MUST override. Pulled from CARRIER_ENV_KEYS[<code>].
   */
  get requiredEnvKeys() {
    throw new Error(`${this.constructor.name} must override requiredEnvKeys`);
  }

  /**
   * True only if EVERY requiredEnvKey is present and non-empty (trimmed)
   * in process.env. Drives the not-configured fallback in the prototype.
   *
   * Security: never logs env values — only checks presence.
   */
  isConfigured() {
    return this.requiredEnvKeys.every((k) => {
      const v = process.env[k];
      return typeof v === 'string' && v.trim() !== '';
    });
  }

  /**
   * Returns true when the given carrier code matches this adapter.
   */
  supports(carrierCode) {
    return carrierCode === this.carrierCode;
  }

  /**
   * Track one or more tracking numbers.
   * Returns:
   *   { carrier_code, carrier_name:{en,th},
   *     results: [ { tracking_number, ...normalized | ...notConfigured } ] }
   *
   * Subclasses override with the standard implementation that maps each
   * number to either live tracking (when configured) or notConfiguredResult.
   */
  async track(trackingNumbers) {
    throw new Error(`${this.constructor.name} must override track`);
  }

  /**
   * Normalize a raw provider response into the standard result shape:
   *   { status_category, status_text_original, status_text_thai,
   *     last_update_time, events:[{time,location,description_original,
   *     description_thai,status_category}] }
   *
   * Subclasses override to map carrier-specific statuses into the shared
   * STATUS_CATEGORIES + Thai labels.
   */
  normalize(rawProviderResponse) {
    throw new Error(`${this.constructor.name} must override normalize`);
  }

  /**
   * Helper every adapter uses in the prototype (no creds) phase.
   * Produces a per-number result that spreads DEFAULT_PROVIDER_NOT_CONFIGURED
   * and stamps the tracking number on it.
   */
  notConfiguredResult(num) {
    const base = { ...DEFAULT_PROVIDER_NOT_CONFIGURED };
    return { tracking_number: num, ...base };
  }
}

module.exports = BaseAdapter;
