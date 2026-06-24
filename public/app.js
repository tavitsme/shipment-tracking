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

/** Build the HTML for one tracking result card. */
function renderResultCard(result) {
  const category = result.status_category || 'unknown';
  const carrierName = result.carrier_name || '—';
  const carrierCode = result.carrier_code || '—';
  const statusThai = result.status_text_thai || result.status_text_original || '—';
  const lastUpdate = formatTime(result.last_update_time);
  const provider = result.provider_used ? esc(result.provider_used) : '';
  const hasError = !!result.error;

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
    resultsEl.innerHTML = results.map(renderResultCard).join('');
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
