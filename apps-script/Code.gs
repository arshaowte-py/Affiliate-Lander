/**
 * Frido Creator lander — submissions + analytics backend (Google Apps Script).
 *
 * Setup
 * 1. Create a Google Sheet. Extensions → Apps Script → paste this file.
 * 2. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone.
 * 3. Copy the /exec URL into CONFIG.submitEndpoint and CONFIG.analyticsEndpoint in index.html.
 *
 * The page treats a submission as successful only when this returns {ok:true, id}.
 */
const APPLICATION_SHEET = 'Applications';
const EVENT_SHEET = 'Events';

const APPLICATION_COLUMNS = [
  'application_id', 'submitted_at', 'name', 'whatsapp', 'existing_affiliate', 'existing_code',
  'platforms', 'handle', 'audience_size', 'categories', 'posting_pace', 'product_interests',
  'whatsapp_consent', 'referring_creator', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
  'landing_referrer', 'session_id', 'source', 'status'
];
const EVENT_COLUMNS = [
  'ts', 'event', 'session_id', 'page', 'referring_creator', 'utm_source', 'application_id',
  'video', 'product', 'location', 'question', 'platform', 'audience_size', 'creator_category', 'product_interest', 'method',
  'existing_affiliate' // appended last so existing Events sheets keep their column order
];
const EVENT_NAME = /^[a-z0-9_]{1,40}$/;
const MAX_CELL = 500;

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    if (p.kind === 'event') {
      if (!EVENT_NAME.test(p.event || '')) return json_({ ok: false, error: 'Bad event' });
      appendRow_(EVENT_SHEET, EVENT_COLUMNS, p);
      return json_({ ok: true });
    }
    if (p.kind !== 'application') return json_({ ok: false, error: 'Unknown kind' });

    // Honeypot: bots fill the hidden "website" field. Answer ok so they don't retry, but store nothing.
    if (p.website) return json_({ ok: true, id: newId_() });

    const err = validate_(p);
    if (err) return json_({ ok: false, error: err });

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const id = p.application_id && /^FC-[A-Z0-9]{6}$/.test(p.application_id) ? p.application_id : newId_();
      p.application_id = id;
      p.status = 'New';
      appendRow_(APPLICATION_SHEET, APPLICATION_COLUMNS, p);
      return json_({ ok: true, id: id });
    } finally {
      lock.releaseLock();
    }
  } catch (ex) {
    return json_({ ok: false, error: String(ex) });
  }
}

function doGet() { return json_({ ok: true, service: 'frido-creator-lander' }); }

function validate_(p) {
  if (!p.name || String(p.name).trim().length < 2) return 'Missing name';
  if (!/^\+91[6-9]\d{9}$/.test(p.whatsapp || '')) return 'Invalid WhatsApp number';
  if (p.whatsapp_consent !== true) return 'Consent required';
  return '';
}

function appendRow_(sheetName, cols, p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  if (sh.getLastRow() === 0) { sh.appendRow(cols); sh.setFrozenRows(1); }
  sh.appendRow(cols.map(c => {
    const v = p[c];
    if (Array.isArray(v)) return v.join(', ');
    if (v === undefined || v === null) return '';
    const s = String(v).slice(0, MAX_CELL);
    return /^[=+\-@]/.test(s) ? "'" + s : s; // block formula injection
  }));
}

function newId_() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = 'FC-';
  for (let i = 0; i < 6; i++) s += a.charAt(Math.floor(Math.random() * a.length));
  return s;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
