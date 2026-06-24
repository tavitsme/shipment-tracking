/* ============================================================================
 * Shipment Tracking Prototype — frontend logic
 *
 * Mirrors server/contracts.js (MAX_TRACKING_NUMBERS=10, length 5..50) but does
 * NOT import it (browser app). Status Thai text is rendered FROM the API
 * response (status_text_thai) — no local dictionary.
 *
 * Only ever calls our own API: POST <BASE>/api/track
 * ========================================================================== */

'use strict';

// ---------------------------------------------------------------------------
// Constants (must match server/contracts.js)
// ---------------------------------------------------------------------------
const MAX_TRACKING_NUMBERS = 10;
const MIN_NUMBER_LENGTH = 5;
const MAX_NUMBER_LENGTH = 50;

// API base path: read from <meta name="api-base"> so it works both locally
// (no prefix) and on the VPS (served under /tracking).
const BASE =
  document.querySelector('meta[name="api-base"]')?.getAttribute('content') || '';

// Safe character set for a tracking number: letters, digits, space, dash.
const SAFE_NUMBER_RE = /^[A-Za-z0-9 -]+$/;

// ---------------------------------------------------------------------------
// Carrier tracking-page URLs (official, public pages — NOT scraping).
// Verified: 2026-06-24. Update this single map if a carrier changes its URL.
//
// Each value is a function that receives the REAL (un-masked) tracking number
// the user typed and returns the URL to that carrier's tracking page. When a
// carrier's public page does NOT accept the number as a URL parameter, the
// function simply returns the carrier's tracking homepage (the user pastes the
// number there). This is legitimate: these are official pages and the number is
// the user's own input (kept client-side only — never sent to our logs/DB).
// ---------------------------------------------------------------------------
const CARRIER_TRACK_URLS = Object.freeze({
  // Thailand Post: the Thai tracking page does not document a query param for
  // prefill, so we link to the homepage (user pastes the number).
  thailand_post: (_num) => 'https://track.thailandpost.co.th/',

  // DHL Express: Thai/EN tracking page. The site is a JS app; we pass the
  // number via the `tracking-id` query param (best-effort prefill — it opens
  // the tracking page either way).
  dhl_express: (num) =>
    `https://www.dhl.com/th-en/home/tracking.html?tracking-id=${encodeURIComponent(num)}`,

  // FedEx: community-verified `trknbr` query param (widely used; opens the
  // result page directly when the number is valid).
  fedex_express: (num) =>
    `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(num)}`,

  // UPS: official `tracknum` query param on the UPS track page.
  ups_express: (num) =>
    `https://www.ups.com/track?loc=en_US&tracknum=${encodeURIComponent(num)}&requester=ST/trackdetails`,

  // Aramex: the public tracking page does not document a query param for
  // prefill, so we link to the homepage (user pastes the number).
  aramex_express: (_num) => 'https://www.aramex.com/th/en/track/shipments',

  // SF Express: the public list page does not accept the number as a query
  // param, so we link to the homepage (user pastes the waybill number).
  sf_express: (_num) => 'https://www.sf-express.com/chn/en/waybill/list',
});

// Thai display labels for the undetected-carrier picker (mirrors
// server/contracts.js CARRIER_NAMES.th). Kept here so the frontend is
// self-contained (it does not import server modules).
const CARRIER_LABELS_TH = Object.freeze({
  thailand_post: 'ไปรษณีย์ไทย',
  dhl_express: 'DHL Express',
  fedex_express: 'FedEx Express',
  ups_express: 'UPS Express',
  aramex_express: 'Aramex Express',
  sf_express: 'SF Express',
});

// Small external-link icon (inline SVG — no CDN). Used in the carrier button.
const EXTERNAL_LINK_SVG =
  '<svg class="ext-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M14 3a1 1 0 0 0 0 2h3.59l-9.3 9.29a1 1 0 1 0 1.42 1.42L19 6.41V10a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-6z"/>' +
  '<path fill="currentColor" d="M5 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 1 0-2 0v5H5V7h5a1 1 0 0 0 0-2H5z"/>' +
  '</svg>';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const form = document.getElementById('tracking-form');
const inputEl = document.getElementById('tracking-input');
const carrierEl = document.getElementById('carrier-select');
const submitBtn = document.getElementById('submit-btn');
const btnLabel = submitBtn.querySelector('.btn__label');
const btnSpinner = submitBtn.querySelector('.btn__spinner');
const counterEl = document.getElementById('counter');
const formErrorEl = document.getElementById('form-error');
const resultsEl = document.getElementById('results');
const globalErrorEl = document.getElementById('global-error');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the textarea into a cleaned list of tracking-number candidates. */
function parseNumbers(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Escape user content before injecting into innerHTML. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format an ISO time string for display, or '—' when null/invalid. */
function formatTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  // e.g. "24 มิ.ย. 2569 · 10:00"
  return (
    d.toLocaleDateString('th-TH', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }) +
    ' · ' +
    d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  );
}

/** Update the live counter chip (N / 10). */
function updateCounter() {
  const count = parseNumbers(inputEl.value).length;
  counterEl.textContent = `${count} / ${MAX_TRACKING_NUMBERS}`;
  counterEl.classList.toggle('is-warn', count > MAX_TRACKING_NUMBERS);
}

/** Show / hide inline form error. */
function setFormError(message) {
  if (!message) {
    formErrorEl.hidden = true;
    formErrorEl.textContent = '';
    return;
  }
  formErrorEl.textContent = message;
  formErrorEl.hidden = false;
}

/** Show / hide the global error banner. */
function setGlobalError(message) {
  if (!message) {
    globalErrorEl.hidden = true;
    globalErrorEl.textContent = '';
    return;
  }
  globalErrorEl.textContent = message;
  globalErrorEl.hidden = false;
}

/** Toggle the loading state on the submit button. */
function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  btnLabel.hidden = isLoading;
  btnSpinner.hidden = !isLoading;
}

// ---------------------------------------------------------------------------
// Frontend validation (mirrors contracts limits). Returns { ok, error }.
// ---------------------------------------------------------------------------
function validateInput(numbers) {
  if (numbers.length === 0) {
    return { ok: false, error: 'กรุณากรอกอย่างน้อย 1 หมายเลข' };
  }
  if (numbers.length > MAX_TRACKING_NUMBERS) {
    return { ok: false, error: 'กรอกได้สูงสุด 10 หมายเลข' };
  }
  for (const num of numbers) {
    if (num.length < MIN_NUMBER_LENGTH || num.length > MAX_NUMBER_LENGTH) {
      return { ok: false, error: 'แต่ละหมายเลขต้องมี 5-50 ตัวอักษร' };
    }
    if (!SAFE_NUMBER_RE.test(num)) {
      return {
        ok: false,
        error: 'หมายเลขต้องประกอบด้วยตัวอักษร ตัวเลข ช่องว่าง หรือขีดกลางเท่านั้น',
      };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Result rendering
// ---------------------------------------------------------------------------

/**
 * Build the HTML for one tracking result card.
 *
 * @param {object} result - one result object from the API response
 * @param {number} index - position in the results array (matches the order of
 *   the original tracking_numbers the frontend sent, so we can recover the
 *   REAL — un-masked — number for building a carrier tracking link).
 * @param {string[]} originalNumbers - the original (un-masked) tracking numbers
 *   parsed from the textarea, in send order.
 */
function renderResultCard(result, index, originalNumbers) {
  const category = result.status_category || 'unknown';
  // carrier_name is either { en, th } or null (per server/contracts.js). Pick a
  // readable display string (prefer Thai), and also keep the raw object for the
  // carrier button below.
  const carrierNameObj =
    result.carrier_name && typeof result.carrier_name === 'object'
      ? result.carrier_name
      : null;
  const carrierName = (carrierNameObj && (carrierNameObj.th || carrierNameObj.en)) || '—';
  const carrierCode = result.carrier_code || '—';
  const statusThai = result.status_text_thai || result.status_text_original || '—';
  const lastUpdate = formatTime(result.last_update_time);
  const provider = result.provider_used ? esc(result.provider_used) : '';
  const hasError = !!result.error;

  // Recover the real (un-masked) number for this card by index. This number is
  // the user's own input, stays client-side, and is never sent to our logs/DB.
  const realNumber =
    originalNumbers && index < originalNumbers.length
      ? originalNumbers[index]
      : '';

  // Class modifiers
  const cardModifierClass = (() => {
    if (category === 'provider_not_configured') return ' result-card--info result-card--provider_not_configured';
    if (category === 'unknown') return ' result-card--hint result-card--unknown';
    return ` result-card--${category}`;
  })();

  // Special note lines
  const infoNote =
    category === 'provider_not_configured'
      ? `<div class="result-card__note">ℹ️ ระบบยังไม่ได้เชื่อมต่อ API ของขนส่งนี้ในขั้นตอนนี้ (เพื่อนำไปใช้งานจริง ต้องตั้งค่า API credentials ของขนส่งก่อน)</div>`
      : '';

  const hintNote =
    category === 'unknown'
      ? `<div class="result-card__note">💡 ไม่สามารถระบุขนส่งได้อัตโนมัติ — ลองเลือกบริษัทขนส่งจากเมนูด้านบนด้วยตนเองแล้วกดติดตามอีกครั้ง</div>`
      : '';

  const errorBlock = hasError && category !== 'provider_not_configured'
    ? `<div class="result-card__error">⚠️ ${esc(result.error)}</div>`
    : '';

  // ---- "Track on carrier website" fallback button ----
  // Show when a carrier was detected (carrier_code is a real carrier, not null)
  // AND the API could not give a real status (provider_not_configured / unknown).
  // The carrier_name object has { en, th }; fall back to the code label if absent.
  const detectedCarrier = CARRIER_TRACK_URLS[carrierCode];
  const showCarrierButton =
    detectedCarrier &&
    carrierCode !== 'auto_unknown' &&
    realNumber &&
    (category === 'provider_not_configured' || category === 'unknown');

  let carrierButtonHtml = '';
  if (showCarrierButton) {
    // Prefer the Thai display name; fall back to the (string) carrier_name,
    // then to the carrier code. Keep the raw string here — it gets escaped
    // once in the template literal below.
    const carrierTh =
      (carrierNameObj && carrierNameObj.th) ||
      (carrierNameObj && carrierNameObj.en) ||
      carrierName ||
      carrierCode;
    const trackUrl = detectedCarrier(realNumber);
    carrierButtonHtml = `
      <div class="carrier-link">
        <a class="carrier-link__btn" href="${esc(trackUrl)}" target="_blank" rel="noopener noreferrer">
          เปิดหน้าติดตามของ ${esc(carrierTh)}
          ${EXTERNAL_LINK_SVG}
        </a>
        <p class="carrier-link__hint">ระบบยังไม่ได้เชื่อม API — กดปุ่มเพื่อตรวจสอบบนเว็บของขนส่งโดยตรง</p>
      </div>`;
  }

  // ---- Undetected carrier: offer ALL carrier homepages so the user can pick ----
  // Shown only for the truly undetected case (carrier_code null/auto_unknown),
  // in addition to the existing gentle hint. No real number is embedded here —
  // these are plain links to each carrier's tracking homepage.
  let allCarriersHtml = '';
  const isUndetected =
    (!carrierCode || carrierCode === 'auto_unknown' || carrierCode === '—') &&
    category === 'unknown';
  if (isUndetected) {
    const links = Object.keys(CARRIER_TRACK_URLS)
      .map((code) => {
        const url = CARRIER_TRACK_URLS[code](''); // homepage (number-independent for these)
        // Friendly Thai labels mirror server/contracts.js CARRIER_NAMES.th
        const label = CARRIER_LABELS_TH[code] || code;
        return `<a class="carrier-link__chip" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ${EXTERNAL_LINK_SVG}</a>`;
      })
      .join('');
    allCarriersHtml = `
      <div class="carrier-link carrier-link--picker">
        <p class="carrier-link__hint">หรือเปิดหน้าติดตามของขนส่งที่ท่านคิดว่าน่าจะใช้:</p>
        <div class="carrier-link__chips">${links}</div>
      </div>`;
  }

  // Timeline (reverse chronological — API may already be newest-first,
  // but we force newest-first defensively).
  const events = Array.isArray(result.events) ? [...result.events] : [];
  const timelineHtml =
    events.length > 0
      ? `<ul class="timeline">${events
          .map((ev) => {
            const t = formatTime(ev.time);
            const loc = ev.location ? esc(ev.location) : '';
            const desc =
              ev.description_thai ||
              ev.description_original ||
              '';
            return `<li class="timeline__item">
              <div class="timeline__time">${t}</div>
              ${loc ? `<div class="timeline__loc">${loc}</div>` : ''}
              ${desc ? `<div class="timeline__desc">${esc(desc)}</div>` : ''}
            </li>`;
          })
          .join('')}</ul>`
      : '';

  return `
    <article class="result-card${cardModifierClass}">
      <div class="result-card__head">
        <span class="result-card__number">${esc(result.tracking_number_masked || '—')}</span>
        <span class="result-card__carrier">${esc(carrierName)}</span>
        <span class="tag">${esc(carrierCode)}</span>
        <span class="badge badge--${esc(category)}">${esc(category.replace(/_/g, ' '))}</span>
      </div>
      <div class="result-card__status">${esc(statusThai)}</div>
      <div class="result-card__meta">อัปเดตล่าสุด: <strong>${lastUpdate}</strong></div>
      ${provider ? `<div class="result-card__meta">แหล่งข้อมูล: <strong>${provider}</strong></div>` : ''}
      ${infoNote}
      ${hintNote}
      ${carrierButtonHtml}
      ${allCarriersHtml}
      ${errorBlock}
      ${timelineHtml}
    </article>`;
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------
async function callTrackApi(numbers, carrier) {
  const res = await fetch(`${BASE}/api/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tracking_numbers: numbers, carrier }),
  });

  // Try to parse JSON regardless of status code (errors are JSON too).
  let data = null;
  let parseFailed = false;
  try {
    data = await res.json();
  } catch (_) {
    parseFailed = true;
  }

  if (parseFailed || !data) {
    throw new Error(
      'ไม่สามารถอ่านข้อมูลจากเซิร์ฟเวอร์ได้ (Non-JSON response) กรุณาลองใหม่อีกครั้ง'
    );
  }

  // Validation error from backend (HTTP 400/429): { success:false, error }
  if (data.success === false) {
    throw new Error(data.error || 'เกิดข้อผิดพลาดในการตรวจสอบข้อมูล');
  }

  if (!data.success || !Array.isArray(data.results)) {
    throw new Error('รูปแบบข้อมูลตอบกลับไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
  }

  return data.results;
}

// ---------------------------------------------------------------------------
// Form submit handler
// ---------------------------------------------------------------------------
async function handleSubmit(event) {
  event.preventDefault();
  setFormError('');
  setGlobalError('');
  resultsEl.innerHTML = '';

  const numbers = parseNumbers(inputEl.value);
  const validation = validateInput(numbers);
  if (!validation.ok) {
    setFormError(validation.error);
    return;
  }

  setLoading(true);
  try {
    const results = await callTrackApi(numbers, carrierEl.value);
    // `numbers` holds the ORIGINAL (un-masked) tracking numbers in send order.
    // The API returns results in the same order, so each result's index maps
    // back to its real number — used to build the carrier tracking link.
    resultsEl.innerHTML = results
      .map((r, i) => renderResultCard(r, i, numbers))
      .join('');
    if (results.length === 0) {
      resultsEl.innerHTML =
        '<div class="result-card result-card--unknown"><div class="result-card__status">ไม่พบผลลัพธ์</div></div>';
    }
  } catch (err) {
    // Distinguish network/fetch failure from API-returned business errors.
    const message =
      err && err.message
        ? err.message
        : 'เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง';
    setGlobalError(message);
  } finally {
    setLoading(false);
  }
}

// ---------------------------------------------------------------------------
// Wire up events
// ---------------------------------------------------------------------------
inputEl.addEventListener('input', updateCounter);
form.addEventListener('submit', handleSubmit);
updateCounter();
