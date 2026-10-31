/* Toolkit Pro - practice suite logic (pure functions: no DOM, no database). Used by clients.html, compliance.html and recurring.html.
   Global: PC. Everything here is additive; nothing in the existing pages depends on it.

   IMPORTANT about due dates: the dates below are the usual statutory DEFAULTS. Governments extend and change dates by notification during the year,
   so every generated task keeps an editable due date and the Compliance page says so. Confirm the current date before relying on it. */
(function (root) {
'use strict';

/* ---------- identifiers ---------- */
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/, TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/, GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/* GSTIN check digit (mod-36 over the first 14 characters). A mistyped GSTIN almost always fails this. */
function gstinCheckDigit(g14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) { const v = CH.indexOf(g14[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(v / 36) + (v % 36); }
  return CH[(36 - (sum % 36)) % 36];
}
function gstinProblem(g) {
  g = String(g || '').trim().toUpperCase(); if (!g) return '';
  if (g.length !== 15) return 'A GSTIN has 15 characters.';
  if (!GSTIN_RE.test(g)) return 'This is not in GSTIN format (2 digits, PAN, entity number, Z, check character).';
  const st = +g.slice(0, 2); if (!((st >= 1 && st <= 38) || st === 97 || st === 99)) return 'The first two digits are not a valid state code.';
  if (gstinCheckDigit(g.slice(0, 14)) !== g[14]) return 'The last character does not match: one of the other characters is probably mistyped.';
  return '';
}
const panProblem = p => { p = String(p || '').trim().toUpperCase(); return !p ? '' : PAN_RE.test(p) ? '' : 'A PAN is 5 letters, 4 digits and 1 letter (ABCDE1234F).'; };
const tanProblem = t => { t = String(t || '').trim().toUpperCase(); return !t ? '' : TAN_RE.test(t) ? '' : 'A TAN is 4 letters, 5 digits and 1 letter (ABCD12345E).'; };
const PAN_KIND = {P: 'individual', C: 'company', F: 'firm', H: 'huf', A: 'aop_boi', B: 'aop_boi', T: 'trust', L: 'other', J: 'other', G: 'other'};
const kindFromPan = p => PAN_KIND[String(p || '').trim().toUpperCase()[3]] || '';
const CONSTITUTIONS = [['individual', 'Individual / Proprietor'], ['huf', 'HUF'], ['firm', 'Partnership firm'], ['llp', 'LLP'], ['company', 'Company'], ['trust', 'Trust / Society'], ['aop_boi', 'AOP / BOI'], ['other', 'Other']];

/* ---------- services ---------- */
const SERVICES = [
  {code: 'gstr1', label: 'GSTR-1', short: 'GSTR-1'}, {code: 'gstr3b', label: 'GSTR-3B', short: 'GSTR-3B'}, {code: 'gstr9', label: 'GSTR-9 annual return', short: 'GSTR-9'},
  {code: 'tds_pay', label: 'TDS / TCS payment', short: 'TDS pay'}, {code: 'tds_26q', label: 'TDS return 26Q (non-salary)', short: '26Q'}, {code: 'tds_24q', label: 'TDS return 24Q (salary)', short: '24Q'},
  {code: 'adv_tax', label: 'Advance tax', short: 'Adv tax'}, {code: 'itr', label: 'Income-tax return', short: 'ITR'}, {code: 'tax_audit', label: 'Tax audit (3CA/3CB-3CD) and ITR (audit case)', short: 'Tax audit'},
  {code: 'roc', label: 'ROC annual filings (AOC-4, MGT-7)', short: 'ROC'}];
const SVC = Object.fromEntries(SERVICES.map(s => [s.code, s]));
const STATUSES = [['pending', 'Not started'], ['in_progress', 'In progress'], ['docs_awaited', 'Waiting for client'], ['ready', 'Ready to file'], ['filed', 'Filed'], ['not_applicable', 'Not applicable']];
const STATUS_LABEL = Object.fromEntries(STATUSES);

/* ---------- dates (all 'YYYY-MM-DD', no time zones) ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? {y: +m[1], m: +m[2], d: +m[3]} : null; };
const toUTC = s => { const p = parse(s); return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN; };
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
const addDays = (s, n) => { const t = new Date(toUTC(s) + n * 864e5); return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
/* Add whole months and keep the intended day of month where the month is long enough ("anchor"), otherwise use the month's last day: 31 Jan -> 28/29 Feb -> 31 Mar. */
function addMonths(s, n, anchor) {
  const p = parse(s); if (!p) return s; const a = anchor || p.d;
  let m0 = p.y * 12 + (p.m - 1) + n, y = Math.floor(m0 / 12), m = (m0 % 12) + 1;
  return ymd(y, m, Math.min(a, daysIn(y, m)));
}
const fyStartYear = s => { const p = parse(s); return p ? (p.m >= 4 ? p.y : p.y - 1) : null; };
const fyLabel = y => y + '-' + String(y + 1).slice(2);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (y, m) => MONTHS[m - 1] + ' ' + y;

/* ---------- compliance task rules ---------- */
/* States whose QRMP GSTR-3B due date is the 22nd (the others use the 24th). Default only: confirm against the current notification. */
const QRMP_22 = new Set(['22', '23', '24', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38']);
const monthsOfFY = fy => Array.from({length: 12}, (_, i) => { const m0 = 3 + i; return {y: fy + Math.floor(m0 / 12), m: (m0 % 12) + 1}; });
const nextMonth = ({y, m}) => m === 12 ? {y: y + 1, m: 1} : {y, m: m + 1};
function qrmpQuarters(fy) { return [[4, 6, 'Q1'], [7, 9, 'Q2'], [10, 12, 'Q3'], [1, 3, 'Q4']].map(([a, b, q]) => ({q, end: {y: b <= 3 ? fy + 1 : fy, m: b}, label: q + ' ' + fyLabel(fy)})); }

/* Candidate tasks of one client for one financial year (starting 1 April of fy). Returns [{service, period, title, due_date}]. */
function candidates(client, fy) {
  const sv = new Set((client.services || [])), out = [], q = client.gst_frequency === 'qrmp', stc = String(client.state_code || '').slice(0, 2);
  const add = (service, period, title, due_date) => out.push({service, period, title, due_date});
  if (sv.has('gstr1') || sv.has('gstr3b')) {
    if (!q) for (const mo of monthsOfFY(fy)) {
      const n = nextMonth(mo), lab = monthName(mo.y, mo.m);
      if (sv.has('gstr1')) add('gstr1', mo.y + '-' + pad(mo.m), 'GSTR-1 for ' + lab, ymd(n.y, n.m, 11));
      if (sv.has('gstr3b')) add('gstr3b', mo.y + '-' + pad(mo.m), 'GSTR-3B for ' + lab, ymd(n.y, n.m, 20));
    } else {
      for (const qt of qrmpQuarters(fy)) {
        const n = nextMonth(qt.end);
        if (sv.has('gstr1')) add('gstr1', fy + '-' + qt.q, 'GSTR-1 (quarterly) for ' + qt.label, ymd(n.y, n.m, 13));
        if (sv.has('gstr3b')) add('gstr3b', fy + '-' + qt.q, 'GSTR-3B (quarterly) for ' + qt.label, ymd(n.y, n.m, QRMP_22.has(stc) ? 22 : 24));
      }
    }
  }
  if (sv.has('gstr9')) add('gstr9', 'FY' + fy, 'GSTR-9 for FY ' + fyLabel(fy), ymd(fy + 1, 12, 31));
  if (sv.has('tds_pay')) for (const mo of monthsOfFY(fy)) {
    const n = nextMonth(mo); add('tds_pay', mo.y + '-' + pad(mo.m), 'TDS/TCS payment for ' + monthName(mo.y, mo.m), mo.m === 3 ? ymd(n.y, 4, 30) : ymd(n.y, n.m, 7));
  }
  for (const [code, name] of [['tds_26q', '26Q'], ['tds_24q', '24Q']]) if (sv.has(code)) {
    add(code, fy + '-Q1', 'TDS return ' + name + ' Q1 ' + fyLabel(fy), ymd(fy, 7, 31)); add(code, fy + '-Q2', 'TDS return ' + name + ' Q2 ' + fyLabel(fy), ymd(fy, 10, 31));
    add(code, fy + '-Q3', 'TDS return ' + name + ' Q3 ' + fyLabel(fy), ymd(fy + 1, 1, 31)); add(code, fy + '-Q4', 'TDS return ' + name + ' Q4 ' + fyLabel(fy), ymd(fy + 1, 5, 31));
  }
  if (sv.has('adv_tax')) for (const [m, pc, y] of [[6, 15, fy], [9, 45, fy], [12, 75, fy], [3, 100, fy + 1]]) add('adv_tax', fy + '-' + pc, 'Advance tax instalment (' + pc + '%) FY ' + fyLabel(fy), ymd(y, m, 15));
  /* returns for the financial year that just ended fall due in the next financial year */
  if (sv.has('itr')) add('itr', 'FY' + fy, 'Income-tax return for FY ' + fyLabel(fy), ymd(fy + 1, 7, 31));
  if (sv.has('tax_audit')) { add('tax_audit', 'FY' + fy, 'Tax audit report for FY ' + fyLabel(fy), ymd(fy + 1, 9, 30)); add('tax_audit', 'FY' + fy + '-ITR', 'Income-tax return (audit case) for FY ' + fyLabel(fy), ymd(fy + 1, 10, 31)); }
  if (sv.has('roc')) { add('roc', 'FY' + fy + '-AOC4', 'AOC-4 for FY ' + fyLabel(fy), ymd(fy + 1, 10, 30)); add('roc', 'FY' + fy + '-MGT7', 'MGT-7 for FY ' + fyLabel(fy), ymd(fy + 1, 11, 29)); }
  return out;
}
/* All tasks that fall due between two dates (inclusive) for the given clients. Skips closed / on-hold clients and tasks that already exist
   (same client + service + period). `existing` = [{party_id, service, period}]. */
function generate(clients, from, to, existing) {
  const have = new Set((existing || []).map(t => (t.party_id || '') + '|' + t.service + '|' + t.period)), out = [];
  const y0 = fyStartYear(from) - 1, y1 = fyStartYear(to);
  for (const c of clients) {
    if (c.status && c.status !== 'active') continue;
    for (let fy = y0; fy <= y1; fy++) for (const t of candidates(c, fy)) {
      if (t.due_date < from || t.due_date > to) continue;
      const key = (c.party_id || '') + '|' + t.service + '|' + t.period; if (have.has(key)) continue; have.add(key);
      out.push({party_id: c.party_id, assignee: c.assignee || null, ...t});
    }
  }
  return out.sort((a, b) => a.due_date.localeCompare(b.due_date) || String(a.party_id).localeCompare(String(b.party_id)));
}
const isOpen = t => t.status !== 'filed' && t.status !== 'not_applicable';
const isOverdue = (t, today) => isOpen(t) && t.due_date < today;
/* 'overdue' | 'due_soon' (within 7 days) | 'open' | 'filed' | 'na' */
function urgency(t, today) {
  if (t.status === 'filed') return 'filed'; if (t.status === 'not_applicable') return 'na';
  if (t.due_date < today) return 'overdue'; return daysBetween(today, t.due_date) <= 7 ? 'due_soon' : 'open';
}
function summarize(tasks, today) {
  const o = {overdue: 0, due_soon: 0, open: 0, filed: 0, na: 0, filedLate: 0, thisMonth: 0};
  const mo = String(today).slice(0, 7);
  for (const t of tasks) { const u = urgency(t, today); o[u]++; if (u === 'filed' && t.filed_on && t.filed_on > t.due_date) o.filedLate++; if (isOpen(t) && String(t.due_date).slice(0, 7) === mo) o.thisMonth++; }
  return o;
}

/* ---------- recurring fee invoices ---------- */
const FREQ = {monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12};
const FREQ_LABEL = {monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly'};
const nextRunDate = (date, freq, anchor) => addMonths(date, FREQ[freq] || 1, anchor);
/* Invoice dates that are due on or before `upto`, oldest first (catches up missed periods; at most `cap`). */
function dueRuns(rec, upto, cap) {
  if (!rec || rec.active === false || !FREQ[rec.frequency]) return [];
  const out = [], max = cap || 12, anchor = rec.anchor_day || (parse(rec.next_date) || {}).d;
  let d = rec.next_date;
  while (d && d <= upto && (!rec.end_date || d <= rec.end_date) && out.length < max) { out.push(d); d = nextRunDate(d, rec.frequency, anchor); }
  return out;
}
/* "Retainer fee for {MONTH}" -> "Retainer fee for September 2026"; {PERIOD} gives the period the invoice covers (month, quarter, ...). */
function renderText(text, date, freq) {
  const p = parse(date); if (!p) return String(text || '');
  const n = FREQ[freq] || 1, last = addMonths(date, n - 1, 1), q = parse(last);
  const period = n === 1 ? monthName(p.y, p.m) : monthName(p.y, p.m) + ' to ' + monthName(q.y, q.m);
  return String(text || '').replace(/\{MONTH\}/gi, monthName(p.y, p.m)).replace(/\{PERIOD\}/gi, period).replace(/\{FY\}/gi, fyLabel(fyStartYear(date)));
}
function recurringIssues(r) {
  const o = [];
  if (!r.party_id) o.push('Choose the client.');
  if (!String(r.description || '').trim()) o.push('Write the description of the service.');
  if (!(+r.amount > 0)) o.push('The fee must be more than zero.');
  if (!(+r.gst_rate >= 0)) o.push('Choose the GST rate.');
  if (!FREQ[r.frequency]) o.push('Choose how often to invoice.');
  if (!parse(r.next_date)) o.push('Choose the first invoice date.');
  if (r.end_date && parse(r.end_date) && r.end_date < r.next_date) o.push('The end date is before the first invoice date.');
  if (r.hsn_sac && !/^\d{4,8}$/.test(String(r.hsn_sac).trim())) o.push('HSN / SAC must be 4 to 8 digits.');
  return o;
}

/* ---------- client profile completeness ---------- */
function clientIssues(c) {
  const o = [], add = (k, m) => o.push({field: k, message: m});
  const g = gstinProblem(c.gstin); if (g) add('gstin', g);
  const p = panProblem(c.pan); if (p) add('pan', p);
  const t = tanProblem(c.tan); if (t) add('tan', t);
  if (c.pan && c.gstin && !gstinProblem(c.gstin) && String(c.gstin).slice(2, 12).toUpperCase() !== String(c.pan).trim().toUpperCase()) add('pan', 'The PAN does not match the PAN inside the GSTIN.');
  if (c.contact_email && !/^\S+@\S+\.\S+$/.test(c.contact_email)) add('contact_email', 'Check the email address.');
  if (c.fee_amount != null && c.fee_amount !== '' && !(+c.fee_amount >= 0)) add('fee_amount', 'The fee cannot be negative.');
  if (c.fee_amount > 0 && !c.fee_cycle) add('fee_cycle', 'Choose how often the fee is billed.');
  if ((c.services || []).some(s => /^(tds_)/.test(s)) && !c.tan) add('tan', 'A TAN is needed for TDS services.');
  if ((c.services || []).some(s => /^gstr/.test(s)) && !c.gstin) add('gstin', 'A GSTIN is needed for GST services.');
  return o;
}
/* Things worth fixing but not blocking: shown as a small "missing" note in the client list. */
function clientGaps(c) {
  const o = []; if (!c.pan && !(c.gstin && !gstinProblem(c.gstin))) o.push('PAN'); if (!(c.services || []).length) o.push('services');
  if ((c.services || []).some(s => /^tds_/.test(s)) && !c.tan) o.push('TAN'); if (!c.contact_phone && !c.contact_email && !c.phone && !c.email) o.push('contact');
  return o;
}
const effectivePan = c => String(c.pan || (c.gstin && !gstinProblem(c.gstin) ? String(c.gstin).slice(2, 12) : '') || '').toUpperCase();

const api = {PAN_RE, TAN_RE, GSTIN_RE, gstinCheckDigit, gstinProblem, panProblem, tanProblem, kindFromPan, CONSTITUTIONS, SERVICES, SVC, STATUSES, STATUS_LABEL,
  ymd, parse, daysBetween, addDays, addMonths, daysIn, fyStartYear, fyLabel, monthName, MONTHS, candidates, generate, isOpen, isOverdue, urgency, summarize,
  FREQ, FREQ_LABEL, nextRunDate, dueRuns, renderText, recurringIssues, clientIssues, clientGaps, effectivePan};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PC = api;
})(typeof window !== 'undefined' ? window : globalThis);
