/* Toolkit Pro - Import / Export engine (pure functions: no DOM, no Supabase client). Used by import-export.html; tests/import.test.js checks it.
   Flow: read file -> table (rows) -> map columns -> build + validate (this file) -> user fixes ledgers / spelling -> post (post* functions, database injected).
   Everything between "read file" and "post" is recomputed from scratch every time the user changes a mapping or a decision, so the check screen always
   shows the truth and nothing is written before the final confirmation. */
(function (root) {
'use strict';

/* ================================================================== text helpers ==== */
const clean = v => String(v == null ? '' : v).replace(/^﻿/, '').trim();
const norm = s => clean(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const LEGAL = /\b(m\s?s|messrs|pvt|private|ltd|limited|llp|inc|co|company|corp|corporation|the)\b/g;
/* Name used to compare parties: ignores case, punctuation, "M/s", "Pvt. Ltd." and similar. */
const normName = s => norm(s).replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();

function lev(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const bigrams = s => { const t = ' ' + s + ' ', m = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
function dice(a, b) {
  if (!a || !b) return 0; if (a === b) return 1;
  const x = bigrams(a), y = bigrams(b); let hit = 0, tx = 0, ty = 0;
  x.forEach((c, g) => { tx += c; if (y.has(g)) hit += Math.min(c, y.get(g)); }); y.forEach(c => ty += c);
  return 2 * hit / (tx + ty);
}
/* 0..1 closeness of two names (after normName). */
function similarity(a, b) {
  const x = normName(a), y = normName(b); if (!x || !y) return 0; if (x === y) return 1;
  const d = dice(x, y), l = 1 - lev(x, y) / Math.max(x.length, y.length);
  const tx = x.split(' '), ty = y.split(' '), tokenHit = tx.length > 1 && ty.length > 1 && (tx.every(t => ty.includes(t)) || ty.every(t => tx.includes(t))) ? 0.85 : 0;
  return Math.max(d, l, tokenHit);
}
/* Closest existing names to a typed one, best first. Only plausible matches (>= 0.6) are returned. */
function suggest(name, list, getName, limit) {
  const out = [];
  for (const it of list || []) { const s = similarity(name, getName ? getName(it) : it); if (s >= 0.6) out.push({item: it, score: s}); }
  return out.sort((a, b) => b.score - a.score).slice(0, limit || 3);
}

/* ================================================================== CSV ==== */
/* Decode bytes: UTF-8 (with or without BOM), UTF-16 with BOM, else Windows-1252 (what Excel's "CSV (Comma delimited)" writes in India). */
function decodeText(u8) {
  if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try { return new TextDecoder('utf-8', {fatal: true}).decode(u8).replace(/^﻿/, ''); }
  catch (_) { return new TextDecoder('windows-1252').decode(u8); }
}
function sniffDelimiter(text) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || '', score = {',': 0, ';': 0, '\t': 0, '|': 0};
  let q = false; for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch in score) score[ch]++; }
  return Object.entries(score).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(score).sort((a, b) => b[1] - a[1])[0][0] : ',';
}
/* RFC 4180 reader: quoted fields, doubled quotes, embedded newlines, CRLF/LF/CR. Returns [{n: line number of the record start, cells: []}], blank lines skipped. */
function parseCSV(text, delim) {
  text = String(text).replace(/^﻿/, ''); delim = delim || sniffDelimiter(text);
  const rows = []; let cells = [], cur = '', q = false, line = 1, start = 1, any = false;
  const endCell = () => { cells.push(cur); cur = ''; };
  const endRow = () => { endCell(); if (cells.some(c => c.trim() !== '')) rows.push({n: start, cells}); cells = []; any = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else { if (ch === '\n') line++; cur += ch; }
    } else if (ch === '"' && cur === '') { q = true; any = true; }
    else if (ch === delim) { endCell(); any = true; }
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i + 1] === '\n') i++; endRow(); line++; start = line; }
    else { cur += ch; any = true; }
  }
  if (cur !== '' || cells.length || any) endRow();
  return rows;
}
/* Spreadsheet programs run text that starts with = + - @ as a formula. Exported TEXT is prefixed with an apostrophe in that case; numbers are untouched. */
const safeCell = v => {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  return /^[=+@\t\r]/.test(s) || /^-(?![\d.]|\s*$)/.test(s) ? "'" + s : s;
};
const unsafeCell = s => /^'[=+@-]/.test(s) ? s.slice(1) : s;
const csvCell = v => { const s = safeCell(v); return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/* ================================================================== XLSX (first sheet, read only, no library) ==== */
async function inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files. Save the sheet as CSV and upload that.');
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function zipIndex(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('This file is not a valid .xlsx workbook.');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = new Map(), td = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('This .xlsx file is damaged.');
    const flag = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    out.set(td.decode(u8.subarray(p + 46, p + 46 + nl)), {flag, method, csize, off}); p += 46 + nl + xl + cl;
  }
  return {dv, out};
}
async function zipRead(u8, idx, name) {
  const en = idx.out.get(name); if (!en) return null;
  if (en.flag & 1) throw new Error('Password-protected workbooks cannot be read. Remove the password or save as CSV.');
  const dv = idx.dv, nl = dv.getUint16(en.off + 26, true), xl = dv.getUint16(en.off + 28, true), s = en.off + 30 + nl + xl, data = u8.subarray(s, s + en.csize);
  if (en.method === 0) return new TextDecoder().decode(data);
  if (en.method === 8) return new TextDecoder().decode(await inflateRaw(data));
  throw new Error('Unsupported compression in this .xlsx file.');
}
const xmlDec = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (s, n) => { const m = new RegExp('\\b' + n + '="([^"]*)"').exec(s); return m ? xmlDec(m[1]) : null; };
const textOf = x => { x = x.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''); let o = ''; x.replace(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g, (_, t) => { o += xmlDec(t || ''); return ''; }); return o; };
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateCode = c => { c = String(c).replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''); return /[dmyhs]/i.test(c) && !/^general$/i.test(c.trim()); };
const serialToISO = n => { const d = new Date(Math.round((Math.floor(n) - 25569) * 864e5)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };
const colIdx = ref => { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
/* sheet: optional sheet name (default: the first sheet). */
async function readXlsx(buf, sheet) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), idx = zipIndex(u8);
  const wb = await zipRead(u8, idx, 'xl/workbook.xml'); if (!wb) throw new Error('This file does not look like an Excel workbook.');
  let sheetPath = null; const tags = wb.match(/<sheet\b[^>]*>/g) || [], pick = (sheet != null && tags.find(t => (attr(t, 'name') || '') === sheet)) || tags[0], sm = pick ? [pick] : null;
  if (sm) { const rid = attr(sm[0], 'r:id'), rels = await zipRead(u8, idx, 'xl/_rels/workbook.xml.rels'); if (rid && rels) { const r = new RegExp('<Relationship\\b[^>]*\\bId="' + rid + '"[^>]*>').exec(rels); const t = r && attr(r[0], 'Target'); if (t) sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t; } }
  if (!sheetPath || !idx.out.has(sheetPath)) sheetPath = [...idx.out.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetPath) throw new Error('No worksheet found in this workbook.');
  const ss = []; const sx = await zipRead(u8, idx, 'xl/sharedStrings.xml');
  if (sx) sx.replace(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g, (_, b) => { ss.push(textOf(b || '')); return ''; });
  const dateXf = []; const st = await zipRead(u8, idx, 'xl/styles.xml');
  if (st) {
    const custom = new Map(); st.replace(/<numFmt\b[^>]*>/g, t => { custom.set(+attr(t, 'numFmtId'), attr(t, 'formatCode') || ''); return ''; });
    const cx = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st);
    if (cx) cx[1].replace(/<xf\b[^>]*>/g, t => { const id = +attr(t, 'numFmtId'); dateXf.push(BUILTIN_DATE.has(id) || (custom.has(id) && isDateCode(custom.get(id)))); return ''; });
  }
  const xml = await zipRead(u8, idx, sheetPath), rows = new Map();
  xml.replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (_, ra, body) => {
    const rn = +attr(ra, 'r') || rows.size + 1, cells = []; let seq = 0;
    (body || '').replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (__, ca, cb) => {
      const ref = attr(ca, 'r'), ci = ref ? colIdx(ref) : seq, t = attr(ca, 't'), s = attr(ca, 's'); seq = ci + 1;
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cb || ''), raw = v ? xmlDec(v[1]) : '';
      let val = '';
      if (t === 's') val = ss[+raw] || ''; else if (t === 'inlineStr') val = textOf(cb || ''); else if (t === 'str') val = raw;
      else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE'; else if (t === 'e') val = '';
      else if (raw !== '' && s != null && dateXf[+s] && isFinite(+raw)) val = serialToISO(+raw); else val = raw;
      if (ci < 200) cells[ci] = val; return '';
    });
    rows.set(rn, cells); return '';
  });
  const out = [];
  [...rows.keys()].sort((a, b) => a - b).forEach(rn => { const c = rows.get(rn), full = Array.from({length: c.length}, (_, i) => c[i] == null ? '' : String(c[i])); if (full.some(x => x.trim() !== '')) out.push({n: rn, cells: full}); });
  return out;
}

/* Names of the sheets in a workbook, in order. */
async function xlsxSheets(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), idx = zipIndex(u8), wb = await zipRead(u8, idx, 'xl/workbook.xml');
  return wb ? (wb.match(/<sheet\b[^>]*>/g) || []).map(t => (attr(t, 'name') || '')) : [];
}

/* ================================================================== value parsers ==== */
const MON = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12};
const realDate = (y, m, d) => { if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null; const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') : null; };
const yr = s => { const n = +s; return s.length <= 2 ? (n >= 70 ? 1900 + n : 2000 + n) : n; };
/* -> 'yyyy-mm-dd' or null. dayFirst decides 03/04/2026 (true: 3 April, false: 4 March). Accepts Excel serial numbers and 2026-04-03T10:00:00. */
function parseDate(v, dayFirst) {
  const s = unsafeCell(clean(v)); if (!s) return null; let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s))) return realDate(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})(?:[T\s,].*)?$/.exec(s))) { const a = +m[1], b = +m[2], y = yr(m[3]); return dayFirst === false ? realDate(y, a, b) : realDate(y, b, a); }
  if ((m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/., ]+(\d{2}|\d{4})(?:[T\s,].*)?$/.exec(s)) && MON[m[2].toLowerCase()]) return realDate(yr(m[3]), MON[m[2].toLowerCase()], +m[1]);
  if ((m = /^([A-Za-z]{3,9})[-/. ]+(\d{1,2})(?:st|nd|rd|th)?[,\s-]+(\d{2}|\d{4})$/.exec(s)) && MON[m[1].toLowerCase()]) return realDate(yr(m[3]), MON[m[1].toLowerCase()], +m[2]);
  if (/^\d{5}(\.\d+)?$/.test(s) && +s >= 32874 && +s <= 73415) return serialToISO(+s);
  return null;
}
/* -> number, null (blank) or NaN (not a number). Handles ₹ / Rs / INR, 1,23,456.78, (500) as negative, trailing minus, Dr/Cr suffix is NOT interpreted. */
function parseAmount(v) {
  let s = unsafeCell(clean(v)); if (!s || s === '-') return null;
  let neg = false; if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, '').replace(/\s*(₹|rs\.?|inr)$/i, '');
  if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); } if (/^-/.test(s)) { neg = !neg; s = s.slice(1); } if (/^\+/.test(s)) s = s.slice(1);
  if (!/^\d[\d,]*(\.\d+)?$|^\.\d+$/.test(s.trim())) return NaN;
  const n = parseFloat(s.replace(/,/g, '')); return neg ? -n : n;
}
const parseRate = v => { const s = clean(v).replace(/%$/, '').trim(); return s === '' ? null : parseAmount(s); };
const parseBool = v => /^(y|yes|true|1|x|✓|✔)$/i.test(clean(v));
const money = n => Math.round((+n || 0) * 100 + (n < 0 ? -1e-9 : 1e-9));

/* ================================================================== field definitions ==== */
const F = (k, label, req, al, hint) => ({k, label, req: !!req, al: [label].concat(al || []).map(norm), hint: hint || ''});
const FIELDS = {
  sales: [
    F('number', 'Invoice No', 1, ['invoice number', 'inv no', 'inv number', 'invoice', 'document no', 'voucher no', 'number'], 'Rows with the same number become ONE invoice with several lines.'),
    F('date', 'Invoice Date', 1, ['date', 'inv date', 'document date', 'voucher date']),
    F('due_date', 'Due Date', 0, ['due', 'payment due', 'due on'], 'Blank = invoice date + 15 days, as on the invoice form.'),
    F('party', 'Customer Name', 1, ['customer', 'party name', 'party', 'buyer', 'buyer name', 'client', 'client name', 'name of customer', 'ledger name', 'ledger', 'particulars']),
    F('gstin', 'Customer GSTIN', 0, ['gstin', 'gstin uin', 'buyer gstin', 'party gstin', 'gst no', 'gst number'], 'Used to find the customer and, for a new customer, to set the state.'),
    F('state', 'Customer State', 0, ['state', 'state name', 'buyer state', 'party state'], 'Decides CGST+SGST (same state) or IGST.'),
    F('place_of_supply', 'Place of Supply', 0, ['pos'], 'Blank = same as customer state.'),
    F('description', 'Description', 1, ['item', 'item name', 'item description', 'product', 'service', 'details', 'narration']),
    F('hsn_sac', 'HSN/SAC', 0, ['hsn', 'sac', 'hsn code', 'sac code', 'hsn sac code'], '4 to 8 digits.'),
    F('quantity', 'Quantity', 0, ['qty'], 'Blank = 1.'),
    F('unit', 'Unit', 0, ['uom']),
    F('rate', 'Rate', 1, ['price', 'unit price', 'rate per unit', 'taxable value', 'taxable amount', 'taxable', 'basic amount', 'amount before tax'], 'Per unit, before GST. If your file has only a taxable value, map it here and leave Quantity unmapped.'),
    F('discount', 'Discount', 0, ['disc', 'discount amount'], 'Rupees on the line, not a percentage.'),
    F('gst_rate', 'GST Rate %', 1, ['gst rate', 'gst', 'tax rate', 'rate of tax', 'tax %', 'igst rate'], '0, 3, 5, 12, 18, 28 or 40.'),
    F('total', 'Invoice Total (check)', 0, ['invoice total', 'total', 'invoice value', 'total amount', 'grand total', 'amount'], 'Optional control total: the import stops a row if it differs from the computed total by more than Rs 1.'),
    F('reverse_charge', 'Reverse Charge (Y/N)', 0, ['reverse charge', 'rcm']),
    F('head', 'Income Head', 0, ['head', 'ledger head', 'sales ledger', 'account head'], 'Name or code of an income account in your Chart of Accounts. Blank = Sales.')
  ],
  purchase: [
    F('number', 'Bill No', 1, ['bill number', 'supplier invoice no', 'supplier invoice number', 'invoice no', 'invoice number', 'vendor invoice no', 'ref no', 'number'], "The supplier's invoice number. Rows with the same number become one bill."),
    F('date', 'Bill Date', 1, ['invoice date', 'date', 'document date']),
    F('due_date', 'Due Date', 0, ['due', 'payment due']),
    F('party', 'Supplier Name', 1, ['supplier', 'vendor', 'vendor name', 'party name', 'party', 'seller', 'ledger name', 'ledger', 'particulars']),
    F('gstin', 'Supplier GSTIN', 0, ['gstin', 'vendor gstin', 'party gstin', 'gstin uin', 'gst no']),
    F('state', 'Supplier State', 0, ['state', 'state name', 'vendor state']),
    F('taxable', 'Taxable Value', 1, ['taxable amount', 'taxable', 'basic amount', 'amount before tax', 'base amount', 'basic value']),
    F('gst_rate', 'GST Rate %', 1, ['gst rate', 'gst', 'tax rate', 'tax %']),
    F('cgst', 'CGST', 0, ['cgst amount'], 'Optional. Fill CGST/SGST/IGST exactly as on the supplier bill, or leave all three blank to have them computed.'),
    F('sgst', 'SGST', 0, ['sgst amount', 'utgst']),
    F('igst', 'IGST', 0, ['igst amount']),
    F('total', 'Bill Total (check)', 0, ['bill total', 'total', 'invoice total', 'invoice value', 'total amount', 'grand total', 'amount']),
    F('itc_blocked', 'ITC Not Allowed (Y/N)', 0, ['itc blocked', 'blocked credit', 'itc ineligible', 'itc not allowed'], 'Y = the GST becomes part of the cost (Sec 17(5) / ineligible credit). Needs migration 018.'),
    F('head', 'Expense Head', 0, ['head', 'expense ledger', 'purchase ledger', 'account head'], 'Name or code of an expense account in your Chart of Accounts. Blank = Purchases.')
  ],
  bank: [
    F('date', 'Date', 1, ['txn date', 'transaction date', 'value date', 'posting date', 'tran date']),
    F('account', 'Bank Account', 1, ['account', 'bank', 'account name', 'cash bank account'], 'Must match the name of a Cash / Bank account in Banking. Blank = the account you choose below.'),
    F('narration', 'Narration', 1, ['description', 'particulars', 'remarks', 'transaction remarks', 'details', 'transaction details']),
    F('debit', 'Debit', 0, ['withdrawal', 'withdrawals', 'withdrawal amt', 'withdrawal amount', 'dr', 'paid out', 'money out', 'debit amount']),
    F('credit', 'Credit', 0, ['deposit', 'deposits', 'deposit amt', 'deposit amount', 'cr', 'paid in', 'money in', 'credit amount']),
    F('reference', 'Reference No', 0, ['ref no', 'chq ref no', 'cheque no', 'chq no', 'utr', 'utr no', 'reference', 'txn ref', 'transaction ref']),
    F('party', 'Party Name', 0, ['party', 'customer supplier', 'name'], 'Customer (money in) or supplier (money out). With no invoice and no category it is booked as an advance.'),
    F('invoice_no', 'Invoice / Bill No', 0, ['invoice no', 'bill no', 'against invoice', 'invoice number', 'against bill'], 'Settles that sales invoice (credit) or purchase bill (debit).'),
    F('category', 'Category', 0, ['ledger', 'head', 'expense category', 'income category', 'account head'], 'Income or expense head for entries with no invoice or advance, e.g. Bank charges, Interest Income.')
  ]
};
const TITLES = {sales: 'Sales invoices', purchase: 'Purchase bills', bank: 'Bank entries'};
const ids = (t) => FIELDS[t].map(f => f.k);

/* Header row: the first row that looks like this template's header (>= 3 recognised column names, or at least half of them), else the first row. */
function detectHeader(rows, type) {
  const fs = FIELDS[type], known = new Set(fs.flatMap(f => f.al));
  const rows2 = rows.filter(r => !/^\s*#/.test(r.cells[0] || ''));
  for (let i = 0; i < Math.min(rows2.length, 40); i++) { const hit = rows2[i].cells.filter(c => known.has(norm(c))).length; if (hit >= 3 || (hit >= 2 && hit >= rows2[i].cells.filter(c => clean(c)).length / 2)) return {header: rows2[i], body: rows2.slice(i + 1)}; }
  return {header: rows2[0] || {n: 0, cells: []}, body: rows2.slice(1)};
}
/* {fieldKey: columnIndex or -1}. Exact (normalised) header/alias match only, so "Rate" never grabs "GST Rate %"; a column is used once. */
function autoMap(type, headers) {
  const map = {}, used = new Set(), hs = headers.map(norm);
  for (const f of FIELDS[type]) {
    let at = -1;
    for (const al of f.al) { const i = hs.findIndex((h, ix) => h === al && !used.has(ix)); if (i >= 0) { at = i; break; } }
    map[f.k] = at; if (at >= 0) used.add(at);
  }
  return map;
}
/* rows -> records [{n, v:{field: text}}] using the mapping. Cells starting with "#" in the first column are comments (the template's example rows). */
function records(body, map, type) {
  return body.filter(r => !/^\s*#/.test(r.cells[0] || '') && r.cells.some(c => clean(c) !== '')).map(r => {
    const v = {}; for (const k of ids(type)) v[k] = map[k] >= 0 ? clean(unsafeCell(clean(r.cells[map[k]]))) : ''; return {n: r.n, v};
  });
}

/* ================================================================== templates ==== */
const SAMPLE = {
  sales: [['# INV-0001', '15/04/2026', '30/04/2026', 'Sample Customer Pvt Ltd', '27AAPFU0939F1ZV', 'Maharashtra', '', 'GST return filing - April 2026', '998231', '1', 'Nos', '5000', '0', '18', '9440', 'N', ''], ['# INV-0001 (second line of the same invoice)', '15/04/2026', '30/04/2026', 'Sample Customer Pvt Ltd', '', '', '', 'Bookkeeping - April 2026', '998222', '1', 'Nos', '3000', '0', '18', '', 'N', '']],
  purchase: [['# SUP/26/118', '10/04/2026', '25/04/2026', 'Sample Supplier LLP', '29AAPFU0939F1ZV', 'Karnataka', '10000', '18', '', '', '1800', '11800', 'N', '']],
  bank: [['# 15/04/2026', 'HDFC Bank', 'NEFT from Sample Customer Pvt Ltd', '', '9440', 'UTR123456', 'Sample Customer Pvt Ltd', 'INV-0001', ''], ['# 16/04/2026', 'HDFC Bank', 'Bank charges April', '118', '', '', '', '', 'Bank charges']]
};
const lbl = f => f.label + (f.req ? '*' : '');
/* CSV text of a blank template: header + example rows whose first cell starts with "#" (ignored on import). */
const templateCSV = type => '﻿' + toCSV([FIELDS[type].map(lbl)].concat(SAMPLE[type]));

/* ================================================================== environment (injected) ====
   env = {gst(taxable, rate, party) -> {cgst, sgst, igst}, gstinOk(g), RATES, GF (gst-fields.js), DS (doc-series.js, optional)} */
const issue = (level, msg) => ({level, msg});
const ST = {OK: 'ok', WARN: 'warn', ERR: 'error', DUP: 'dup', PEND: 'pending'};
const rank = {ok: 0, warn: 1, pending: 2, dup: 3, error: 4};
const worst = (list, init) => list.reduce((a, x) => rank[x] > rank[a] ? x : a, init || 'ok');
const keyOf = s => normName(s);
const fmt2 = n => (Math.round((+n || 0) * 100) / 100).toFixed(2);

/* Find a customer / supplier. Order: GSTIN, exact name, name ignoring case / punctuation / "Pvt Ltd". `fixes.party[key]` holds the user's decision:
   {id} use that party, {create:true, state, gstin, gst_type} create at posting, {skip:true} leave these rows out. */
function resolveParty(name, gstin, kind, ctx) {
  const list = (ctx.parties || []).filter(p => p.kind === kind), key = keyOf(name), fx = (ctx.fixes && ctx.fixes.party || {})[key];
  const g = clean(gstin).toUpperCase();
  if (fx && fx.id) { const p = list.find(x => x.id === fx.id); if (p) return {status: 'fixed', party: p, key}; }
  if (fx && fx.create) return {status: 'create', party: {id: null, name: clean(fx.name || name), kind, gstin: fx.gstin || g, state: fx.state || '', gst_type: fx.gst_type}, key, fix: fx};
  if (fx && fx.skip) return {status: 'skip', key};
  if (g && /^\d{2}[A-Z0-9]{13}$/.test(g)) { const p = list.find(x => String(x.gstin || '').trim().toUpperCase() === g); if (p) return {status: 'gstin', party: p, key, rename: normName(p.name) !== key}; }
  const exact = list.filter(p => clean(p.name).toLowerCase() === clean(name).toLowerCase());
  if (exact.length) return {status: 'exact', party: exact[0], key};
  const nn = list.filter(p => normName(p.name) === key && key);
  if (nn.length) return {status: 'normalised', party: nn[0], key};
  return {status: 'missing', key, name: clean(name), gstin: g, suggestions: suggest(name, list, p => p.name).map(s => ({party: s.item, score: s.score}))};
}
const bankMatch = (name, ctx) => {
  const key = keyOf(name), fx = (ctx.fixes && ctx.fixes.account || {})[key], list = ctx.accounts || [];
  if (fx && fx.id) { const a = list.find(x => x.id === fx.id); if (a) return {status: 'fixed', account: a, key}; }
  if (fx && fx.create) return {status: 'create', account: {id: null, name: clean(name), opening: 0}, key, fix: fx};
  const a = list.find(x => clean(x.name).toLowerCase() === clean(name).toLowerCase()) || list.find(x => norm(x.name) === norm(name) && norm(name));
  if (a) return {status: 'exact', account: a, key};
  return {status: 'missing', key, name: clean(name), suggestions: suggest(name, list, x => x.name).map(s => ({account: s.item, score: s.score}))};
};
function resolveHead(name, kind, ctx) {
  const t = clean(name); if (!t) return {status: 'none'};
  const key = norm(t), fx = (ctx.fixes && ctx.fixes.head || {})[key];
  if (fx && fx.none) return {status: 'default', key};
  if (fx && fx.id) { const h = (ctx.heads || []).find(x => x.id === fx.id); if (h) return {status: 'fixed', head: h, key}; }
  const hs = ctx.heads || [], tl = t.toLowerCase();
  const h = hs.find(x => String(x.code).toLowerCase() === tl) || hs.find(x => norm(x.label) === key || norm(x.label.split('›').pop()) === key);
  if (h) return {status: 'exact', head: h, key};
  return {status: 'missing', key, name: t, suggestions: suggest(t, hs, x => x.label.split('›').pop()).map(s => ({head: s.item, score: s.score}))};
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };

/* The masters (customers, bank accounts, heads, categories) a file refers to that are not yet resolved: what the "check ledgers" panel lists. */
const newMasters = () => ({party: new Map(), account: new Map(), head: new Map(), category: new Map()});
function noteMissing(M, type, r, rowNo, extra) {
  if (!r || (r.status !== 'missing' && r.status !== 'create' && r.status !== 'skip' && r.status !== 'new' && r.status !== 'default' && r.status !== 'fixed')) return;
  const e = M[type].get(r.key) || Object.assign({key: r.key, name: r.name || (r.party && r.party.name) || (r.account && r.account.name) || (r.head && r.head.label) || r.category || '', status: r.status, rows: [], suggestions: r.suggestions || []}, extra || {});
  e.status = r.status; e.rows.push(rowNo); M[type].set(r.key, e);
}
const mastersList = M => ({party: [...M.party.values()], account: [...M.account.values()], head: [...M.head.values()], category: [...M.category.values()]});
const pendingCount = M => [...M.party.values(), ...M.account.values(), ...M.head.values(), ...M.category.values()].filter(e => e.status === 'missing' || e.status === 'new').length;

/* ================================================================== sales / purchase documents ==== */
function groupRecords(recs, opt, series) {
  const groups = new Map(), order = []; let auto = 0;
  for (const r of recs) {
    let no = clean(r.v.number), k;
    if (!no && opt.autoNumber) { k = '__auto' + (++auto); no = ''; } else k = no.toLowerCase();
    if (!no && !opt.autoNumber) k = '__blank' + r.n;
    if (!groups.has(k)) { groups.set(k, {key: k, number: no, recs: []}); order.push(k); }
    groups.get(k).recs.push(r);
  }
  return order.map(k => groups.get(k));
}
function commonHeader(g, fieldsToCompare) {
  const first = g.recs[0].v, diff = [];
  for (const f of fieldsToCompare) { const a = clean(first[f]).toLowerCase(); if (g.recs.some(r => clean(r.v[f]).toLowerCase() !== a && clean(r.v[f]) !== '' && a !== '')) diff.push(f); }
  return diff;
}
const LBL = {date: 'date', party: 'party name', due_date: 'due date'};

function buildDocs(type, recs, opt, ctx) {
  const env = ctx.env, sale = type === 'sales', kind = sale ? 'client' : 'supplier', dkind = sale ? 'sale' : 'purchase', RATES = env.RATES;
  const M = newMasters(), docs = [], reservedNos = [], today = ctx.today;
  const existing = new Set((ctx.invoices || []).filter(i => i.kind === dkind).map(i => clean(i.number).toLowerCase()));
  const groups = groupRecords(recs, opt), seenNo = new Set();
  for (const g of groups) {
    const rows = g.recs.map(r => r.n), v0 = g.recs[0].v, iss = [], doc = {key: g.key, rows, number: g.number, lines: [], include: true};
    // ----- header
    const diff = commonHeader(g, ['date', 'party', 'due_date']);
    if (diff.length) iss.push(issue('error', 'Rows with the same ' + (sale ? 'invoice' : 'bill') + ' number disagree on ' + diff.map(d => LBL[d]).join(', ') + '.'));
    if (!g.number && !opt.autoNumber) iss.push(issue('error', (sale ? 'Invoice' : 'Bill') + ' number is missing.'));
    const date = parseDate(v0.date, opt.dayFirst);
    if (!clean(v0.date)) iss.push(issue('error', 'Date is missing.')); else if (!date) iss.push(issue('error', 'Date "' + v0.date + '" is not a valid date (expected ' + (opt.dayFirst === false ? 'MM/DD/YYYY' : 'DD/MM/YYYY') + ' or YYYY-MM-DD).'));
    doc.date = date;
    if (date && ctx.lockedThrough && date <= ctx.lockedThrough) iss.push(issue('error', 'The period up to ' + ctx.lockedThrough + ' is locked.'));
    if (date && today && date > addDays(today, 1)) iss.push(issue('warn', 'Date is in the future.'));
    let due = null; if (clean(v0.due_date)) { due = parseDate(v0.due_date, opt.dayFirst); if (!due) iss.push(issue('error', 'Due date "' + v0.due_date + '" is not valid.')); else if (date && due < date) iss.push(issue('warn', 'Due date is before the document date.')); }
    else if (date) due = addDays(date, 15);
    doc.due_date = due;
    // ----- party
    let pr = null;
    if (!clean(v0.party)) iss.push(issue('error', (sale ? 'Customer' : 'Supplier') + ' name is missing.'));
    else {
      pr = resolveParty(v0.party, v0.gstin, kind, ctx); doc.party = pr;
      if (pr.status === 'missing') { noteMissing(M, 'party', pr, rows[0], {gstin: clean(v0.gstin), state: clean(v0.state), kind}); iss.push(issue('pending', (sale ? 'Customer' : 'Supplier') + ' "' + clean(v0.party) + '" is not in your ledger. Create it or pick the right spelling.')); }
      else if (pr.status === 'create') { noteMissing(M, 'party', pr, rows[0], {kind}); iss.push(issue('info', 'Will be created as a new ' + (sale ? 'customer' : 'supplier') + '.')); }
      else if (pr.status === 'skip') { noteMissing(M, 'party', pr, rows[0], {kind}); doc.include = false; iss.push(issue('info', 'Left out at your request.')); }
      else if (pr.status === 'fixed') noteMissing(M, 'party', pr, rows[0], {kind});
      else if (pr.status === 'normalised' || (pr.status === 'gstin' && pr.rename)) iss.push(issue('info', 'Matched to "' + pr.party.name + '"' + (pr.status === 'gstin' ? ' by GSTIN' : ' (spelling differs slightly)') + '.'));
      if (clean(v0.gstin) && !env.gstinOk(clean(v0.gstin))) iss.push(issue('warn', 'GSTIN "' + clean(v0.gstin) + '" looks invalid (format or check digit).'));
      if (pr.party && pr.party.gstin && clean(v0.gstin) && pr.party.gstin.trim().toUpperCase() !== clean(v0.gstin).toUpperCase() && pr.status !== 'gstin') iss.push(issue('warn', 'GSTIN in the file differs from the one saved for "' + pr.party.name + '".'));
    }
    const pl = pr && pr.status !== 'skip' ? {state: (pr.party && pr.party.state) || clean(v0.state), gstin: (pr.party && pr.party.gstin) || clean(v0.gstin)} : null;
    if (pl && !(env.GF.stateCodeOf(pl.gstin, pl.state))) iss.push(issue('warn', 'The ' + (sale ? 'customer' : 'supplier') + "'s state is not known, so the tax is split as CGST+SGST (same state). Set the state if it is another state."));
    // ----- head
    if (clean(v0.head) && ctx.headsOn) {
      const hr = resolveHead(v0.head, dkind, ctx); doc.head = hr;
      if (hr.status === 'missing') { noteMissing(M, 'head', hr, rows[0]); iss.push(issue('pending', (sale ? 'Income' : 'Expense') + ' head "' + hr.name + '" was not found in your Chart of Accounts.')); }
      else if (hr.status === 'default') { noteMissing(M, 'head', Object.assign({name: clean(v0.head)}, hr), rows[0]); }
      else if (hr.status === 'fixed') { noteMissing(M, 'head', Object.assign({name: clean(v0.head)}, hr), rows[0]); doc.gl_account_id = hr.head.id; }
      else if (hr.head) doc.gl_account_id = hr.head.id;
    } else if (clean(v0.head) && !ctx.headsOn) iss.push(issue('warn', 'Heads need the ledger Chart of Accounts (Ledger Setup); the column is ignored.'));
    if (sale && clean(v0.place_of_supply)) { if (env.GF.stateCodeByName(v0.place_of_supply)) doc.place_of_supply = env.GF.canonState(v0.place_of_supply); else iss.push(issue('warn', 'Place of supply "' + clean(v0.place_of_supply) + '" is not a known state: left blank.')); }
    doc.reverse_charge = sale && parseBool(v0.reverse_charge); doc.itc_blocked = !sale && parseBool(v0.itc_blocked);
    // ----- amounts
    const gstFn = (t, r) => pl ? env.gst(t, r, ctx.S, pl) : {cgst: 0, sgst: 0, igst: 0};
    const lines = []; let bad = false, override = false;
    for (const r of g.recs) {
      const v = r.v, tag = g.recs.length > 1 ? 'Row ' + r.n + ': ' : '';
      const rate = parseRate(v.gst_rate);
      if (rate === null) { iss.push(issue('error', tag + 'GST rate is missing.')); bad = true; }
      else if (Number.isNaN(rate) || !RATES.includes(rate)) { iss.push(issue('error', tag + 'GST rate "' + v.gst_rate + '" is not one of ' + RATES.join(', ') + '.')); bad = true; }
      if (sale) {
        const q = v.quantity === '' ? null : parseAmount(v.quantity), rt = parseAmount(v.rate), dc = v.discount === '' ? null : parseAmount(v.discount);
        if (rt === null) { iss.push(issue('error', tag + 'Rate / taxable value is missing.')); bad = true; } else if (Number.isNaN(rt) || rt < 0) { iss.push(issue('error', tag + 'Rate "' + v.rate + '" is not a valid amount (negative amounts are not allowed: record returns as a credit note).')); bad = true; }
        if (q !== null && (Number.isNaN(q) || !(q > 0))) { iss.push(issue('error', tag + 'Quantity "' + v.quantity + '" must be more than zero.')); bad = true; }
        if (dc !== null && (Number.isNaN(dc) || dc < 0)) { iss.push(issue('error', tag + 'Discount "' + v.discount + '" is not valid.')); bad = true; }
        if (!clean(v.description)) { iss.push(issue('error', tag + 'Description is missing.')); bad = true; }
        if (clean(v.hsn_sac) && !/^\d{4,8}$/.test(clean(v.hsn_sac))) { iss.push(issue('error', tag + 'HSN / SAC "' + v.hsn_sac + '" must be 4 to 8 digits.')); bad = true; }
        lines.push({description: clean(v.description), hsn_sac: clean(v.hsn_sac), quantity: q === null || Number.isNaN(q) ? 1 : q, unit: clean(v.unit), rate: Number.isNaN(rt) || rt === null ? 0 : rt, discount: dc === null || Number.isNaN(dc) ? 0 : dc, gst_rate: Number.isNaN(rate) || rate === null ? 0 : rate});
      } else {
        const tv = parseAmount(v.taxable);
        if (tv === null) { iss.push(issue('error', tag + 'Taxable value is missing.')); bad = true; } else if (Number.isNaN(tv) || tv < 0) { iss.push(issue('error', tag + 'Taxable value "' + v.taxable + '" is not valid.')); bad = true; }
        const t3 = ['cgst', 'sgst', 'igst'].map(k => v[k] === '' ? null : parseAmount(v[k]));
        if (t3.some(x => x !== null && (Number.isNaN(x) || x < 0))) { iss.push(issue('error', tag + 'CGST / SGST / IGST must be valid, non-negative amounts.')); bad = true; }
        if (t3.some(x => x !== null)) override = true;
        lines.push({description: '', quantity: 1, rate: Number.isNaN(tv) || tv === null ? 0 : tv, discount: 0, gst_rate: Number.isNaN(rate) || rate === null ? 0 : rate, ov: t3.map(x => x === null || Number.isNaN(x) ? 0 : x)});
      }
    }
    doc.lines = lines;
    if (!bad && lines.length) {
      let c;
      if (!sale && override) {
        // supplier-bill tax taken exactly as written
        const tv = lines.reduce((s, l) => s + money(l.rate), 0), cg = lines.reduce((s, l) => s + money(l.ov[0]), 0), sg = lines.reduce((s, l) => s + money(l.ov[1]), 0), ig = lines.reduce((s, l) => s + money(l.ov[2]), 0);
        const by = new Map(); lines.forEach(l => by.set(l.gst_rate, (by.get(l.gst_rate) || 0) + money(l.rate))); let top = 0, best = -1; by.forEach((x, r) => { if (x > best || (x === best && r > top)) { best = x; top = r; } });
        c = {items: [], taxable: tv / 100, cgst: cg / 100, sgst: sg / 100, igst: ig / 100, tax: (cg + sg + ig) / 100, amount: (tv + cg + sg + ig) / 100, gst_rate: top, mixed: by.size > 1, override: true};
        if (ig > 0 && (cg > 0 || sg > 0)) { iss.push(issue('error', 'A bill has IGST together with CGST/SGST. Use one or the other.')); bad = true; }
        const expect = lines.reduce((s, l) => s + Math.round(money(l.rate) * l.gst_rate / 100), 0);
        if (Math.abs((cg + sg + ig) - expect) > 100) iss.push(issue('warn', 'Tax in the file (' + fmt2((cg + sg + ig) / 100) + ') differs from the rate (' + fmt2(expect / 100) + ').'));
      } else c = env.GF.calcLines(lines, gstFn);
      doc.calc = c;
      if (!(c.amount > 0) && !bad) { iss.push(issue('error', 'The total must be more than zero.')); bad = true; }
      if (clean(v0.total) !== '' && !bad) {
        const tot = parseAmount(v0.total);
        if (Number.isNaN(tot)) iss.push(issue('error', 'Total "' + v0.total + '" is not a valid amount.'));
        else if (tot !== null) { const d = Math.abs(tot - c.amount); if (d > 1.0001) iss.push(issue('error', 'Total in the file (' + fmt2(tot) + ') differs from the computed total (' + fmt2(c.amount) + '). Check the GST rate, the state, or the amounts.')); else if (d >= 0.005) iss.push(issue('warn', 'Total in the file (' + fmt2(tot) + ') is ' + fmt2(d) + ' away from the computed ' + fmt2(c.amount) + '; the computed figure is posted.')); }
      }
    }
    // ----- number
    if (g.number) {
      const lk = g.number.toLowerCase();
      if (existing.has(lk)) { doc.dup = true; iss.push(issue('dup', (sale ? 'Invoice' : 'Bill') + ' ' + g.number + ' already exists in your books: skipped.')); }
      else if (seenNo.has(lk)) { iss.push(issue('error', 'The number ' + g.number + ' appears again further down the file in a separate block of rows. Keep all lines of one document together.')); }
      seenNo.add(lk);
      if (sale && !/^[A-Za-z0-9\/-]{1,16}$/.test(g.number)) iss.push(issue('warn', 'GST allows at most 16 characters (letters, digits, - and /) in an invoice number.'));
    }
    doc.issues = iss;
    docs.push(doc);
  }
  // numbers for rows without one (after real numbers are known so they cannot clash)
  if (opt.autoNumber) {
    const taken = [...existing, ...docs.filter(d => d.number).map(d => d.number)];
    for (const d of docs) if (!d.number && d.date && ctx.nextNo) { const n = ctx.nextNo(dkind, d.date, taken.concat(reservedNos)); d.number = n; d.auto = true; reservedNos.push(n); }
    for (const d of docs) if (!d.number && !d.issues.some(i => i.level === 'error' && /number/.test(i.msg))) d.issues.push(issue('error', 'Could not generate a number (fix the date first).'));
  }
  for (const d of docs) { d.status = d.dup ? 'dup' : worst(d.issues.map(i => i.level === 'info' ? 'ok' : i.level), 'ok'); if (!d.include && d.status !== 'error') d.status = 'dup'; }
  const tot = {docs: 0, taxable: 0, tax: 0, amount: 0};
  docs.filter(d => d.calc && d.include && !d.dup && d.status !== 'error').forEach(d => { tot.docs++; tot.taxable += money(d.calc.taxable); tot.tax += money(d.calc.tax); tot.amount += money(d.calc.amount); });
  tot.taxable /= 100; tot.tax /= 100; tot.amount /= 100;
  return {docs, masters: mastersList(M), pending: pendingCount(M), totals: tot, counts: countBy(docs)};
}
function countBy(list) { const c = {ok: 0, warn: 0, error: 0, dup: 0, pending: 0}; list.forEach(x => c[x.status] = (c[x.status] || 0) + 1); return c; }

/* ================================================================== bank entries ==== */
const BUILTIN_CATS = {income: ['Interest Income', 'TDS Refund', 'Other income', 'Advance received'], expense: ['Interest', 'Late Fees / Penalty', 'Bank charges', 'Advance paid', 'TDS deposited']};
function buildBank(recs, opt, ctx) {
  const env = ctx.env, M = newMasters(), out = [], today = ctx.today, edits = ctx.edits || {};
  const invByNo = new Map(); (ctx.invoices || []).forEach(i => invByNo.set(i.kind + '|' + clean(i.number).toLowerCase(), i));
  const outstanding = new Map(), seenKeys = new Map();
  const knownCats = type => { const s = new Map(); (BUILTIN_CATS[type] || []).concat((ctx.categories && ctx.categories[type]) || []).forEach(c => { if (clean(c)) s.set(norm(c), clean(c)); }); return s; };
  const cats = {income: knownCats('income'), expense: knownCats('expense')};
  for (const r of recs) {
    const e = edits[r.n] || {}, v = Object.assign({}, r.v, e), iss = [], t = {n: r.n, include: true, narration: clean(v.narration), reference: clean(v.reference)};
    const date = parseDate(v.date, opt.dayFirst);
    if (!clean(v.date)) iss.push(issue('error', 'Date is missing.')); else if (!date) iss.push(issue('error', 'Date "' + v.date + '" is not a valid date.'));
    t.date = date;
    if (date && ctx.lockedThrough && date <= ctx.lockedThrough) iss.push(issue('error', 'The period up to ' + ctx.lockedThrough + ' is locked.'));
    if (date && today && date > addDays(today, 1)) iss.push(issue('warn', 'Date is in the future.'));
    if (!t.narration) iss.push(issue('error', 'Narration is missing.'));
    // amount and direction
    const dr = v.debit === '' ? null : parseAmount(v.debit), cr = v.credit === '' ? null : parseAmount(v.credit);
    if ((dr !== null && Number.isNaN(dr)) || (cr !== null && Number.isNaN(cr))) iss.push(issue('error', 'Debit / Credit "' + (Number.isNaN(dr) ? v.debit : v.credit) + '" is not a valid amount.'));
    else if ((dr !== null && dr < 0) || (cr !== null && cr < 0)) iss.push(issue('error', 'Negative amounts are not allowed. Put the amount in the other column.'));
    else if (dr && cr) iss.push(issue('error', 'Both Debit and Credit are filled. Each row is either money in or money out.'));
    else if (!dr && !cr) iss.push(issue('error', 'Debit and Credit are both empty or zero.'));
    else {
      const a = dr || cr, isDebit = !!dr, out_ = opt.debitMeans === 'in' ? !isDebit : isDebit;
      t.amount = Math.round(a * 100 + 1e-9) / 100; t.type = out_ ? 'expense' : 'income';
      if (Math.abs(a * 100 - Math.round(a * 100)) > 1e-6) iss.push(issue('warn', 'Amount has more than 2 decimals; rounded to ' + fmt2(t.amount) + '.'));
    }
    // account
    const aname = clean(v.account);
    if (aname) { const ar = bankMatch(aname, ctx); t.account = ar; if (ar.status === 'missing') { noteMissing(M, 'account', ar, r.n); iss.push(issue('pending', 'Bank account "' + aname + '" does not exist. Create it or pick the right one.')); } else if (ar.status === 'create') { noteMissing(M, 'account', ar, r.n); iss.push(issue('info', 'Bank account will be created.')); } else if (ar.status === 'fixed') noteMissing(M, 'account', ar, r.n); }
    else if (opt.defaultAccountId) { const a = (ctx.accounts || []).find(x => x.id === opt.defaultAccountId); if (a) t.account = {status: 'default', account: a, key: keyOf(a.name)}; else iss.push(issue('error', 'The chosen bank account no longer exists.')); }
    else iss.push(issue('error', 'Bank account is missing. Fill the column or choose an account for all rows.'));
    // invoice / party / category
    let inv = null, party = null;
    if (clean(v.invoice_no) && t.type) {
      const k = (t.type === 'income' ? 'sale|' : 'purchase|') + clean(v.invoice_no).toLowerCase();
      inv = invByNo.get(k);
      if (!inv) iss.push(issue('error', (t.type === 'income' ? 'Sales invoice ' : 'Purchase bill ') + v.invoice_no + ' was not found. ' + (invByNo.get((t.type === 'income' ? 'purchase|' : 'sale|') + clean(v.invoice_no).toLowerCase()) ? 'That number belongs to a ' + (t.type === 'income' ? 'purchase bill' : 'sales invoice') + ': check whether the money is in or out.' : 'Import the invoice first or fix the number.')));
      else {
        t.invoice = inv; t.mode = 'invoice';
        const left = outstanding.has(inv.id) ? outstanding.get(inv.id) : money(inv.amount) - money(inv.paid) - money(inv.adjusted || 0);
        if (t.amount != null) { if (money(t.amount) > left) iss.push(issue('error', 'Amount ' + fmt2(t.amount) + ' is more than the balance due on ' + inv.number + ' (' + fmt2(Math.max(0, left) / 100) + ').')); outstanding.set(inv.id, left - money(t.amount)); }
        const pp = (ctx.parties || []).find(p => p.id === inv.party_id); t.partyName = pp ? pp.name : '';
        if (clean(v.party) && pp && normName(v.party) !== normName(pp.name) && similarity(v.party, pp.name) < 0.8) iss.push(issue('warn', 'Party "' + clean(v.party) + '" differs from the party on ' + inv.number + ' ("' + pp.name + '").'));
      }
    } else if (clean(v.invoice_no) && !t.type) { /* direction unknown: the amount error already shows */ }
    if (!inv && t.type) {
      const pkind = t.type === 'income' ? 'client' : 'supplier';
      if (clean(v.party)) {
        party = resolveParty(v.party, '', pkind, ctx); t.party = party;
        if (party.status === 'missing') { noteMissing(M, 'party', party, r.n, {kind: pkind}); iss.push(issue('pending', (pkind === 'client' ? 'Customer' : 'Supplier') + ' "' + clean(v.party) + '" is not in your ledger. Create it or pick the right spelling.')); }
        else if (party.status === 'create') { noteMissing(M, 'party', party, r.n, {kind: pkind}); iss.push(issue('info', 'Will be created as a new ' + (pkind === 'client' ? 'customer' : 'supplier') + '.')); }
        else if (party.status === 'skip') { noteMissing(M, 'party', party, r.n, {kind: pkind}); t.include = false; iss.push(issue('info', 'Left out at your request.')); }
        else if (party.status === 'fixed') noteMissing(M, 'party', party, r.n, {kind: pkind});
        else if (party.status === 'normalised') iss.push(issue('info', 'Party matched to "' + party.party.name + '" (spelling differs slightly).'));
      }
      const cat = clean(v.category);
      if (cat) {
        const ck = norm(cat), known = cats[t.type].get(ck);
        t.mode = 'other'; t.category = known || cat;
        const reserved = ck === 'sales' || ck === 'purchases';
        if (reserved) iss.push(issue('warn', 'Category "' + cat + '" with no invoice posts straight to ' + (ck === 'sales' ? 'Sales' : 'Purchases') + '. Add the invoice number to settle an invoice instead.'));
        else if (ck === 'advance received' || ck === 'advance paid') { t.mode = 'advance'; t.category = ck === 'advance received' ? 'Advance received' : 'Advance paid'; if (!party || !party.party && party.status !== 'create') iss.push(issue('error', 'An advance needs a ' + (pkind === 'client' ? 'customer' : 'supplier') + ' name.')); }
        else if (!known) {
          const fx = (ctx.fixes && ctx.fixes.category || {})[ck + '|' + t.type];
          if (fx && fx.use) { t.category = fx.use; noteMissing(M, 'category', {status: 'fixed', key: ck + '|' + t.type, category: cat, use: fx.use}, r.n, {type: t.type, name: cat, use: fx.use}); }
          else if (fx && fx.create) { t.categoryNew = true; noteMissing(M, 'category', {status: 'create', key: ck + '|' + t.type, category: cat}, r.n, {type: t.type, name: cat}); iss.push(issue('info', 'New ' + (t.type === 'income' ? 'income' : 'expense') + ' head "' + cat + '" will be created.')); }
          else { const key = ck + '|' + t.type, sg = suggest(cat, [...cats[t.type].values()], x => x).map(s => ({name: s.item, score: s.score})); noteMissing(M, 'category', {status: 'new', key, category: cat, suggestions: sg}, r.n, {type: t.type, name: cat}); iss.push(issue('pending', 'Head "' + cat + '" does not exist yet. Create it or pick an existing one.')); }
        }
      } else if (party && (party.party || party.status === 'create' || party.status === 'missing')) {
        t.mode = 'advance'; t.category = t.type === 'income' ? 'Advance received' : 'Advance paid';
        iss.push(issue('info', 'No invoice or category: booked as an ' + (t.type === 'income' ? 'advance from the customer' : 'advance to the supplier') + '.'));
      } else if (!party) {
        t.mode = 'other'; t.category = ''; iss.push(issue('warn', 'No category: posted to ' + (t.type === 'income' ? '"Other income"' : '"General expenses"') + '. Type a category in the table to book it properly.'));
      }
    }
    // duplicates
    if (t.date && t.amount != null && t.type && t.account && (t.account.account || t.account.status === 'create')) {
      const accId = t.account.account && t.account.account.id, k = [accId || 'new:' + t.account.key, t.date, t.type, fmt2(t.amount)].join('|');
      const ref = norm(t.reference), nar = norm(t.narration);
      const hit = accId && (ctx.txns || []).find(x => x.account_id === accId && x.date === t.date && x.type === t.type && Math.abs(+x.amount - t.amount) < 0.005 && ((ref && norm(x.reference_no) === ref) || (nar && (norm(x.description) === nar || (nar.length >= 8 && norm(x.description).includes(nar))))));
      if (hit && !(ctx.include && ctx.include[r.n])) { t.dup = true; iss.push(issue('dup', 'Looks already posted (same account, date, amount and narration/reference). Skipped unless you tick Include.')); }
      const prev = seenKeys.get(k + '|' + (ref || nar)); if (prev) iss.push(issue('warn', 'Same account, date, amount and narration as row ' + prev + ' of this file.')); else seenKeys.set(k + '|' + (ref || nar), r.n);
    }
    t.issues = iss;
    const st = worst(iss.map(i => i.level === 'info' ? 'ok' : i.level), 'ok');
    t.status = t.dup ? 'dup' : (!t.include ? 'dup' : st);
    out.push(t);
  }
  const tot = {rows: 0, in: 0, out: 0};
  out.filter(t => t.include && !t.dup && t.status !== 'error' && t.amount != null).forEach(t => { tot.rows++; if (t.type === 'income') tot.in += money(t.amount); else tot.out += money(t.amount); });
  tot.in /= 100; tot.out /= 100;
  return {txns: out, masters: mastersList(M), pending: pendingCount(M), totals: tot, counts: countBy(out)};
}

/* ================================================================== posting (database injected) ====
   deps = {db, GF, rup, paise, noFn, insertVoucher(row, date), nextDoc(kind, S, i, date, reserved), S, onProgress(done, total, label), cancelled()}.
   Every function returns [{n: first file row, status: 'posted'|'failed'|'skipped', id, message}] and never throws for a single bad row. */
const msgOf = e => (e && (e.message || e.details)) || String(e);
/* Rows that may be posted now: valid, not skipped, not a duplicate. */
const postable = x => x.include !== false && !x.dup && (x.status === 'ok' || x.status === 'warn');
/* What must be created first: customers / suppliers / bank accounts the user decided to create (each once). */
function mastersToCreate(built) {
  const parties = new Map(), accounts = new Map();
  const add = (x, kind) => { if (x && x.status === 'create' && !parties.has(x.key)) parties.set(x.key, Object.assign({key: x.key, kind}, x.party)); };
  (built.docs || []).filter(postable).forEach(d => add(d.party, d.party && d.party.party && d.party.party.kind));
  (built.txns || []).filter(postable).forEach(t => { add(t.party, t.party && t.party.party && t.party.party.kind); if (t.account && t.account.status === 'create' && !accounts.has(t.account.key)) accounts.set(t.account.key, {key: t.account.key, name: t.account.account.name}); });
  return {parties: [...parties.values()], accounts: [...accounts.values()]};
}
const pid = (x, made) => x ? (x.party && x.party.id) || (made.party.get(x.key) || {}).id || null : null;
const toPostDocs = (built, made) => built.docs.filter(postable).map(d => Object.assign({}, d, {party_id: pid(d.party, made)}));
const toPostTxns = (built, made) => built.txns.filter(postable).map(t => Object.assign({}, t, {
  account_id: t.account ? (t.account.account && t.account.account.id) || (made.account.get(t.account.key) || {}).id || null : null,
  party_id: t.invoice ? null : pid(t.party, made), invoice_id: t.invoice ? t.invoice.id : null, invoice_no: t.invoice ? t.invoice.number : ''}));
async function createMasters(plan, deps) {
  const {db, GF} = deps, made = {party: new Map(), account: new Map()}, errors = [];
  for (const p of plan.parties || []) {
    const row = {name: p.name, kind: p.kind, gstin: p.gstin ? p.gstin.toUpperCase() : null, state: p.state ? GF.canonState(p.state) : null, gst_type: p.gst_type || (p.gstin ? 'regular' : 'unregistered')};
    Object.keys(row).forEach(k => row[k] === null && delete row[k]);
    const r = await GF.saveCompat(rw => db.from('parties').insert(rw).select().single(), row, GF.PARTY_NEW);
    if (r.error) errors.push('Could not create ' + p.name + ': ' + msgOf(r.error)); else made.party.set(p.key, r.data);
  }
  for (const a of plan.accounts || []) {
    const r = await db.from('accounts').insert({name: a.name, opening: 0}).select().single();
    if (r.error) errors.push('Could not create bank account ' + a.name + ': ' + msgOf(r.error)); else made.account.set(a.key, r.data);
  }
  return {made, errors};
}
async function postSales(docs, deps) {
  const {db, GF, noFn} = deps, res = [];
  const ik = await db.from('invoice_items').select('id').limit(1), ITEMS = !ik.error;
  let k = 0;
  for (const d of docs) {
    if (deps.cancelled && deps.cancelled()) { res.push({n: d.rows[0], status: 'skipped', message: 'Stopped'}); continue; }
    deps.onProgress && deps.onProgress(++k, docs.length, d.number);
    try {
      const c = d.calc, hdr = {party_id: d.party_id, number: d.number, date: d.date, due_date: d.due_date || null, place_of_supply: d.place_of_supply || null, reverse_charge: !!d.reverse_charge, ...GF.headerFromLines(c), ...(d.gl_account_id ? {gl_account_id: d.gl_account_id} : {})};
      let id = null, viaRpc = false;
      if (ITEMS) { const r = await db.rpc('save_sales_invoice', {p_invoice: null, p_h: hdr, p_items: c.items}); if (!r.error) { id = r.data; viaRpc = true; } else if (!noFn(r.error)) { res.push({n: d.rows[0], status: 'failed', message: msgOf(r.error)}); continue; } }
      if (!viaRpc) {
        if (c.items.length > 1) { res.push({n: d.rows[0], status: 'failed', message: 'Invoices with several lines need migration 021 (invoice items). Combine the lines or run the migration.'}); continue; }
        const l = c.items[0], row = {party_id: hdr.party_id, number: hdr.number, date: hdr.date, due_date: hdr.due_date, taxable: c.taxable, gst_rate: l.gst_rate, cgst: c.cgst, sgst: c.sgst, igst: c.igst, amount: c.amount, kind: 'sale', ...(hdr.gl_account_id ? {gl_account_id: hdr.gl_account_id} : {})};
        const nw = {description: l.description || null, hsn_sac: l.hsn_sac || null, quantity: l.quantity !== 1 ? l.quantity : null, unit: l.unit || null, place_of_supply: hdr.place_of_supply, reverse_charge: hdr.reverse_charge};
        for (const x of Object.keys(nw)) if (nw[x] === null || nw[x] === false) delete nw[x];
        const r = await GF.saveCompat(rw => db.from('invoices').insert(rw).select().single(), {...row, ...nw}, GF.INVOICE_NEW);
        if (r.error) { res.push({n: d.rows[0], status: 'failed', message: msgOf(r.error)}); continue; }
        id = r.data && r.data.id;
      }
      res.push({n: d.rows[0], status: 'posted', id, message: d.number});
    } catch (e) { res.push({n: d.rows[0], status: 'failed', message: msgOf(e)}); }
  }
  return res;
}
async function postPurchases(docs, deps) {
  const {db} = deps, res = []; let k = 0;
  for (const d of docs) {
    if (deps.cancelled && deps.cancelled()) { res.push({n: d.rows[0], status: 'skipped', message: 'Stopped'}); continue; }
    deps.onProgress && deps.onProgress(++k, docs.length, d.number);
    try {
      const c = d.calc, row = {party_id: d.party_id, number: d.number, date: d.date, due_date: d.due_date || null, taxable: c.taxable, gst_rate: c.gst_rate, cgst: c.cgst, sgst: c.sgst, igst: c.igst, amount: c.amount, kind: 'purchase'};
      if (d.itc_blocked) row.itc_blocked = true; if (d.gl_account_id) row.gl_account_id = d.gl_account_id;
      const r = await db.from('invoices').insert(row).select().single();
      if (r.error) res.push({n: d.rows[0], status: 'failed', message: /itc_blocked|gl_account_id/.test(msgOf(r.error)) ? 'Needs migration 018 (ITC) / 014 (heads): ' + msgOf(r.error) : msgOf(r.error)});
      else res.push({n: d.rows[0], status: 'posted', id: r.data && r.data.id, message: d.number});
    } catch (e) { res.push({n: d.rows[0], status: 'failed', message: msgOf(e)}); }
  }
  return res;
}
async function postBank(txns, deps) {
  const {db, rup, paise, noFn} = deps, res = []; let k = 0;
  for (const t of txns) {
    if (deps.cancelled && deps.cancelled()) { res.push({n: t.n, status: 'skipped', message: 'Stopped'}); continue; }
    deps.onProgress && deps.onProgress(++k, txns.length, t.narration);
    try {
      const amt = rup(paise(t.amount)), isIn = t.type === 'income';
      if (t.invoice_id) {
        const desc = (t.narration + ' - ' + t.invoice_no).slice(0, 300);
        const rp = await db.rpc('record_payment', {p_invoice: t.invoice_id, p_amount: amt, p_date: t.date, p_account: t.account_id, p_description: desc});
        let id = rp.data;
        if (rp.error) {
          if (!noFn(rp.error)) { res.push({n: t.n, status: 'failed', message: msgOf(rp.error)}); continue; }
          const ins = await db.from('transactions').insert({date: t.date, description: desc, category: isIn ? 'Sales' : 'Purchases', type: t.type, amount: amt, account_id: t.account_id, invoice_id: t.invoice_id}).select().single();
          if (ins.error) { res.push({n: t.n, status: 'failed', message: msgOf(ins.error)}); continue; }
          const cur = await db.from('invoices').select('paid').eq('id', t.invoice_id).single();
          const up = await db.from('invoices').update({paid: rup(paise(cur.data && cur.data.paid) + paise(amt))}).eq('id', t.invoice_id);
          if (up.error) { await db.from('transactions').delete().eq('id', ins.data.id); res.push({n: t.n, status: 'failed', message: msgOf(up.error)}); continue; }
          id = ins.data.id;
        }
        if (t.reference && id) await db.from('transactions').update({reference_no: t.reference}).eq('id', id);
        res.push({n: t.n, status: 'posted', id, message: ''});
      } else {
        const row = {date: t.date, description: t.narration.slice(0, 300), category: t.category || null, type: t.type, amount: amt, account_id: t.account_id, party_id: t.party_id || null, reference_no: t.reference || null};
        if (!row.category) delete row.category;
        if (!isIn && t.mode === 'other' && deps.voucherNo) row.voucher_no = await deps.voucherNo(t.date, deps.reserved);
        const r = await (row.voucher_no ? deps.insertVoucher(row, t.date) : db.from('transactions').insert(row));
        if (r.error) { res.push({n: t.n, status: 'failed', message: /party_id|reference_no|column/i.test(msgOf(r.error)) ? 'Needs migration 019 (party / reference on entries): ' + msgOf(r.error) : msgOf(r.error)}); continue; }
        res.push({n: t.n, status: 'posted', message: ''});
      }
    } catch (e) { res.push({n: t.n, status: 'failed', message: msgOf(e)}); }
  }
  return res;
}

/* ================================================================== export ==== */
const dmy = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
const num = n => n == null || n === '' ? '' : String(Math.round((+n) * 100) / 100);
function exportSales(d) {
  const P = new Map((d.parties || []).map(p => [p.id, p])), items = new Map(); (d.items || []).forEach(x => { if (!items.has(x.invoice_id)) items.set(x.invoice_id, []); items.get(x.invoice_id).push(x); });
  const rows = [FIELDS.sales.map(lbl)];
  (d.invoices || []).filter(i => i.kind === 'sale').sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.number).localeCompare(String(b.number))).forEach(i => {
    const p = P.get(i.party_id) || {}, base = [i.number, dmy(i.date), dmy(i.due_date), p.name || '', p.gstin || '', p.state || ''];
    const ls = (items.get(i.id) || []).sort((a, b) => a.line_no - b.line_no);
    if (ls.length) ls.forEach((l, ix) => rows.push(base.concat([i.place_of_supply || '', l.description, l.hsn_sac || '', num(l.quantity), l.unit || '', num(l.rate), num(l.discount), num(l.gst_rate), ix === 0 ? num(i.amount) : '', i.reverse_charge ? 'Y' : 'N', ''])));
    else { const q = +i.quantity > 0 ? +i.quantity : 1, tv = i.taxable == null ? i.amount : i.taxable; rows.push(base.concat([i.place_of_supply || '', i.description || '', i.hsn_sac || '', q === 1 ? '' : num(q), i.unit || '', num(Math.round(tv / q * 10000) / 10000), '', num(i.taxable == null ? 0 : i.gst_rate), num(i.amount), i.reverse_charge ? 'Y' : 'N', ''])); }
  });
  return rows;
}
function exportPurchases(d) {
  const P = new Map((d.parties || []).map(p => [p.id, p])), rows = [FIELDS.purchase.map(lbl)];
  (d.invoices || []).filter(i => i.kind === 'purchase').sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.number).localeCompare(String(b.number))).forEach(i => {
    const p = P.get(i.party_id) || {};
    rows.push([i.number, dmy(i.date), dmy(i.due_date), p.name || '', p.gstin || '', p.state || '', num(i.taxable == null ? i.amount : i.taxable), num(i.taxable == null ? 0 : i.gst_rate), num(i.cgst), num(i.sgst), num(i.igst), num(i.amount), i.itc_blocked ? 'Y' : 'N', '']);
  });
  return rows;
}
/* Bank statement convention: Debit = money OUT, Credit = money IN. */
function exportBank(d) {
  const A = new Map((d.accounts || []).map(a => [a.id, a])), P = new Map((d.parties || []).map(p => [p.id, p])), I = new Map((d.invoices || []).map(i => [i.id, i])), rows = [FIELDS.bank.map(lbl)];
  (d.transactions || []).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).forEach(t => {
    const inv = t.invoice_id ? I.get(t.invoice_id) : null, p = P.get(t.party_id) || (inv && P.get(inv.party_id)) || {};
    rows.push([dmy(t.date), (A.get(t.account_id) || {}).name || '', t.description || '', t.type === 'expense' ? num(t.amount) : '', t.type === 'income' ? num(t.amount) : '', t.reference_no || '', p.name || '', inv ? inv.number : '', inv ? '' : (t.category || '')]);
  });
  return rows;
}

const api = {clean, norm, normName, similarity, suggest, lev, decodeText, sniffDelimiter, parseCSV, toCSV, safeCell, unsafeCell, readXlsx, xlsxSheets, serialToISO,
  parseDate, parseAmount, parseRate, parseBool, FIELDS, TITLES, detectHeader, autoMap, records, templateCSV, SAMPLE, resolveParty, resolveHead, bankMatch,
  buildDocs, buildBank, createMasters, mastersToCreate, toPostDocs, toPostTxns, postable, postSales, postPurchases, postBank, exportSales, exportPurchases, exportBank, addDays, ST};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IM = api;
})(typeof window !== 'undefined' ? window : globalThis);
