/* Toolkit Pro - document numbering series (pure functions: no DOM, no database). Used by Settings, the invoice / bill form, credit & debit notes,
   Banking, Transactions and the importer; tests/series.test.js checks it.
   A series is {prefix, digits, start, suffix}. The prefix may contain {FY} (2026-27) or {FYS} (26-27), which come from the DOCUMENT DATE, so a series
   such as "INV/{FYS}/" starts again at 1 every financial year without any counter being stored.
   The next number is: the highest number already used in the same series + 1, but never below "start". Nothing is stored per document, so two
   screens can never disagree and existing documents are never renumbered. */
(function (root) {
'use strict';
const KINDS = ['sale', 'purchase', 'expense', 'credit', 'debit'];
const LABELS = {sale: 'Sales invoices', purchase: 'Purchase bills', expense: 'Expense vouchers', credit: 'Credit notes', debit: 'Debit notes'};
/* Defaults reproduce the numbers the app has always produced (INV-0001, BILL-0001, CN-0001, DN-0001). */
const DEFAULTS = {
  sale: {prefix: 'INV-', digits: 4, start: 1, suffix: ''},
  purchase: {prefix: 'BILL-', digits: 4, start: 1, suffix: ''},
  expense: {prefix: 'EXP-', digits: 4, start: 1, suffix: ''},
  credit: {prefix: 'CN-', digits: 4, start: 1, suffix: ''},
  debit: {prefix: 'DN-', digits: 4, start: 1, suffix: ''}
};
/* Documents you issue under GST (tax invoice, credit note, debit note): Rule 46 / 53 allow at most 16 characters, only letters, digits, "-" and "/". */
const GST_DOC = {sale: 1, credit: 1, debit: 1};
const MAXLEN = 16;

const pad2 = n => String(n).padStart(2, '0');
/* Financial year (1 April to 31 March) of a yyyy-mm-dd date. */
function fyOf(date) {
  const m = /^(\d{4})-(\d{2})/.exec(String(date || ''));
  const d = new Date(), y = m ? +m[1] : d.getFullYear(), mo = m ? +m[2] : d.getMonth() + 1, s = mo >= 4 ? y : y - 1;
  return {full: s + '-' + pad2((s + 1) % 100), short: pad2(s % 100) + '-' + pad2((s + 1) % 100), start: s};
}
const clean = (k, o) => {
  const d = DEFAULTS[k] || DEFAULTS.sale, s = Object.assign({}, d, o || {});
  s.prefix = String(s.prefix == null ? d.prefix : s.prefix).trim();
  s.suffix = String(s.suffix == null ? '' : s.suffix).trim();
  s.digits = Math.min(9, Math.max(1, Math.floor(+s.digits) || d.digits));
  s.start = Math.max(1, Math.floor(+s.start) || 1);
  return s;
};
/* The series for one kind from the settings row (S.doc_series is null until the owner saves something). */
const getSeries = (S, k) => clean(k, S && S.doc_series && typeof S.doc_series === 'object' ? S.doc_series[k] : null);
const tokens = (t, date) => { const f = fyOf(date); return String(t).replace(/\{FYS\}/gi, f.short).replace(/\{FY\}/gi, f.full); };
const prefixFor = (s, date) => tokens(s.prefix, date);
const suffixFor = (s, date) => tokens(s.suffix, date);
const format = (s, n, date) => prefixFor(s, date) + String(n).padStart(s.digits, '0') + suffixFor(s, date);

/* Highest number already used by this series for this date's prefix/suffix (0 when none). Comparison ignores case and surrounding spaces. */
function highest(s, existing, date) {
  const p = prefixFor(s, date).toLowerCase(), x = suffixFor(s, date).toLowerCase();
  let hi = 0;
  for (const raw of existing || []) {
    const v = String(raw == null ? '' : raw).trim().toLowerCase();
    if (v.length <= p.length + x.length || !v.startsWith(p) || (x && !v.endsWith(x))) continue;
    const mid = v.slice(p.length, v.length - x.length);
    if (/^\d{1,9}$/.test(mid)) hi = Math.max(hi, +mid);
  }
  return hi;
}
/* {no, n}: the next free number. `reserved` lets the importer hand out several numbers in one go without clashes. */
function nextNumber(s, existing, date, reserved) {
  const all = reserved && reserved.length ? (existing || []).concat(reserved) : existing;
  const n = Math.max(s.start, highest(s, all, date) + 1);
  return {n, no: format(s, n, date)};
}
/* Problems with a series definition; `hard` ones must stop a save. */
function issues(k, s) {
  const out = [], sample = format(s, Math.max(s.start, 1), today());
  if (/\{(?!FYS\}|FY\})[^}]*\}/i.test(s.prefix + s.suffix)) out.push({hard: true, msg: 'Only {FY} and {FYS} can be used inside braces.'});
  if (/[\u0000-\u001f]/.test(s.prefix + s.suffix)) out.push({hard: true, msg: 'Control characters are not allowed.'});
  if (!s.prefix && !s.suffix) out.push({hard: false, msg: 'With no prefix or suffix the numbers are bare digits, which can clash with other series.'});
  if (GST_DOC[k]) {
    if (!/^[A-Za-z0-9\/-]*$/.test(sample)) out.push({hard: true, msg: 'GST allows only letters, digits, "-" and "/" in a document number (Rule 46 / Rule 53).'});
    if (sample.length > MAXLEN) out.push({hard: true, msg: 'GST allows at most ' + MAXLEN + ' characters in a document number; this one is ' + sample.length + ' (' + sample + '). Shorten the prefix or use {FYS}.'});
  } else if (sample.length > 30) out.push({hard: true, msg: 'Keep the number under 30 characters.'});
  return out;
}
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
/* Value to store: only the series that differ from the default are kept, so an untouched Settings page stores nothing. */
function toStore(map) {
  const o = {};
  for (const k of KINDS) { const s = clean(k, map[k]), d = DEFAULTS[k]; if (s.prefix !== d.prefix || s.digits !== d.digits || s.start !== d.start || s.suffix !== d.suffix) o[k] = s; }
  return o;
}
const api = {KINDS, LABELS, DEFAULTS, GST_DOC, MAXLEN, fyOf, clean, getSeries, prefixFor, suffixFor, format, highest, nextNumber, issues, toStore};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DS = api;
})(typeof window !== 'undefined' ? window : globalThis);
