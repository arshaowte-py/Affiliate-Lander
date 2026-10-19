/**
 * Frido Creator lander — applications → Google Sheet (backup) → Bigin CRM.
 *
 * ONE-TIME SETUP
 * 1. Create a Google Sheet ("Frido Creator Applications") → Extensions → Apps Script.
 *    Replace Code.gs with this file. Save.
 * 2. Run `setup` once (approve permissions). Log should say "Setup OK".
 * 3. Zoho: api-console.zoho.in → your Self Client → Generate Code
 *      scope: ZohoBigin.modules.ALL,ZohoBigin.modules.notes.ALL,ZohoBigin.settings.layouts.READ,ZohoBigin.settings.tags.ALL,ZohoBigin.users.READ,ZohoSearch.securesearch.READ
 *      (search needs ZohoSearch.securesearch.READ; ZohoBigin.settings.READ is not a real scope)
 *      duration: 10 minutes → Create → pick the Frido org → copy the code.
 *    Paste the code, Client ID and Client Secret into connectBigin() below,
 *    run `connectBigin` within 10 minutes, then DELETE the three values from the
 *    file and save. The refresh token now lives in Script Properties only.
 * 4. Run `checkBigin`. It finds the "Creator Onboarding" pipeline, reads its fields
 *    and logs which form answers will land in which Bigin field.
 * 5. Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone.
 *    Copy the /exec URL into CONFIG.submitEndpoint + CONFIG.analyticsEndpoint (index.html).
 *    index.html passes it to apply.html as ?ep=, so apply.html needs no edit.
 * 6. Run `installRetryTrigger` once. Any application Bigin rejects is retried every 10 minutes.
 * After editing this file later: Deploy → Manage deployments → edit → Version: New version.
 *
 * The page shows success only after the Sheet write succeeds ({ok:true, id}).
 * Bigin is synced right after; if Bigin is down, the row waits for the retry trigger.
 */

/* ---------- Settings ---------- */
const BIGIN = {
  accountsUrl: 'https://accounts.zoho.in',       // India data centre
  pipelineName: 'Creator Onboarding',
  newStage: 'New Application',
  ownerId: '',                                    // optional Bigin user ID to own new records (blank = token owner)
  tag: 'Creator Lander'
};

/* Form answer → Bigin pipeline field LABEL, exactly as created in Bigin (spelling included).
   checkBigin() turns labels into API names and logs any answer that has no matching picklist option. */
const FIELD_LABELS = {
  application_id: 'Application ID',
  instagram: 'Instagram Handle',
  instagram_url: 'Instagram URL',
  followers_range: 'Followers Range',
  avg_views_range: 'Avg Reel Views',
  other_accounts_text: 'Other Accounts',
  niche: 'Niche',
  open_to: 'Open To',
  partnership_ads: 'Partnership Ads OK',
  fee_per_reel: 'Fee per Reel',
  products: 'Products Interested',
  language: 'Content Language',
  heard_from: 'Herd From',                 // label is spelled "Herd" in Bigin
  heard_from_person: 'Herd from Person',
  frido_contact: 'In Touch with Frido',
  frido_contact_name: 'Frido Contact Name',
  frido_contact_team: 'Frido Contact Team',
  ref: 'Outreach Reference',
  utm_campaign: 'UTM Campaign',            // not on the layout yet: goes in the note until it is added
  existing_code: 'Existing Affiliate Code' // not on the layout yet: goes in the note until it is added
};

/* Form wording → Bigin picklist option where the two differ beyond case, spacing and dash style
   (those are matched automatically). An answer with no matching option is left out of that field
   and kept in the note, so one odd value never blocks the record. */
const VALUE_MAP = {
  open_to: { 'Affiliate money': 'Affiliate Commission' },
  products: { 'Cushions & seating': 'Cushion & Seating' }
};

/* ---------- Sheet ---------- */
const APP_SHEET = 'Creator Applications';
const EVENT_SHEET = 'Events';
const APP_COLUMNS = [
  'application_id', 'submitted_at', 'status', 'bigin_status', 'bigin_contact_id', 'bigin_record_id', 'bigin_error', 'bigin_attempts',
  'name', 'mobile', 'email', 'city', 'pincode', 'language', 'existing_affiliate', 'existing_code',
  'instagram', 'other_accounts', 'followers_range', 'avg_views_range', 'niche',
  'open_to', 'partnership_ads', 'fee_per_reel', 'products',
  'heard_from', 'heard_from_person', 'frido_contact', 'frido_contact_name', 'frido_contact_team', 'frido_contact_relationship',
  'consent', 'ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'landing_referrer', 'session_id', 'source', 'payload_json'
];
const EVENT_COLUMNS = [
  'ts', 'event', 'session_id', 'page', 'referring_creator', 'utm_source', 'application_id',
  'video', 'product', 'location', 'question', 'platform', 'audience_size', 'creator_category', 'product_interest', 'method', 'existing_affiliate'
];
const EVENT_NAME = /^[a-z0-9_]{1,40}$/;
const MAX_CELL = 1000;
const MAX_ATTEMPTS = 6;

/* ================================================================= */

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    if (p.kind === 'event') {
      if (!EVENT_NAME.test(p.event || '')) return json_({ ok: false, error: 'Bad event' });
      appendRow_(EVENT_SHEET, EVENT_COLUMNS, p);
      return json_({ ok: true });
    }
    if (p.kind !== 'application') return json_({ ok: false, error: 'Unknown kind' });
    if (p.website) return json_({ ok: true, id: newId_() });           // honeypot: bots get "ok", nothing is stored

    const err = validate_(p);
    if (err) return json_({ ok: false, error: err });

    let row;
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      p.application_id = /^FC-[A-Z0-9]{6}$/.test(p.application_id || '') ? p.application_id : newId_();
      p.status = 'New';
      p.bigin_status = 'Pending';
      p.bigin_attempts = 0;
      p.payload_json = JSON.stringify(p);
      row = appendRow_(APP_SHEET, APP_COLUMNS, p);
    } finally {
      lock.releaseLock();
    }

    try { syncRow_(row); } catch (ex) { /* the retry trigger picks it up */ }
    return json_({ ok: true, id: p.application_id });
  } catch (ex) {
    return json_({ ok: false, error: String(ex) });
  }
}

function doGet() { return json_({ ok: true, service: 'frido-creator-lander', bigin: !!props_().getProperty('ZB_REFRESH') }); }

function validate_(p) {
  if (!p.name || String(p.name).trim().length < 2) return 'Name is required';
  if (!/^\+91[6-9]\d{9}$/.test(p.mobile || '')) return 'Mobile number looks wrong';
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email)) return 'Email looks wrong';
  if (!p.instagram) return 'Instagram handle is required';
  if (p.consent !== true) return 'Consent is required';
  return '';
}

/* ================================================================= */
/* Bigin sync                                                         */

function syncRow_(row) {
  const sh = sheet_(APP_SHEET, APP_COLUMNS);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = n => head.indexOf(n) + 1;
  const get = n => sh.getRange(row, col(n)).getValue();
  const set = (n, v) => sh.getRange(row, col(n)).setValue(v);

  if (get('bigin_status') === 'Synced') return;
  if (!props_().getProperty('ZB_REFRESH')) { set('bigin_status', 'Waiting for connectBigin'); return; }

  const p = JSON.parse(get('payload_json'));
  set('bigin_attempts', (Number(get('bigin_attempts')) || 0) + 1);
  try {
    const contactId = upsertContact_(p);
    set('bigin_contact_id', contactId);
    const recordId = createOrNoteRecord_(p, contactId);
    set('bigin_record_id', recordId);
    set('bigin_status', 'Synced');
    set('bigin_error', '');
  } catch (ex) {
    set('bigin_status', 'Error');
    set('bigin_error', String(ex).slice(0, MAX_CELL));
    throw ex;
  }
}

/* Contact: match on mobile, then email; update if found, create if not. */
function upsertContact_(p) {
  const parts = String(p.name).trim().split(/\s+/);
  const last = parts.length > 1 ? parts.pop() : parts[0];
  const first = parts.length > 1 || (parts.length === 1 && parts[0] !== last) ? parts.join(' ') : '';
  const data = {
    First_Name: first || undefined,
    Last_Name: last,
    Mobile: p.mobile,
    Email: p.email || undefined,
    Mailing_City: p.city || undefined,
    Mailing_Zip: p.pincode || undefined,
    Mailing_Country: 'India',
    Description: 'Creator applicant · Instagram @' + p.instagram
  };
  if (BIGIN.ownerId) data.Owner = { id: BIGIN.ownerId };

  const local = String(p.mobile).replace(/^\+91/, '');   // the team often types numbers without +91
  let id = findContact_('((Mobile:equals:' + p.mobile + ')or(Mobile:equals:' + local + '))');
  if (!id && p.email) id = findContact_('(Email:equals:' + p.email + ')');
  if (id) {
    data.id = id;
    delete data.Description;                     // keep whatever the team already wrote
    delete data.Owner;                           // don't reassign an existing contact
    api_('put', '/Contacts', { data: [clean_(data)] });
    return id;
  }
  const res = api_('post', '/Contacts', { data: [clean_(data)] });
  return res.data[0].details.id;
}

function findContact_(criteria) {
  const res = api_('get', '/Contacts/search?criteria=' + encodeURIComponent(criteria), null, true);
  return res && res.data && res.data.length ? res.data[0].id : '';
}

/* Pipeline record in "Creator Onboarding". If this contact already has one, add the new application as a note instead. */
function createOrNoteRecord_(p, contactId) {
  const cfg = pipelineCfg_();
  p.bigin_contact_id = contactId;
  const note = { Note_Title: 'Creator application ' + p.application_id, Note_Content: noteText_(p) };

  const existing = existingRecord_(contactId, cfg.layoutId) || recordFromSheet_(contactId);
  if (existing) {
    api_('post', '/Pipelines/' + existing + '/Notes', { data: [note] });
    linkContact_(existing, contactId);
    noteOnContact_(contactId, p, existing);
    return existing;
  }

  const base = {
    Deal_Name: '@' + p.instagram + ' – ' + p.name,
    Stage: BIGIN.newStage,
    Sub_Pipeline: cfg.subPipeline,
    Pipeline: { id: cfg.layoutId, name: cfg.layoutName },
    Contact_Name: { id: contactId }
  };
  if (BIGIN.ownerId) base.Owner = { id: BIGIN.ownerId };

  const v = values_(p), extra = {}, dropped = [];
  Object.keys(FIELD_LABELS).forEach(k => {
    const f = cfg.fields[FIELD_LABELS[k]];
    if (!f || v[k] === '' || v[k] == null || (Array.isArray(v[k]) && !v[k].length)) return;
    let val = v[k];
    if (f.options) {
      const list = (Array.isArray(val) ? val : [val]).map(x => {
        const o = option_(k, x, f.options);
        if (!o) dropped.push(FIELD_LABELS[k] + ': ' + x);
        return o;
      }).filter(Boolean);
      if (!list.length) return;
      val = Array.isArray(val) ? list : list[0];
    }
    extra[f.api] = cast_(val, f.type);
  });
  if (dropped.length) note.Note_Content = 'Not in Bigin picklists (kept here only): ' + dropped.join('; ') + '\n\n' + note.Note_Content;

  let id;
  try {
    id = api_('post', '/Pipelines', { data: [Object.assign({}, base, extra)] }).data[0].details.id;
  } catch (ex) {
    // A custom field rejected a value (e.g. picklist mismatch): save the core record; everything is in the note anyway.
    id = api_('post', '/Pipelines', { data: [base] }).data[0].details.id;
    note.Note_Content = 'Some fields were not saved: ' + String(ex).slice(0, 300) + '\n\n' + note.Note_Content;
  }
  api_('post', '/Pipelines/' + id + '/Notes', { data: [note] });
  linkContact_(id, contactId);
  noteOnContact_(contactId, p, id);
  try { api_('post', '/Pipelines/actions/add_tags', { tags: [tag_()], ids: [id] }); } catch (ex) {}
  return id;
}

/* Bigin ignored Contact_Name on insert in the live test but accepts it on update, so set it again here. Never fatal. */
function linkContact_(recordId, contactId) {
  try { api_('put', '/Pipelines', { data: [{ id: recordId, Contact_Name: { id: contactId } }] }); } catch (ex) {}
}

/* The Contact gets a short note pointing at the record, so either side leads to the other. Never fatal. */
function noteOnContact_(contactId, p, recordId) {
  try {
    api_('post', '/Contacts/' + contactId + '/Notes', { data: [{
      Note_Title: 'Creator application ' + p.application_id,
      Note_Content: 'Applied via the Frido Creator lander. Creator Onboarding record: @' + p.instagram + ' – ' + p.name + ' (record ID ' + recordId + ').'
    }] });
  } catch (ex) {}
}

function existingRecord_(contactId, layoutId) {
  try {
    let res;
    try { res = api_('get', '/Contacts/' + contactId + '/Pipelines?fields=Deal_Name,Pipeline,Stage', null, true); }
    catch (ex) { res = api_('get', '/Contacts/' + contactId + '/Deals?fields=Deal_Name,Pipeline,Stage', null, true); } // name used in the Bigin docs
    const hit = (res && res.data || []).find(r => r.Pipeline && String(r.Pipeline.id) === String(layoutId));
    return hit ? hit.id : '';
  } catch (ex) { return ''; }
}

/* Earlier application from the same Contact, found via the Sheet. Works even when the layout has no
   Contact Name field, so Bigin keeps no link between the record and the Contact. */
function recordFromSheet_(contactId) {
  const sh = sheet_(APP_SHEET, APP_COLUMNS);
  const last = sh.getLastRow(); if (last < 2) return '';
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const c = head.indexOf('bigin_contact_id'), r = head.indexOf('bigin_record_id');
  const rows = sh.getRange(2, 1, last - 1, head.length).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][c]) !== String(contactId) || !rows[i][r]) continue;
    try {                                                   // skip records deleted in Bigin since
      const res = api_('get', '/Pipelines/' + rows[i][r], null, true);
      if (res && res.data && res.data[0]) return String(rows[i][r]);
    } catch (ex) {}
  }
  return '';
}

/* The "Creator Lander" tag, created once if missing (add_tags may not auto-create). Cached for 6 hours. */
function tag_() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('zb_tag'); if (c) return JSON.parse(c);
  const list = api_('get', '/settings/tags?module=Pipelines', null, true);
  let t = (list && list.tags || []).find(x => String(x.name).toLowerCase() === BIGIN.tag.toLowerCase());
  if (!t) {
    const res = api_('post', '/settings/tags?module=Pipelines', { tags: [{ name: BIGIN.tag }] });
    t = { name: BIGIN.tag, id: res.tags[0].details.id };
  }
  t = { name: t.name, id: t.id };
  cache.put('zb_tag', JSON.stringify(t), 21600);
  return t;
}

function values_(p) {
  const list = a => Array.isArray(a) ? a : (a ? [a] : []);
  return {
    application_id: p.application_id,
    instagram: '@' + p.instagram,
    instagram_url: 'https://instagram.com/' + p.instagram,
    followers_range: p.followers_range,
    avg_views_range: p.avg_views_range,
    other_accounts_text: list(p.other_accounts).map(a => a.channel + ': ' + a.handle + (a.followers ? ' (' + a.followers + ')' : '')).join('\n'),
    niche: list(p.niche),
    open_to: list(p.open_to).map(x => x === 'Affiliate' ? 'Affiliate money' : x === 'Paid content' ? 'Paid content / UGC' : x),
    partnership_ads: p.partnership_ads,
    fee_per_reel: p.fee_per_reel,
    products: list(p.products),
    language: p.language,
    heard_from: p.heard_from,
    heard_from_person: p.heard_from_person,
    frido_contact: p.frido_contact,
    frido_contact_name: p.frido_contact_name,
    frido_contact_team: p.frido_contact_team,
    ref: p.ref,
    utm_campaign: p.utm_campaign,
    existing_code: p.existing_code
  };
}

function cast_(v, type) {
  if (type === 'multiselectpicklist') return Array.isArray(v) ? v : [v];
  if (Array.isArray(v)) v = v.join(', ');
  if (type === 'currency' || type === 'double' || type === 'integer') return Number(v) || 0;
  if (type === 'boolean') return v === true || v === 'Yes';
  return String(v).slice(0, 2000);
}

function noteText_(p) {
  const v = values_(p), L = [];
  const line = (k, x) => { if (x !== '' && x != null && !(Array.isArray(x) && !x.length)) L.push(k + ': ' + (Array.isArray(x) ? x.join(', ') : x)); };
  line('Application ID', p.application_id);
  line('Name', p.name); line('WhatsApp', p.mobile); line('Email', p.email);   // the layout has no Contact Name, so the record shows these here
  line('City', [p.city, p.pincode].filter(Boolean).join(' ')); line('Contact ID', p.bigin_contact_id);
  line('Submitted', p.submitted_at);
  line('Instagram', v.instagram + ' (' + v.instagram_url + ')');
  line('Followers', p.followers_range); line('Avg reel views', p.avg_views_range);
  line('Other accounts', v.other_accounts_text.replace(/\n/g, ' | '));
  line('Creates about', v.niche); line('Open to', v.open_to);
  line('Partnership ads OK', p.partnership_ads); line('Fee per reel (₹)', p.fee_per_reel);
  line('Products', v.products); line('Language', p.language);
  line('Existing affiliate', p.existing_affiliate ? 'Yes' + (p.existing_code ? ' – code ' + p.existing_code : '') : 'No');
  line('Heard from', p.heard_from + (p.heard_from_person ? ' – ' + p.heard_from_person : ''));
  line('In touch with Frido', p.frido_contact + (p.frido_contact_name ? ' – ' + p.frido_contact_name + (p.frido_contact_team ? ' (' + p.frido_contact_team + ')' : '') + (p.frido_contact_relationship ? ', ' + p.frido_contact_relationship : '') : ''));
  line('Outreach ref', p.ref);
  line('UTM', [p.utm_source, p.utm_medium, p.utm_campaign, p.utm_content].filter(String).join(' / '));
  return L.join('\n');
}

/* Pipeline layout id, sub-pipeline name and custom-field API names, cached for 6 hours. */
function pipelineCfg_(force) {
  const cache = CacheService.getScriptCache();
  if (!force) { const c = cache.get('zb_cfg'); if (c) return JSON.parse(c); }
  const lay = api_('get', '/settings/layouts?module=Pipelines');
  const layout = (lay.layouts || []).find(l => String(l.name).trim().toLowerCase() === BIGIN.pipelineName.toLowerCase());
  if (!layout) throw new Error('Bigin pipeline "' + BIGIN.pipelineName + '" not found');
  let sub = BIGIN.pipelineName + ' Standard';
  const fields = {};
  (layout.sections || []).forEach(s => (s.fields || []).forEach(f => {
    fields[f.field_label] = { api: f.api_name, type: f.data_type };
    if (/picklist/.test(f.data_type)) fields[f.field_label].options = (f.pick_list_values || []).map(x => x.actual_value).filter(x => x && x !== '-None-');
    if (f.api_name === 'Sub_Pipeline') {
      const v = (f.pick_list_values || []).map(x => x.actual_value || x.display_value).filter(x => x && x !== '-None-');
      if (v.length) sub = v[0];
    }
  }));
  const cfg = { layoutId: layout.id, layoutName: layout.name, subPipeline: sub, fields: fields };
  cache.put('zb_cfg', JSON.stringify(cfg), 21600);
  return cfg;
}

/* ================================================================= */
/* Zoho auth + HTTP                                                   */

function connectBigin() {
  const CODE = '';            // from Generate Code (valid 10 minutes)
  const CLIENT_ID = '';
  const CLIENT_SECRET = '';
  if (!CODE || !CLIENT_ID || !CLIENT_SECRET) throw new Error('Fill CODE, CLIENT_ID and CLIENT_SECRET first');
  const r = UrlFetchApp.fetch(BIGIN.accountsUrl + '/oauth/v2/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'authorization_code', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code: CODE }
  });
  const d = JSON.parse(r.getContentText());
  if (!d.refresh_token) throw new Error('Zoho said: ' + r.getContentText());
  props_().setProperties({
    ZB_REFRESH: d.refresh_token, ZB_CLIENT_ID: CLIENT_ID, ZB_CLIENT_SECRET: CLIENT_SECRET,
    ZB_API: (d.api_domain || 'https://www.zohoapis.in') + '/bigin/v2'
  });
  CacheService.getScriptCache().remove('zb_token');
  Logger.log('Bigin connected. Now delete CODE, CLIENT_ID and CLIENT_SECRET from this file and save.');
}

function token_() {
  const cache = CacheService.getScriptCache();
  const t = cache.get('zb_token'); if (t) return t;
  const P = props_();
  const r = UrlFetchApp.fetch(BIGIN.accountsUrl + '/oauth/v2/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'refresh_token', refresh_token: P.getProperty('ZB_REFRESH'), client_id: P.getProperty('ZB_CLIENT_ID'), client_secret: P.getProperty('ZB_CLIENT_SECRET') }
  });
  const d = JSON.parse(r.getContentText());
  if (!d.access_token) throw new Error('Token refresh failed: ' + r.getContentText());
  cache.put('zb_token', d.access_token, 3000);
  return d.access_token;
}

function api_(method, path, body, allowEmpty) {
  const r = UrlFetchApp.fetch(props_().getProperty('ZB_API') + path, {
    method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Zoho-oauthtoken ' + token_() },
    payload: body ? JSON.stringify(body) : undefined
  });
  const code = r.getResponseCode(), text = r.getContentText();
  if (code === 204 && allowEmpty) return null;
  let d; try { d = JSON.parse(text); } catch (e) { d = null; }
  if (code >= 300) throw new Error(method.toUpperCase() + ' ' + path + ' → ' + code + ' ' + text.slice(0, 400));
  if (d && d.data && d.data[0] && d.data[0].status === 'error') throw new Error(method.toUpperCase() + ' ' + path + ' → ' + JSON.stringify(d.data[0]).slice(0, 400));
  return d;
}

/* Bigin option for a form answer: VALUE_MAP first, then a match ignoring case, spaces and dash style. */
function option_(key, answer, options) {
  const a = (VALUE_MAP[key] && VALUE_MAP[key][answer]) || answer;
  const norm = x => String(x).toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, '');
  return options.find(o => norm(o) === norm(a)) || '';
}

/* Every answer the form can send, used by checkBigin() to spot picklist gaps. Keep in sync with apply.html. */
const FORM_OPTIONS = {
  followers_range: ['Under 10k', '10k–50k', '50k–100k', '100k–500k', '500k+'],
  avg_views_range: ['Under 5k', '5k–25k', '25k–100k', '100k+'],
  niche: ['WFH / desk', 'Lifestyle', 'Health / physio', 'Fitness', 'Parenting', 'Travel', 'Tech', 'Fashion', 'Comedy', 'Other'],
  open_to: ['Affiliate money', 'Barter collab', 'Paid content / UGC', 'Partnership ads'],
  partnership_ads: ['Yes', 'Open to discuss', 'No'],
  products: ['Posture & back', 'Sleep & pillows', 'Cushions & seating', 'Hot & cold therapy', 'Feet & walking', 'Workspace & chairs'],
  language: ['English', 'Hindi', 'Hinglish', 'Marathi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Bengali', 'Gujarati', 'Punjabi', 'Other'],
  heard_from: ['Instagram DM from Frido', 'Email from Frido', 'Frido influencer marketing team', 'Frido employee', 'Another creator', 'Frido website', 'Frido store', 'Other'],
  frido_contact: ['Yes', 'No']
};

/* ================================================================= */
/* Admin helpers (run from the editor)                                */

function setup() {
  sheet_(APP_SHEET, APP_COLUMNS);
  sheet_(EVENT_SHEET, EVENT_COLUMNS);
  Logger.log('Setup OK. Tabs: ' + APP_SHEET + ', ' + EVENT_SHEET);
}

function checkBigin() {
  const cfg = pipelineCfg_(true);
  Logger.log('Pipeline "' + BIGIN.pipelineName + '" found: id ' + cfg.layoutId + ', sub-pipeline "' + cfg.subPipeline + '"');
  Object.keys(FIELD_LABELS).forEach(k => {
    const f = cfg.fields[FIELD_LABELS[k]];
    Logger.log((f ? 'OK      ' : 'MISSING ') + FIELD_LABELS[k] + (f ? '  → ' + f.api + ' (' + f.type + ')' : '  (answer still goes in the note)'));
    if (f && f.options && FORM_OPTIONS[k]) {
      const bad = FORM_OPTIONS[k].filter(x => !option_(k, x, f.options));
      if (bad.length) Logger.log('        no Bigin option for: ' + bad.join(', ') + '  (add it in Bigin or in VALUE_MAP)');
    }
  });
}

function installRetryTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'retryBiginSync').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('retryBiginSync').timeBased().everyMinutes(10).create();
  Logger.log('Retry trigger installed (every 10 minutes).');
}

function retryBiginSync() {
  const sh = sheet_(APP_SHEET, APP_COLUMNS);
  const last = sh.getLastRow(); if (last < 2) return;
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  const s = head.indexOf('bigin_status'), a = head.indexOf('bigin_attempts');
  vals.forEach((r, i) => {
    if (r[s] === 'Synced' || (Number(r[a]) || 0) >= MAX_ATTEMPTS) return;
    try { syncRow_(i + 2); } catch (ex) {}
  });
}

/* ================================================================= */

function sheet_(name, cols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(cols); sh.setFrozenRows(1); }
  return sh;
}

function appendRow_(name, cols, p) {
  const sh = sheet_(name, cols);
  const row = cols.map(c => {
    let v = p[c];
    if (v == null) return '';
    if (Array.isArray(v)) v = v.map(x => typeof x === 'object' ? JSON.stringify(x) : x).join(' | ');
    else if (typeof v === 'object') v = JSON.stringify(v);
    v = String(v);
    if (c !== 'payload_json') v = v.slice(0, MAX_CELL);
    return /^[=+\-@]/.test(v) ? "'" + v : v;   // stop formula injection
  });
  sh.appendRow(row);
  return sh.getLastRow();
}

function clean_(o) { Object.keys(o).forEach(k => o[k] === undefined && delete o[k]); return o; }
function newId_() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = 'FC-'; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
function props_() { return PropertiesService.getScriptProperties(); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
