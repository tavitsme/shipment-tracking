/**
 * carrierRouter.js — registry that maps carrierCode -> adapter instance.
 *
 * The route layer asks the router for the adapter handling a given carrier
 * code (explicit selection) or asks it to detect the carrier from a number
 * (auto selection). Keeping this in one place means adapters are constructed
 * exactly once and the wiring is testable without express.
 *
 * Design:
 *   - constructor(adapters) takes already-built adapter instances.
 *   - get(code) returns the adapter or throws (caller passed an unknown code).
 *   - has(code) returns a boolean (used to decide explicit-selection validity).
 *   - detect(number) delegates to detector.detectCarrier (pure).
 */
'use strict';

const { detectCarrier } = require('./detector');
const { AUTO_UNKNOWN } = require('./contracts');

class CarrierRouter {
  /**
   * @param {Array<BaseAdapter>} adapters  pre-built adapter instances
   */
  constructor(adapters) {
    if (!Array.isArray(adapters)) {
      throw new Error('CarrierRouter requires an array of adapters');
    }
    /** @type {Map<string, BaseAdapter>} keyed by carrierCode */
    this._byCode = new Map();
    for (const a of adapters) {
      if (!a || typeof a.carrierCode !== 'string') {
        throw new Error('CarrierRouter received an invalid adapter (missing carrierCode)');
      }
      if (this._byCode.has(a.carrierCode)) {
        throw new Error(`Duplicate adapter for carrierCode: ${a.carrierCode}`);
      }
      this._byCode.set(a.carrierCode, a);
    }
  }

  /**
   * @param {string} carrierCode
   * @returns {boolean}
   */
  has(carrierCode) {
    return this._byCode.has(carrierCode);
  }

  /**
   * @param {string} carrierCode
   * @returns {BaseAdapter}
   * @throws {Error} if no adapter is registered for the code
   */
  get(carrierCode) {
    const adapter = this._byCode.get(carrierCode);
    if (!adapter) {
      throw new Error(`No adapter registered for carrierCode: ${carrierCode}`);
    }
    return adapter;
  }

  /**
   * detect — delegates to the pure detector. Returns a carrierCode or
   * AUTO_UNKNOWN when the shape matches nothing.
   *
   * @param {string} number
   * @returns {string} carrierCode | AUTO_UNKNOWN
   */
  detect(number) {
    return detectCarrier(number);
  }
}

module.exports = {
  CarrierRouter,
  AUTO_UNKNOWN,
};
