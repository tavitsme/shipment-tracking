/**
 * FedExExpressAdapter.js — adapter for FedEx Express.
 *
 * Prototype phase: isConfigured() is false (no FEDEX_CLIENT_ID /
 * FEDEX_CLIENT_SECRET in env), so every tracking number resolves to
 * notConfiguredResult(num). No real API call is made and no data is fabricated.
 *
 * Phase 6 will wire the real FedEx API inside #liveTrackOne and implement the
 * status mapping inside normalize().
 */

'use strict';

const BaseAdapter = require('./BaseAdapter');
const {
  CARRIER_CODES,
  CARRIER_NAMES,
  CARRIER_ENV_KEYS,
} = require('../contracts');

class FedExExpressAdapter extends BaseAdapter {
  get carrierCode() {
    return CARRIER_CODES.FEDEX;
  }

  get carrierName() {
    return CARRIER_NAMES[CARRIER_CODES.FEDEX];
  }

  get requiredEnvKeys() {
    return CARRIER_ENV_KEYS[CARRIER_CODES.FEDEX];
  }

  async track(trackingNumbers) {
    const results = trackingNumbers.map((num) =>
      this.isConfigured() ? this.#liveTrackOne(num) : this.notConfiguredResult(num),
    );
    return {
      carrier_code: this.carrierCode,
      carrier_name: this.carrierName,
      results,
    };
  }

  /**
   * Live tracking stub. Throws until Phase 6 implements the real FedEx API
   * call using requiredEnvKeys.
   */
  async #liveTrackOne(num) {
    // TODO Phase 6: call the real FedEx API here using requiredEnvKeys,
    // then return normalize(rawApiResp) merged with { tracking_number: num }.
    throw new Error(`${this.carrierCode} live tracking not implemented in prototype`);
  }

  normalize(raw) {
    // TODO Phase 6: map FedEx-specific statuses into STATUS_CATEGORIES + Thai
    // labels. For now return an unknown-shape; will be replaced when the API
    // is integrated.
    const { STATUS_THAI, STATUS_ENGLISH } = require('../contracts');
    return {
      status_category: 'unknown',
      status_text_original: STATUS_ENGLISH.unknown,
      status_text_thai: STATUS_THAI.unknown,
      last_update_time: null,
      events: [],
    };
  }
}

module.exports = FedExExpressAdapter;
