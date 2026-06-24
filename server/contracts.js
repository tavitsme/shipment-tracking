/**
 * contracts.js — SHARED CONTRACT (frozen, imported by every module)
 *
 * This file is the single source of truth that lets every subsystem
 * (frontend doc, database DDL, carrier adapters, backend integration)
 * agree on the same shapes without drift. Wave-0 authored; do not change
 * the exported const names without coordinating all consumers.
 *
 * Language rule (parent CLAUDE.md): code/comments in English; user-facing
 * Thai strings are data here, so they live in this file as UTF-8 constants.
 */

'use strict';

// ---------------------------------------------------------------------------
// Carrier codes (canonical keys everywhere — DB, adapters, API, frontend)
// ---------------------------------------------------------------------------
const CARRIER_CODES = Object.freeze({
  THAILAND_POST: 'thailand_post',
  DHL: 'dhl_express',
  FEDEX: 'fedex_express',
  UPS: 'ups_express',
  ARAMEX: 'aramex_express',
  SF: 'sf_express',
});

// Ordered list (UI dropdown order + detection priority)
const CARRIER_CODE_LIST = Object.freeze([
  CARRIER_CODES.THAILAND_POST,
  CARRIER_CODES.DHL,
  CARRIER_CODES.FEDEX,
  CARRIER_CODES.UPS,
  CARRIER_CODES.ARAMEX,
  CARRIER_CODES.SF,
]);

// Display names per carrier — { en, th }
const CARRIER_NAMES = Object.freeze({
  [CARRIER_CODES.THAILAND_POST]: { en: 'Thailand Post', th: 'ไปรษณีย์ไทย' },
  [CARRIER_CODES.DHL]: { en: 'DHL Express', th: 'ดีเอชแอล เอ็กซ์เพรส' },
  [CARRIER_CODES.FEDEX]: { en: 'FedEx Express', th: 'เฟดเอ็กซ์ เอ็กซ์เพรส' },
  [CARRIER_CODES.UPS]: { en: 'UPS Express', th: 'ยูพีเอส เอ็กซ์เพรส' },
  [CARRIER_CODES.ARAMEX]: { en: 'Aramex Express', th: 'อาราเม็กซ์ เอ็กซ์เพรส' },
  [CARRIER_CODES.SF]: { en: 'SF Express', th: 'เอสเอฟ เอ็กซ์เพรส' },
});

// Special "could not detect" pseudo-carrier
const AUTO_UNKNOWN = 'auto_unknown';

// ---------------------------------------------------------------------------
// Required env var keys per carrier — drives isConfigured()
// ---------------------------------------------------------------------------
const CARRIER_ENV_KEYS = Object.freeze({
  [CARRIER_CODES.THAILAND_POST]: ['THAILAND_POST_API_TOKEN'],
  [CARRIER_CODES.DHL]: ['DHL_API_KEY', 'DHL_API_SECRET'],
  [CARRIER_CODES.FEDEX]: ['FEDEX_CLIENT_ID', 'FEDEX_CLIENT_SECRET'],
  [CARRIER_CODES.UPS]: ['UPS_CLIENT_ID', 'UPS_CLIENT_SECRET'],
  [CARRIER_CODES.ARAMEX]: [
    'ARAMEX_USERNAME',
    'ARAMEX_PASSWORD',
    'ARAMEX_ACCOUNT_NUMBER',
    'ARAMEX_ACCOUNT_PIN',
  ],
  [CARRIER_CODES.SF]: ['SF_EXPRESS_CLIENT_CODE', 'SF_EXPRESS_CHECKWORD'],
});

// "provider_used" label per carrier (direct_<carrier> convention from requirement)
const CARRIER_PROVIDER_LABEL = Object.freeze({
  [CARRIER_CODES.THAILAND_POST]: 'direct_thailand_post',
  [CARRIER_CODES.DHL]: 'direct_dhl',
  [CARRIER_CODES.FEDEX]: 'direct_fedex',
  [CARRIER_CODES.UPS]: 'direct_ups',
  [CARRIER_CODES.ARAMEX]: 'direct_aramex',
  [CARRIER_CODES.SF]: 'direct_sf',
});

// ---------------------------------------------------------------------------
// Status categories + Thai explanations (requirement: Status Normalization)
// ---------------------------------------------------------------------------
const STATUS_CATEGORIES = Object.freeze([
  'information_received',
  'picked_up',
  'in_transit',
  'customs_clearance',
  'out_for_delivery',
  'delivered',
  'exception',
  'failed_delivery',
  'returned',
  'expired',
  'unknown',
  'provider_not_configured',
  'error',
]);

// Thai label per status category (user-facing)
const STATUS_THAI = Object.freeze({
  information_received: 'ขนส่งได้รับข้อมูลการจัดส่งแล้ว',
  picked_up: 'เข้ารับพัสดุแล้ว',
  in_transit: 'อยู่ระหว่างขนส่ง',
  customs_clearance: 'อยู่ระหว่างพิธีการศุลกากร',
  out_for_delivery: 'กำลังนำจ่าย',
  delivered: 'จัดส่งสำเร็จ',
  exception: 'พัสดุมีข้อขัดข้อง',
  failed_delivery: 'จัดส่งไม่สำเร็จ',
  returned: 'พัสดุกำลังตีกลับ',
  expired: 'ข้อมูลหมดอายุหรือไม่พบการอัปเดตนานเกินไป',
  unknown: 'ยังไม่พบสถานะที่ชัดเจน',
  provider_not_configured: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ API ของขนส่งนี้',
  error: 'ระบบไม่สามารถตรวจสอบสถานะได้ในขณะนี้',
});

// English (original) status text per category — companion to STATUS_THAI
const STATUS_ENGLISH = Object.freeze({
  information_received: 'Shipping information received',
  picked_up: 'Shipment picked up',
  in_transit: 'In transit',
  customs_clearance: 'Customs clearance',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  exception: 'Shipment exception',
  failed_delivery: 'Failed delivery attempt',
  returned: 'Return in progress',
  expired: 'Expired or no recent update',
  unknown: 'Status not yet clear',
  provider_not_configured: 'Provider credentials are not configured',
  error: 'Unable to check status at this time',
});

// ---------------------------------------------------------------------------
// Carrier detection — best-effort regex patterns (no API fan-out)
// Order matters: check in this sequence; first match wins.
// ---------------------------------------------------------------------------
const DETECT_PATTERNS = Object.freeze([
  { carrierCode: CARRIER_CODES.UPS, re: /^1Z[0-9A-Z]{6,}$/i },
  { carrierCode: CARRIER_CODES.THAILAND_POST, re: /^\d{13}$/ },
  { carrierCode: CARRIER_CODES.FEDEX, re: /^\d{12}$/ },
  { carrierCode: CARRIER_CODES.DHL, re: /^\d{10}$/ },
  { carrierCode: CARRIER_CODES.SF, re: /^[A-Za-z]{2,3}\d{9,12}$/ },
  { carrierCode: CARRIER_CODES.ARAMEX, re: /^\d{7,9}$/ },
]);

// ---------------------------------------------------------------------------
// Input limits (validated on BOTH frontend and backend)
// ---------------------------------------------------------------------------
const MAX_TRACKING_NUMBERS = 10;
const MIN_NUMBER_LENGTH = 5;
const MAX_NUMBER_LENGTH = 50;

// ---------------------------------------------------------------------------
// Response / result shapes — documentation contracts (no runtime enforcement,
// but every producer must conform). These are also referenced in tests/docs.
// ---------------------------------------------------------------------------

/**
 * DEFAULT_PROVIDER_NOT_CONFIGURED — the per-number result shape when a
 * carrier's env credentials are missing. Returned by every adapter in the
 * prototype phase (no real creds exist yet).
 *
 * { status_category, status_text_original, status_text_thai,
 *   last_update_time, events, error }
 */
const DEFAULT_PROVIDER_NOT_CONFIGURED = Object.freeze({
  status_category: 'provider_not_configured',
  status_text_original: STATUS_ENGLISH.provider_not_configured,
  status_text_thai: STATUS_THAI.provider_not_configured,
  last_update_time: null,
  events: [],
  error: 'Missing API credentials',
});

/**
 * NORMALIZED_EVENT_SHAPE — what normalize() must produce per event:
 *   { time, location, description_original, description_thai, status_category }
 *
 * ADAPTER_RESULT_SHAPE — what adapter.track(numbers) must resolve to:
 *   { carrier_code, carrier_name:{en,th},
 *     results: [ { tracking_number, status_category, status_text_original,
 *                  status_text_thai, last_update_time, events:[...], error } ] }
 *
 * RESPONSE_SHAPE — top-level API response:
 *   { success: true,
 *     results: [ { tracking_number_masked, carrier_code, carrier_name,
 *                  status_category, status_text_original, status_text_thai,
 *                  last_update_time, provider_used, events:[...], error } ] }
 *
 * On validation failure: { success:false, error:<user-safe message> } with HTTP 400/429.
 */
const NORMALIZED_EVENT_SHAPE = 'NORMALIZED_EVENT_SHAPE';
const ADAPTER_RESULT_SHAPE = 'ADAPTER_RESULT_SHAPE';
const RESPONSE_SHAPE = 'RESPONSE_SHAPE';

module.exports = {
  // carriers
  CARRIER_CODES,
  CARRIER_CODE_LIST,
  CARRIER_NAMES,
  CARRIER_ENV_KEYS,
  CARRIER_PROVIDER_LABEL,
  AUTO_UNKNOWN,
  // status
  STATUS_CATEGORIES,
  STATUS_THAI,
  STATUS_ENGLISH,
  // detection
  DETECT_PATTERNS,
  // limits
  MAX_TRACKING_NUMBERS,
  MIN_NUMBER_LENGTH,
  MAX_NUMBER_LENGTH,
  // shape constants (documented contracts)
  DEFAULT_PROVIDER_NOT_CONFIGURED,
  NORMALIZED_EVENT_SHAPE,
  ADAPTER_RESULT_SHAPE,
  RESPONSE_SHAPE,
};
