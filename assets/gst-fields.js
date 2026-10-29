/* Toolkit Pro - GST invoice data helpers (pure functions: no DOM, no database). Used by customers, party, settings, invoice pages, assets/pdf.js and tests/pdf.test.js.
   Nothing here changes existing behaviour: it only adds the fields a Tax Invoice needs (Rule 46, CGST Rules 2017) and a safe-save helper that still works before migration 020 is run. */
(function (root) {
'use strict';
/* GST state / UT codes (first two characters of a GSTIN). */
const STATES = [['01','Jammu & Kashmir'],['02','Himachal Pradesh'],['03','Punjab'],['04','Chandigarh'],['05','Uttarakhand'],['06','Haryana'],['07','Delhi'],['08','Rajasthan'],['09','Uttar Pradesh'],['10','Bihar'],['11','Sikkim'],['12','Arunachal Pradesh'],['13','Nagaland'],['14','Manipur'],['15','Mizoram'],['16','Tripura'],['17','Meghalaya'],['18','Assam'],['19','West Bengal'],['20','Jharkhand'],['21','Odisha'],['22','Chhattisgarh'],['23','Madhya Pradesh'],['24','Gujarat'],['26','Dadra & Nagar Haveli and Daman & Diu'],['27','Maharashtra'],['29','Karnataka'],['30','Goa'],['31','Lakshadweep'],['32','Kerala'],['33','Tamil Nadu'],['34','Puducherry'],['35','Andaman & Nicobar Islands'],['36','Telangana'],['37','Andhra Pradesh'],['38','Ladakh'],['97','Other Territory'],['96','Other Country']];
const key = s => String(s == null ? '' : s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const ALIAS = {orissa: '21', pondicherry: '34', uttaranchal: '05', 'jammu and kashmir': '01', 'jammu kashmir': '01', delhi: '07', 'new delhi': '07', 'nct of delhi': '07', 'dadra and nagar haveli': '26', 'daman and diu': '26', 'andaman and nicobar': '35', 'andaman nicobar islands': '35', mh: '27', 'maharashtra state': '27'};
const BYKEY = new Map(STATES.map(([c, n]) => [key(n), c]));
const stateCodeByName = name => { const k = key(name); return BYKEY.get(k) || ALIAS[k] || null; };
const stateName = code => (STATES.find(s => s[0] === code) || [])[1] || '';
/* Canonical spelling of a typed state ("maharashtra" -> "Maharashtra"); unknown text is returned unchanged. */
const canonState = name => { const c = stateCodeByName(name); return c ? stateName(c) : String(name || '').trim(); };
/* State code for a party: from a well-formed GSTIN first, else from the state name. */
const stateCodeOf = (gstin, state) => { const g = String(gstin || '').trim().toUpperCase(); if (/^\d{2}[A-Z0-9]{13}$/.test(g)) return g.slice(0, 2); return stateCodeByName(state); };
const panOf = gstin => { const g = String(gstin || '').trim().toUpperCase(); return /^\d{2}[A-Z]{5}\d{4}[A-Z]/.test(g) ? g.slice(2, 12) : ''; };
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const PIN_RE = /^[1-9]\d{5}$/;

/* Registration type of a customer. */
const GST_TYPES = [['regular', 'Registered (Regular)'], ['composition', 'Registered (Composition)'], ['sez', 'SEZ unit / developer'], ['unregistered', 'Unregistered / Consumer'], ['overseas', 'Overseas / Export']];
const gstTypeOf = p => (p && p.gst_type) || (p && p.gstin ? 'regular' : 'unregistered');
const gstTypeLabel = t => (GST_TYPES.find(x => x[0] === t) || [, ''])[1];

/* Fields that exist only after migration 020. If the database does not have them yet, saves retry without them (see saveCompat). */
const PARTY_NEW = ['gst_type', 'pan', 'address', 'city', 'pincode'];
const SETTINGS_NEW = ['pan', 'city', 'pincode', 'bank_name', 'bank_account', 'bank_ifsc', 'upi_id', 'signatory', 'terms', 'default_hsn'];
const INVOICE_NEW = ['description', 'hsn_sac', 'quantity', 'unit', 'reverse_charge', 'place_of_supply'];

const stateOpts = cur => { const o = [['', 'Select state / UT'], ...STATES.map(s => [s[1], s[1] + ' (' + s[0] + ')'])]; const c = canonState(cur); if (c && !STATES.some(s => s[1] === c)) o.push([c, c]); return o; };
const typeOpts = () => GST_TYPES.map(([v, l]) => [v, l]);

/* Customer / supplier form fields (editBox format). The first five are the original fields, unchanged. */
const partyFields = kind => [
  {n: 'name', l: 'Legal / trade name *', req: 1, full: 1},
  {n: 'gst_type', l: 'GST registration type', opts: typeOpts()},
  {n: 'gstin', l: 'GSTIN (15 characters; blank if unregistered)'},
  {n: 'pan', l: 'PAN'},
  {n: 'phone', l: 'Phone'},
  {n: 'email', l: 'Email', t: 'email'},
  {n: 'address', l: (kind === 'client' ? 'Billing address *' : 'Address'), full: 1},
  {n: 'city', l: 'City / town'},
  {n: 'pincode', l: 'PIN code'},
  {n: 'state', l: 'State / UT * (decides CGST+SGST or IGST)', full: 1, opts: null /* filled by the page with stateOpts(current) */}
];

/* Returns a list of human-readable problems for a party row, used by the form checks and by the PDF pre-flight. */
function partyIssues(p, forInvoice) {
  const out = [], g = String((p && p.gstin) || '').trim().toUpperCase(), t = gstTypeOf(p);
  if (!p || !String(p.name || '').trim()) out.push('Customer name is missing');
  if (forInvoice && !String(p.address || '').trim()) out.push('Customer address is missing');
  if (!stateCodeOf(g, p && p.state)) out.push('Customer state / state code is missing');
  if ((t === 'regular' || t === 'composition' || t === 'sez') && !g) out.push('GSTIN is missing for a registered customer');
  if (p && p.pan && !PAN_RE.test(String(p.pan).trim().toUpperCase())) out.push('PAN format looks wrong');
  if (p && p.pincode && !PIN_RE.test(String(p.pincode).trim())) out.push('PIN code should be 6 digits');
  return out;
}

/* Column-missing errors from Supabase / PostgREST (migration 020 not run yet). */
const colErr = e => !!e && (e.code === 'PGRST204' || e.code === '42703' || /could not find the '.*' column|column .* (does not exist|of relation)/i.test(e.message || ''));
/* run(row) -> Supabase builder result. Tries the full row first; if only the new columns are the problem, retries without them.
   Returns {error, dropped:boolean}. Existing databases keep working exactly as before. */
async function saveCompat(run, row, newKeys) {
  let r = await run(row);
  if (r && r.error && colErr(r.error)) {
    const slim = {}, lost = [];
    for (const k of Object.keys(row)) { if (newKeys.includes(k)) { if (row[k] !== null && row[k] !== undefined && row[k] !== '') lost.push(k); } else slim[k] = row[k]; }
    const r2 = await run(slim); r2.dropped = true; r2.lost = lost; return r2;
  }
  return r;
}

/* ---------- multi-line invoices ----------
   calcLines(lines, taxFn): each line {description, hsn_sac, quantity, unit, rate, discount, gst_rate}.
   taxFn(taxable, rate) -> {cgst, sgst, igst}; the page passes the app's gst() so the intra / inter-state decision and the CGST = SGST rounding are the same as for single-line invoices.
   Tax is worked out per line (each rounded to the paisa) and the invoice carries the sum, so header totals always equal the sum of the lines. */
const p2 = n => Math.round((+n || 0) * 100 + ((+n || 0) < 0 ? -1e-9 : 1e-9));
function calcLines(lines, taxFn) {
  const out = []; let tv = 0, cg = 0, sg = 0, ig = 0; const byRate = new Map();
  (lines || []).forEach((l, i) => {
    const qty = +l.quantity > 0 ? +l.quantity : 1, rate = +l.rate || 0, disc = Math.max(0, +l.discount || 0), gr = +l.gst_rate || 0;
    const gross = Math.round(qty * rate * 100 + 1e-9), dsc = Math.min(gross, p2(disc)), t = (gross - dsc) / 100;
    const g = taxFn(t, gr), c = p2(g.cgst), s2 = p2(g.sgst), ii = p2(g.igst);
    out.push({line_no: i + 1, description: String(l.description || '').trim(), hsn_sac: String(l.hsn_sac || '').trim(), quantity: qty, unit: String(l.unit || '').trim(), rate, discount: dsc / 100, taxable: t, gst_rate: gr, cgst: c / 100, sgst: s2 / 100, igst: ii / 100});
    tv += p2(t); cg += c; sg += s2; ig += ii; byRate.set(gr, (byRate.get(gr) || 0) + p2(t));
  });
  let top = 0, best = -1; byRate.forEach((v, r) => { if (v > best || (v === best && r > top)) { best = v; top = r; } });
  return {items: out, taxable: tv / 100, cgst: cg / 100, sgst: sg / 100, igst: ig / 100, tax: (cg + sg + ig) / 100, amount: (tv + cg + sg + ig) / 100, gst_rate: top, mixed: byRate.size > 1};
}
/* Header columns written for a multi-line invoice (description / HSN of the first line so lists and old screens still show something). */
const headerFromLines = (c) => ({taxable: c.taxable, gst_rate: c.gst_rate, cgst: c.cgst, sgst: c.sgst, igst: c.igst, amount: c.amount, description: (c.items[0] || {}).description + (c.items.length > 1 ? ' (+' + (c.items.length - 1) + ' more)' : ''), hsn_sac: (c.items[0] || {}).hsn_sac || null});
function lineIssues(lines) {
  const out = [];
  (lines || []).forEach((l, i) => { const n = 'Line ' + (i + 1) + ': ';
    if (!String(l.description || '').trim()) out.push(n + 'description is missing');
    if (!(+l.rate > 0)) out.push(n + 'rate must be more than zero');
    if (l.quantity !== '' && l.quantity != null && !(+l.quantity > 0)) out.push(n + 'quantity must be more than zero');
    if (String(l.hsn_sac || '').trim() && !/^\d{4,8}$/.test(String(l.hsn_sac).trim())) out.push(n + 'HSN / SAC must be 4 to 8 digits');
    if ((+l.discount || 0) > (+l.quantity > 0 ? +l.quantity : 1) * (+l.rate || 0)) out.push(n + 'discount is larger than the line value');
  });
  return out;
}
const api = {calcLines, headerFromLines, lineIssues, STATES, stateCodeByName, stateName, canonState, stateCodeOf, panOf, PAN_RE, PIN_RE, GST_TYPES, gstTypeOf, gstTypeLabel, PARTY_NEW, SETTINGS_NEW, INVOICE_NEW, stateOpts, typeOpts, partyFields, partyIssues, colErr, saveCompat};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GF = api;
})(typeof window !== 'undefined' ? window : globalThis);
