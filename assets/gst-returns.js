/* Toolkit Pro - GST return working papers (pure functions: no DOM, no database). Used by gst-returns.html. Global: GR.
   Builds GSTR-1 tables, GSTR-3B tables and a GSTR-2B reconciliation from the invoices, credit/debit notes and parties already in the app.
   It READS data only. Nothing here writes to your books.

   These are working papers to prepare and cross-check a return, not the filed return. The downloadable JSON follows the field names of the
   GST offline tools as understood when this was written; the portal changes formats from time to time, so import it into the official tool and
   check the figures before filing. */
(function (root) {
'use strict';
const gf = () => root.GF || require('./gst-fields.js');
const IM_ = () => root.IM || require('./import-core.js');

const c2 = n => { n = +n || 0; return Math.round((n + (n < 0 ? -1e-9 : 1e-9)) * 100) / 100; };
const sum = (a, f) => c2(a.reduce((s, x) => s + (+f(x) || 0), 0));
const RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
const nearRate = r => RATES.reduce((b, x) => Math.abs(x - r) < Math.abs(b - r) ? x : b, 0);
const B2CL_LIMIT = 100000;
const stOf = g => { g = String(g || '').trim().toUpperCase(); return /^\d{2}[A-Z0-9]{13}$/.test(g) ? g.slice(0, 2) : ''; };
const dmy = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
const fp = to => { const m = /^(\d{4})-(\d{2})/.exec(String(to)); return m ? m[2] + m[1] : ''; };
const inRange = (d, from, to) => !!d && d >= from && d <= to;

/* ---------------------------------------------------------------- shared set-up ---- */
function context(data) {
  const G = gf(), S = data.settings || {}, parties = new Map((data.parties || []).map(p => [p.id, p]));
  const own = stOf(S.gstin) || G.stateCodeByName(S.state) || '';
  const itemsBy = new Map();
  (data.items || []).forEach(x => { if (!itemsBy.has(x.invoice_id)) itemsBy.set(x.invoice_id, []); itemsBy.get(x.invoice_id).push(x); });
  itemsBy.forEach(l => l.sort((a, b) => (a.line_no || 0) - (b.line_no || 0)));
  const invById = new Map((data.invoices || []).map(i => [i.id, i]));
  const linesOf = inv => {
    const it = itemsBy.get(inv.id);
    if (it && it.length) return it.map(x => ({description: x.description || '', hsn: String(x.hsn_sac || '').trim(), qty: +x.quantity || 0, unit: x.unit || '', taxable: c2(x.taxable), rate: +x.gst_rate || 0, cgst: c2(x.cgst), sgst: c2(x.sgst), igst: c2(x.igst)}));
    return [{description: inv.description || '', hsn: String(inv.hsn_sac || '').trim(), qty: +inv.quantity || 0, unit: inv.unit || '', taxable: c2(inv.taxable != null ? inv.taxable : (+inv.amount || 0) - (+inv.cgst || 0) - (+inv.sgst || 0) - (+inv.igst || 0)), rate: +inv.gst_rate || 0, cgst: c2(inv.cgst), sgst: c2(inv.sgst), igst: c2(inv.igst)}];
  };
  const posOf = (inv, party) => G.stateCodeByName(inv.place_of_supply) || stOf(party && party.gstin) || G.stateCodeByName(party && party.state) || own;
  const typeOf = p => G.gstTypeOf(p);
  return {S, G, own, parties, invById, linesOf, posOf, typeOf, gstin: String(S.gstin || '').trim().toUpperCase()};
}
const UQC = {nos: 'NOS', no: 'NOS', numbers: 'NOS', pcs: 'PCS', piece: 'PCS', pieces: 'PCS', kg: 'KGS', kgs: 'KGS', mtr: 'MTR', m: 'MTR', meter: 'MTR', ltr: 'LTR', l: 'LTR', litre: 'LTR', box: 'BOX', set: 'SET', pair: 'PRS', hrs: 'OTH', hour: 'OTH'};
const uqcOf = (unit, hsn) => /^99/.test(hsn) ? 'NA' : (UQC[String(unit || '').trim().toLowerCase()] || 'OTH');

/* ---------------------------------------------------------------- GSTR-1 ---- */
const b2clLimit = date => String(date || '') >= '2024-08-01' ? 100000 : 250000;   /* Notification 12/2024-CT: inter-state B2C invoices above 1 lakh from 1 Aug 2024 (2.5 lakh before) */
const mergeRate = lines => { const m = new Map(); for (const l of lines) { const o = m.get(l.rate) || {rate: l.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0}; o.taxable += l.taxable; o.igst += l.igst; o.cgst += l.cgst; o.sgst += l.sgst; m.set(l.rate, o); } return [...m.values()].map(o => ({rate: o.rate, taxable: c2(o.taxable), igst: c2(o.igst), cgst: c2(o.cgst), sgst: c2(o.sgst)})).sort((a, b) => a.rate - b.rate); };
/* opts: {hsnDigits: 4 | 6 | 8}  minimum HSN length for Table 12 (4 up to Rs 5 crore turnover, 6 above). */
function gstr1(data, from, to, opts) {
  opts = opts || {};
  const C = context(data), warn = [];
  const W = (m, ref) => warn.push({message: m, ref: ref || ''});
  if (!C.gstin) W('Your own GSTIN is not set in Settings > Business & GST Details.');
  else { const PC_ = root.PC || (typeof require !== 'undefined' ? require('./practice-core.js') : null); const pr = PC_ && PC_.gstinProblem(C.gstin); if (pr) W('Your GSTIN in Settings looks wrong: ' + pr); }
  if (!C.own) W('Your own state could not be worked out, so inter-state supplies cannot be told from local ones.');
  const out = {from, to, fp: fp(to), b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], nil: [], exp: [], hsn: {b2b: [], b2c: []}, docs: [], warnings: warn, totals: {}, hsnDigits: opts.hsnDigits || 4};
  const sales = (data.invoices || []).filter(i => i.kind === 'sale' && inRange(i.date, from, to)).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.number).localeCompare(String(b.number), undefined, {numeric: true}));
  const b2cs = new Map(), nil = {}, hsn = {b2b: new Map(), b2c: new Map()};
  const key = (l) => [l.hsn, uqcOf(l.unit, l.hsn), l.rate].join('|');
  const hsnRow = (bucket, l) => { const k = key(l); let o = hsn[bucket].get(k); if (!o) { o = {hsn: l.hsn, desc: l.description, uqc: uqcOf(l.unit, l.hsn), rate: l.rate, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0}; hsn[bucket].set(k, o); } return o; };
  const addHsn = (bucket, l) => { if (!l.hsn) return; const o = hsnRow(bucket, l); o.qty += /^99/.test(l.hsn) ? 0 : l.qty; o.taxable += l.taxable; o.igst += l.igst; o.cgst += l.cgst; o.sgst += l.sgst; };
  const bucketOf = new Map(), b2clNos = new Set(), invType = new Map();
  for (const inv of sales) {
    const party = C.parties.get(inv.party_id), type = C.typeOf(party), pos = C.posOf(inv, party), inter = !!C.own && pos !== C.own, lines = C.linesOf(inv);
    const ref = inv.number;
    if (!inv.number) W('A sales invoice dated ' + inv.date + ' has no number.');
    if (!party) { W('Invoice ' + ref + ' has no customer.', ref); continue; }
    if (!pos) W('Invoice ' + ref + ': place of supply could not be worked out.', ref);
    if (lines.some(l => !l.hsn && l.taxable > 0)) W('Invoice ' + ref + ' has a line without an HSN / SAC code. Table 12 needs it.', ref);
    const igstSeen = lines.some(l => l.igst > 0), cgstSeen = lines.some(l => l.cgst > 0 || l.sgst > 0);
    if (C.own && inter && cgstSeen) W('Invoice ' + ref + ' is inter-state (place of supply ' + pos + ') but carries CGST/SGST.', ref);
    if (C.own && !inter && igstSeen) W('Invoice ' + ref + ' is local (place of supply ' + pos + ') but carries IGST.', ref);
    const val = c2(inv.amount), rch = inv.reverse_charge ? 'Y' : 'N', g = String(party.gstin || '').trim().toUpperCase();
    const registered = (type === 'regular' || type === 'composition' || type === 'sez') && g;
    const bucket = registered ? 'b2b' : 'b2c'; bucketOf.set(inv.id, bucket); lines.forEach(l => addHsn(bucket, l));
    if (type === 'overseas') { const rows = mergeRate(lines); out.exp.push({number: inv.number, date: inv.date, customer: party.name, gstin: '', type, expType: rows.some(x => x.igst > 0) ? 'WPAY' : 'WOPAY', value: val, taxable: sum(lines, l => l.taxable), igst: sum(lines, l => l.igst), rows}); continue; }
    if (type === 'sez' && !g) { W('SEZ customer ' + party.name + ' has no GSTIN, so invoice ' + ref + ' is left out of the tables. Add the GSTIN to the customer.', ref); continue; }
    const taxLines = lines.filter(l => l.rate > 0 || l.cgst > 0 || l.sgst > 0 || l.igst > 0), nilLines = lines.filter(l => !(l.rate > 0 || l.cgst > 0 || l.sgst > 0 || l.igst > 0));
    nilLines.forEach(l => { const k = (inter ? 'inter' : 'intra') + '|' + (registered ? 'reg' : 'unreg'); nil[k] = c2((nil[k] || 0) + l.taxable); });
    if (!taxLines.length) continue;
    if ((type === 'regular' || type === 'composition') && !g) W('Customer ' + party.name + ' is marked registered but has no GSTIN (invoice ' + ref + '). It is reported as a consumer sale until you add it.', ref);
    if (g && type === 'unregistered') W('Customer ' + party.name + ' has a GSTIN but is marked unregistered. Invoice ' + ref + ' is reported as business-to-consumer.', ref);
    if (registered) {
      if (g === C.gstin) W('Invoice ' + ref + ' is to your own GSTIN.', ref);
      const it = type === 'sez' ? (taxLines.some(l => l.igst > 0) ? 'SEWP' : 'SEWOP') : 'R'; invType.set(inv.id, it);
      out.b2b.push({gstin: g, name: party.name, number: inv.number, date: inv.date, value: val, pos, rchrg: rch, invType: it, rows: mergeRate(taxLines)});
    } else if (inter && val > b2clLimit(inv.date)) {
      b2clNos.add(inv.id);
      out.b2cl.push({pos, number: inv.number, date: inv.date, value: val, customer: party.name, rows: mergeRate(taxLines).map(r => ({rate: r.rate, taxable: r.taxable, igst: r.igst}))});
    } else {
      for (const l of taxLines) { const k = (inter ? 'INTER' : 'INTRA') + '|' + pos + '|' + l.rate, o = b2cs.get(k) || {type: inter ? 'INTER' : 'INTRA', pos, rate: l.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0}; o.taxable += l.taxable; o.igst += l.igst; o.cgst += l.cgst; o.sgst += l.sgst; b2cs.set(k, o); }
    }
  }
  /* credit / debit notes on sales: tables 9B and, for the HSN summary, a reduction of the original lines */
  const notes = (data.notes || []).filter(n => inRange(n.date, from, to));
  let qtyNote = false;
  for (const n of notes) {
    const inv = C.invById.get(n.invoice_id); if (!inv || inv.kind !== 'sale') continue;
    const party = C.parties.get(inv.party_id) || {}, type = C.typeOf(party), pos = C.posOf(inv, party), inter = !!C.own && pos !== C.own;
    const tax = c2((+n.cgst || 0) + (+n.sgst || 0) + (+n.igst || 0)), rate = nearRate(+n.taxable ? tax / +n.taxable * 100 : 0), ty = n.kind === 'credit' ? 'C' : 'D', sg = ty === 'C' ? -1 : 1;
    const g = String(party.gstin || '').trim().toUpperCase(), registered = (type === 'regular' || type === 'composition' || type === 'sez') && g;
    const row = {ntty: ty, number: n.number, date: n.date, origNo: inv.number, origDate: inv.date, value: c2(n.amount), pos, reason: n.reason || '', rate, taxable: c2(n.taxable), igst: c2(n.igst), cgst: c2(n.cgst), sgst: c2(n.sgst)};
    if (registered) out.cdnr.push({...row, gstin: g, name: party.name, rchrg: inv.reverse_charge ? 'Y' : 'N', invType: type === 'sez' ? (+n.igst > 0 ? 'SEWP' : 'SEWOP') : 'R'});
    else if (type === 'overseas') W('Note ' + n.number + ' is against an export invoice. Report it in the export notes of the return yourself.', n.number);
    else if (b2clNos.has(inv.id) || (inter && c2(inv.amount) > b2clLimit(inv.date))) out.cdnur.push({...row, customer: party.name, urType: 'B2CL'});
    else {
      const k = (inter ? 'INTER' : 'INTRA') + '|' + pos + '|' + rate, o = b2cs.get(k) || {type: inter ? 'INTER' : 'INTRA', pos, rate, taxable: 0, igst: 0, cgst: 0, sgst: 0};
      o.taxable += sg * row.taxable; o.igst += sg * row.igst; o.cgst += sg * row.cgst; o.sgst += sg * row.sgst; b2cs.set(k, o);
      W('Credit/debit note ' + n.number + ' (to a consumer) is netted against the consumer sales table (B2CS).', n.number);
    }
    /* HSN summary: spread the note over the original invoice's lines in proportion to their taxable value */
    const bucket = registered ? 'b2b' : 'b2c', ol = C.linesOf(inv).filter(l => l.hsn), base = ol.reduce((s, l) => s + l.taxable, 0);
    if (!ol.length || !(base > 0)) { W('Note ' + n.number + ' could not be taken off the HSN summary because the original invoice ' + inv.number + ' has no HSN / SAC code.', n.number); continue; }
    for (const l of ol) { const sh = l.taxable / base, o = hsnRow(bucket, l); o.taxable += sg * row.taxable * sh; o.igst += sg * row.igst * sh; o.cgst += sg * row.cgst * sh; o.sgst += sg * row.sgst * sh; if (!/^99/.test(l.hsn) && ty === 'C') qtyNote = true; }
  }
  if (qtyNote) W('Credit notes reduce the value in the HSN summary but not the quantity. If goods were returned, reduce the quantity of that HSN yourself.');
  out.b2cs = [...b2cs.values()].map(o => ({...o, taxable: c2(o.taxable), igst: c2(o.igst), cgst: c2(o.cgst), sgst: c2(o.sgst)})).filter(o => o.taxable || o.igst || o.cgst || o.sgst).sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);
  out.nil = [['Intra-state supplies to registered persons', 'intra|reg'], ['Intra-state supplies to unregistered persons', 'intra|unreg'], ['Inter-state supplies to registered persons', 'inter|reg'], ['Inter-state supplies to unregistered persons', 'inter|unreg']].map(([label, k]) => ({label, taxable: nil[k] || 0}));
  for (const b of ['b2b', 'b2c']) {
    out.hsn[b] = [...hsn[b].values()].map(o => {
      const t = c2(o.taxable), neg = t < 0 || o.igst < -0.005 || o.cgst < -0.005 || o.sgst < -0.005;
      if (neg) W('HSN ' + o.hsn + ' at ' + o.rate + '% (' + (b === 'b2b' ? 'registered' : 'consumers') + '): credit notes are larger than the supplies in this period. It is shown as zero because the portal does not accept negative values. Carry the difference to the next period.');
      const z = x => neg ? 0 : c2(x), tx = z(o.taxable), ig = z(o.igst), cg = z(o.cgst), sg_ = z(o.sgst);
      return {...o, qty: c2(o.qty), taxable: tx, igst: ig, cgst: cg, sgst: sg_, val: c2(tx + ig + cg + sg_)}; })
      .filter(o => o.taxable || o.igst || o.cgst || o.sgst).sort((a, c) => a.hsn.localeCompare(c.hsn) || a.rate - c.rate);
  }
  /* document series issued */
  const series = (label, list) => {
    const g = new Map();
    for (const x of list) { const no = String(x.number || ''), pre = no.replace(/\d+$/, ''), n = parseInt((no.match(/\d+$/) || ['0'])[0], 10); const o = g.get(pre) || {label, from: no, to: no, lo: n, hi: n, count: 0}; if (n < o.lo) { o.lo = n; o.from = no; } if (n > o.hi) { o.hi = n; o.to = no; } o.count++; g.set(pre, o); }
    return [...g.values()].map(o => ({label: o.label, from: o.from, to: o.to, total: o.count, cancelled: 0, net: o.count, gaps: Math.max(0, o.hi - o.lo + 1 - o.count)}));
  };
  const nOf = k => notes.filter(n => (C.invById.get(n.invoice_id) || {}).kind === 'sale' && n.kind === k);
  out.docs = [...series('Invoices for outward supply', sales), ...series('Credit Note', nOf('credit')), ...series('Debit Note', nOf('debit'))];
  out.docs.filter(d => d.gaps > 0).forEach(d => W(d.label + ' ' + d.from + ' to ' + d.to + ': ' + d.gaps + ' number(s) in the range are not in your books. Report them as cancelled in Table 13 if they were used.'));
  W('Advance receipts (table 11), supplies on which the operator pays the tax (section 9(5)) and amendments of earlier months are not covered. Add them in the return if you have any. Supplies through an e-commerce operator are covered by the E-commerce Sales page.');
  if (out.nil.some(x => x.taxable)) W('Nil-rated, exempted and non-GST supplies are not told apart. All zero-rate sales are put under "nil rated". Move any exempted or non-GST amount in the return.');
  const T = (a, f) => sum(a, f), rowsOf = list => list.flatMap(x => x.rows);
  out.totals = {
    b2b: {count: out.b2b.length, taxable: T(rowsOf(out.b2b), r => r.taxable), igst: T(rowsOf(out.b2b), r => r.igst), cgst: T(rowsOf(out.b2b), r => r.cgst), sgst: T(rowsOf(out.b2b), r => r.sgst)},
    b2cl: {count: out.b2cl.length, taxable: T(rowsOf(out.b2cl), r => r.taxable), igst: T(rowsOf(out.b2cl), r => r.igst)},
    b2cs: {taxable: T(out.b2cs, r => r.taxable), igst: T(out.b2cs, r => r.igst), cgst: T(out.b2cs, r => r.cgst), sgst: T(out.b2cs, r => r.sgst)},
    cdnr: {count: out.cdnr.length, taxable: T(out.cdnr, r => (r.ntty === 'C' ? -1 : 1) * r.taxable)},
    nil: T(out.nil, r => r.taxable), invoices: sales.length};
  return out;
}

/* ---------------------------------------------------------------- checks before upload ---- */
const DOCNO_RE = /^[A-Za-z0-9\/-]{1,16}$/, POS_RE = /^(0[1-9]|[12]\d|3[0-8]|97|99)$/, GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const OK_RATES = new Set([0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 14, 18, 28, 40]);
const gstinOk = g => { const P = root.PC || (typeof require !== 'undefined' ? require('./practice-core.js') : null); return GSTIN_RE.test(g) && (!P || !P.gstinProblem(g)); };
/* Problems that make the portal reject a file ("File could not be uploaded... download the latest version of the offline tool" is its usual, unhelpful message).
   level 'error' = fix before upload; 'warn' = look at it. */
function validate1(r, opt) {
  opt = opt || {}; const out = [], E = (m, ref) => out.push({level: 'error', message: m, ref: ref || ''}), Wn = (m, ref) => out.push({level: 'warn', message: m, ref: ref || ''});
  if (!opt.gstin || !gstinOk(String(opt.gstin).toUpperCase())) E('Your own GSTIN in Settings is missing or invalid.');
  if (!/^(0[1-9]|1[0-2])\d{4}$/.test(r.fp || '')) E('The return period could not be worked out.');
  const seen = new Map(), chkNo = (no, what) => { if (!DOCNO_RE.test(String(no || ''))) E(what + ' number "' + no + '" is not allowed. Use only letters, digits, "/" and "-", at most 16 characters (no spaces or dots).', no); const k = what.split(' ')[0] + '|' + String(no).toLowerCase(); if (seen.has(k)) E(what + ' number "' + no + '" appears twice.', no); seen.set(k, 1); };
  const rate = (rt, ref) => { if (!OK_RATES.has(+rt)) E('Rate ' + rt + '% on ' + ref + ' is not a rate the portal accepts.', ref); };
  const taxCheck = (rows, ref) => rows.forEach(x => { rate(x.rate, ref); const exp = c2(x.taxable * x.rate / 100), got = c2((x.igst || 0) + (x.cgst || 0) + (x.sgst || 0)); if (Math.abs(exp - got) > 1.01) Wn('Tax on ' + ref + ' at ' + x.rate + '% is ' + got + ' but ' + exp + ' is expected from the taxable value. The portal recalculates and may reject a difference of more than Rs 1.', ref); if ((x.igst || 0) > 0 && ((x.cgst || 0) > 0 || (x.sgst || 0) > 0)) E(ref + ' has both IGST and CGST/SGST on the same rate.', ref); if (x.taxable < 0) E(ref + ' has a negative taxable value.', ref); });
  r.b2b.forEach(x => { chkNo(x.number, 'Invoice'); if (!gstinOk(x.gstin)) E('Recipient GSTIN ' + x.gstin + ' (invoice ' + x.number + ') is not valid.', x.number); if (!POS_RE.test(x.pos || '')) E('Invoice ' + x.number + ' has no valid place of supply.', x.number); taxCheck(x.rows, 'invoice ' + x.number); });
  r.b2cl.forEach(x => { chkNo(x.number, 'Invoice'); if (!POS_RE.test(x.pos || '')) E('Invoice ' + x.number + ' has no valid place of supply.', x.number); taxCheck(x.rows, 'invoice ' + x.number); });
  r.b2cs.forEach(x => { if (!POS_RE.test(x.pos || '')) E('A consumer sale has no valid place of supply.'); rate(x.rate, 'consumer sales'); if (x.taxable < 0 || x.igst < 0 || x.cgst < 0 || x.sgst < 0) Wn('Consumer sales for place of supply ' + x.pos + ' at ' + x.rate + '% come to a negative amount (returns of earlier sales). The portal may refuse a negative line: check it after upload.', x.pos); });
  r.cdnr.forEach(x => { chkNo(x.number, 'Note'); if (!gstinOk(x.gstin)) E('Recipient GSTIN ' + x.gstin + ' (note ' + x.number + ') is not valid.', x.number); });
  r.cdnur.forEach(x => { chkNo(x.number, 'Note'); Wn('Note ' + x.number + ' is a credit/debit note to a consumer above the large-invoice limit. Check the CDNUR table after uploading.', x.number); });
  r.exp.forEach(x => { chkNo(x.number, 'Invoice'); taxCheck(x.rows, 'export invoice ' + x.number); });
  const dg = opt.hsnDigits || r.hsnDigits || 4;
  for (const b of ['b2b', 'b2c']) r.hsn[b].forEach(x => { if (!/^\d+$/.test(x.hsn) || ![4, 6, 8].includes(x.hsn.length) && x.hsn.length < dg) E('HSN / SAC "' + x.hsn + '" must be at least ' + dg + ' digits.', x.hsn); else if (x.hsn.length < dg) E('HSN / SAC "' + x.hsn + '" must be at least ' + dg + ' digits.', x.hsn); if (/^99/.test(x.hsn) ? false : (!x.uqc || x.uqc === 'NA')) Wn('HSN ' + x.hsn + ' is goods but has no unit. Set the unit (nos, kg, ...) on the invoice line.', x.hsn); rate(x.rate, 'HSN ' + x.hsn); });
  ((r.supeco && r.supeco.clttx) || []).forEach(x => { if (!gstinOk(x.etin)) E('Operator GSTIN ' + x.etin + ' (Table 14) is not valid.', x.etin); });
  r.docs.forEach(d => { if (!DOCNO_RE.test(d.from) || !DOCNO_RE.test(d.to)) E('Documents issued: "' + d.from + '" to "' + d.to + '" has a number the portal does not allow.', d.from); });
  return out;
}

/* ---------------------------------------------------------------- GSTR-3B ---- */
const H3 = () => ({taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0});
const add3 = (o, t, i, c, s, sg) => { sg = sg || 1; o.taxable += sg * t; o.igst += sg * i; o.cgst += sg * c; o.sgst += sg * s; };
const fix3 = o => { for (const k of Object.keys(o)) o[k] = c2(o[k]); return o; };
/* Set-off of the tax payable against the credit, in the order the Act requires: IGST credit pays IGST, then CGST, then SGST; CGST credit pays CGST then IGST;
   SGST credit pays SGST then IGST. CGST credit can never pay SGST and vice versa. Tax under reverse charge is paid in cash only. */
function setoff(liab, itc, cashOnly) {
  const L = {igst: c2(liab.igst), cgst: c2(liab.cgst), sgst: c2(liab.sgst)}, A = {igst: c2(itc.igst), cgst: c2(itc.cgst), sgst: c2(itc.sgst)};
  const used = {igst: {igst: 0, cgst: 0, sgst: 0}, cgst: {igst: 0, cgst: 0}, sgst: {igst: 0, sgst: 0}};
  const take = (from, to, set) => { const x = Math.min(A[from], L[to]); if (x > 0) { A[from] = c2(A[from] - x); L[to] = c2(L[to] - x); set[to] = c2(set[to] + x); } };
  take('igst', 'igst', used.igst); take('igst', 'cgst', used.igst); take('igst', 'sgst', used.igst);
  take('cgst', 'cgst', used.cgst); take('cgst', 'igst', used.cgst);
  take('sgst', 'sgst', used.sgst); take('sgst', 'igst', used.sgst);
  const cashR = {igst: c2(cashOnly.igst), cgst: c2(cashOnly.cgst), sgst: c2(cashOnly.sgst)};
  return {itcUsed: used, cashForOutward: L, cashForRcm: cashR, cash: {igst: c2(L.igst + cashR.igst), cgst: c2(L.cgst + cashR.cgst), sgst: c2(L.sgst + cashR.sgst)}, carryForward: A};
}
function gstr3b(data, from, to) {
  const C = context(data), warn = [], W = (m, ref) => warn.push({message: m, ref: ref || ''});
  const o = {from, to, fp: fp(to), warnings: warn};
  const a = H3(), zero = H3(), rcm = H3(), nil = {taxable: 0}, nongst = {taxable: 0}, unreg = new Map(), comp = new Map();
  const sales = (data.invoices || []).filter(i => i.kind === 'sale' && inRange(i.date, from, to));
  for (const inv of sales) {
    const party = C.parties.get(inv.party_id), type = C.typeOf(party), pos = C.posOf(inv, party), inter = !!C.own && pos !== C.own;
    for (const l of C.linesOf(inv)) {
      const taxed = l.rate > 0 || l.cgst > 0 || l.sgst > 0 || l.igst > 0;
      if (type === 'overseas' || type === 'sez') { add3(zero, l.taxable, l.igst, 0, 0); continue; }
      if (!taxed) { nil.taxable += l.taxable; continue; }
      if (inv.reverse_charge) { add3(a, l.taxable, 0, 0, 0); continue; }  /* recipient pays the tax */
      add3(a, l.taxable, l.igst, l.cgst, l.sgst);
      if (inter && !(party && party.gstin) && type !== 'composition') { const x = unreg.get(pos) || {pos, taxable: 0, igst: 0}; x.taxable += l.taxable; x.igst += l.igst; unreg.set(pos, x); }
      if (inter && type === 'composition') { const x = comp.get(pos) || {pos, taxable: 0, igst: 0}; x.taxable += l.taxable; x.igst += l.igst; comp.set(pos, x); }
    }
    if (inv.reverse_charge) W('Sales invoice ' + inv.number + ' is on reverse charge: its taxable value is in 3.1(a) with no tax. Check this against your records.', inv.number);
  }
  const notes = (data.notes || []).filter(n => inRange(n.date, from, to)); let outCN = 0, inDN = H3();
  for (const n of notes) {
    const inv = C.invById.get(n.invoice_id); if (!inv) continue;
    if (inv.kind === 'sale') { const sg = n.kind === 'credit' ? -1 : 1; add3(a, +n.taxable, +n.igst, +n.cgst, +n.sgst, sg); outCN++; const party = C.parties.get(inv.party_id) || {}, pos = C.posOf(inv, party); if (C.own && pos !== C.own && !party.gstin) { const x = unreg.get(pos) || {pos, taxable: 0, igst: 0}; x.taxable += sg * (+n.taxable); x.igst += sg * (+n.igst); unreg.set(pos, x); } }
    else add3(inDN, +n.taxable, +n.igst, +n.cgst, +n.sgst);
  }
  const itc = H3(), itcRcm = H3(), inelig = H3(); let rcmN = 0;
  for (const b of (data.invoices || []).filter(i => i.kind === 'purchase' && inRange(i.date, from, to))) {
    const party = C.parties.get(b.party_id), lines = C.linesOf(b);
    const t = sum(lines, l => l.taxable), i = sum(lines, l => l.igst), c = sum(lines, l => l.cgst), s = sum(lines, l => l.sgst);
    if (b.reverse_charge) {
      add3(rcm, t, i, c, s); rcmN++;
      if (b.itc_blocked) add3(inelig, 0, i, c, s); else add3(itcRcm, 0, i, c, s);
    } else if (b.itc_blocked) add3(inelig, 0, i, c, s);
    else {
      add3(itc, 0, i, c, s);
      if (!(party && party.gstin) && (i + c + s) > 0) W('Purchase bill ' + b.number + ' carries tax but the supplier has no GSTIN. ITC is claimed here, but it cannot be claimed without a valid GSTIN.', b.number);
    }
  }
  if (rcmN) W(rcmN + ' purchase bill(s) are on reverse charge. The tax stored on each bill is used as the tax payable. Confirm the amounts.');
  o.t31 = {a: fix3(a), b: fix3(zero), c: fix3({taxable: nil.taxable}), d: fix3(rcm), e: fix3({taxable: nongst.taxable})};
  o.t32 = {unreg: [...unreg.values()].map(x => ({pos: x.pos, taxable: c2(x.taxable), igst: c2(x.igst)})).filter(x => x.taxable || x.igst), comp: [...comp.values()].map(x => ({pos: x.pos, taxable: c2(x.taxable), igst: c2(x.igst)})).filter(x => x.taxable || x.igst)};
  const reversal = fix3({...H3(), igst: inDN.igst, cgst: inDN.cgst, sgst: inDN.sgst});
  const avail = {igst: c2(itc.igst + itcRcm.igst), cgst: c2(itc.cgst + itcRcm.cgst), sgst: c2(itc.sgst + itcRcm.sgst)};
  o.t4 = {a3: fix3({...itcRcm}), a5: fix3({...itc}), availTotal: avail, b2: reversal, net: {igst: c2(avail.igst - reversal.igst), cgst: c2(avail.cgst - reversal.cgst), sgst: c2(avail.sgst - reversal.sgst)}, ineligible: fix3({...inelig})};
  if (o.t4.net.igst < 0 || o.t4.net.cgst < 0 || o.t4.net.sgst < 0) W('Debit notes on purchases reverse more ITC than was claimed this period. The excess is carried to the next period; check it.');
  const net = {igst: Math.max(0, o.t4.net.igst), cgst: Math.max(0, o.t4.net.cgst), sgst: Math.max(0, o.t4.net.sgst)};
  o.t61 = setoff({igst: a.igst, cgst: a.cgst, sgst: a.sgst}, net, {igst: rcm.igst, cgst: rcm.cgst, sgst: rcm.sgst});
  o.t61.outward = {igst: c2(a.igst), cgst: c2(a.cgst), sgst: c2(a.sgst)}; o.t61.rcm = {igst: c2(rcm.igst), cgst: c2(rcm.cgst), sgst: c2(rcm.sgst)};
  o.totals = {outwardTax: c2(a.igst + a.cgst + a.sgst), itcNet: c2(o.t4.net.igst + o.t4.net.cgst + o.t4.net.sgst), cash: c2(o.t61.cash.igst + o.t61.cash.cgst + o.t61.cash.sgst)};
  if (!C.gstin) W('Your own GSTIN is not set in Settings > Business & GST Details.');
  W('Imports, inward exempt supplies (table 5) and ITC from earlier periods are not computed. Add them in the return if they apply. Interest and late fee are worked out separately below.');
  return o;
}

/* ---------------------------------------------------------------- JSON for the GST portal / offline tool ---- */
/* Layout follows the GSTR-1 offline-tool JSON (header only gstin + fp; b2b / b2cl / b2cs / cdnr / cdnur / exp / nil / hsn {hsn_b2b, hsn_b2c} / doc_issue). */
const n2 = x => c2(x);
const itm = (n, l) => ({num: n, itm_det: {rt: l.rate, txval: n2(l.taxable), iamt: n2(l.igst || 0), camt: n2(l.cgst || 0), samt: n2(l.sgst || 0), csamt: 0}});
const by = (list, k) => { const m = new Map(); list.forEach(x => { if (!m.has(x[k])) m.set(x[k], []); m.get(x[k]).push(x); }); return m; };
const NIL_TY = [['INTRAB2B', 0], ['INTRAB2C', 1], ['INTRB2B', 2], ['INTRB2C', 3]];   /* r.nil order: intra|reg, intra|unreg, inter|reg, inter|unreg */
function gstr1Json(r, gstin) {
  const j = {gstin: String(gstin || '').toUpperCase(), fp: r.fp};
  if (r.b2b.length) j.b2b = [...by(r.b2b, 'gstin')].map(([ctin, inv]) => ({ctin, inv: inv.map(x => ({inum: x.number, idt: dmy(x.date), val: n2(x.value), pos: x.pos, rchrg: x.rchrg, inv_typ: x.invType, itms: x.rows.map((l, i) => itm(i + 1, l))}))}));
  if (r.b2cl.length) j.b2cl = [...by(r.b2cl, 'pos')].map(([pos, inv]) => ({pos, inv: inv.map(x => ({inum: x.number, idt: dmy(x.date), val: n2(x.value), itms: x.rows.map((l, i) => itm(i + 1, {rate: l.rate, taxable: l.taxable, igst: l.igst}))}))}));
  if (r.b2cs.length) j.b2cs = r.b2cs.map(x => x.type === 'INTER'
    ? {sply_ty: 'INTER', pos: x.pos, typ: 'OE', rt: x.rate, txval: n2(x.taxable), iamt: n2(x.igst), csamt: 0}
    : {sply_ty: 'INTRA', pos: x.pos, typ: 'OE', rt: x.rate, txval: n2(x.taxable), camt: n2(x.cgst), samt: n2(x.sgst), csamt: 0});
  if (r.cdnr.length) j.cdnr = [...by(r.cdnr, 'gstin')].map(([ctin, nt]) => ({ctin, nt: nt.map(x => ({ntty: x.ntty, nt_num: x.number, nt_dt: dmy(x.date), val: n2(x.value), pos: x.pos, rchrg: x.rchrg, inv_typ: x.invType, itms: [itm(1, x)]}))}));
  if (r.cdnur.length) j.cdnur = r.cdnur.map(x => ({typ: x.urType, ntty: x.ntty, nt_num: x.number, nt_dt: dmy(x.date), val: n2(x.value), pos: x.pos, itms: [itm(1, x)]}));
  if (r.exp.length) { const g = new Map(); r.exp.forEach(x => { if (!g.has(x.expType)) g.set(x.expType, []); g.get(x.expType).push(x); }); j.exp = [...g].map(([ex_tp, inv]) => ({exp_typ: ex_tp, inv: inv.map(x => ({inum: x.number, idt: dmy(x.date), val: n2(x.value), itms: x.rows.map(l => ({txval: n2(l.taxable), rt: l.rate, iamt: n2(l.igst || 0), csamt: 0}))}))})); }
  if (r.supeco && r.supeco.clttx && r.supeco.clttx.length) j.supeco = {clttx: r.supeco.clttx.map(x => ({etin: x.etin, suppval: n2(x.suppval), igst: n2(x.igst), cgst: n2(x.cgst), sgst: n2(x.sgst), cess: 0}))};
  if (r.nil.some(x => x.taxable)) j.nil = {inv: NIL_TY.map(([t, i]) => ({sply_ty: t, expt_amt: 0, nil_amt: n2(r.nil[i].taxable), ngsup_amt: 0}))};
  const hs = list => list.map((x, i) => ({num: i + 1, hsn_sc: x.hsn, desc: String(x.desc || '').slice(0, 30), uqc: x.uqc, qty: /^99/.test(x.hsn) ? 0 : n2(x.qty), rt: x.rate, txval: n2(x.taxable), iamt: n2(x.igst), camt: n2(x.cgst), samt: n2(x.sgst), csamt: 0}));
  if (r.hsn.b2b.length || r.hsn.b2c.length) j.hsn = {hsn_b2b: hs(r.hsn.b2b), hsn_b2c: hs(r.hsn.b2c)};
  if (r.docs.length) { const typ = {'Invoices for outward supply': 1, 'Debit Note': 4, 'Credit Note': 5}; const m = new Map(); r.docs.forEach(d => { const n = typ[d.label]; if (!m.has(n)) m.set(n, {doc_num: n, doc_typ: d.label, docs: []}); const o = m.get(n); o.docs.push({num: o.docs.length + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.net}); }); j.doc_issue = {doc_det: [...m.values()]}; }
  return j;
}
/* opt.interest: {igst,cgst,samt..} amounts to put under "interest" in GSTR-3B (only when you tick the box) */
function gstr3bJson(r, gstin, opt) {
  opt = opt || {}; const z = x => x || {};
  const t = x => ({txval: n2(z(x).taxable), iamt: n2(z(x).igst), camt: n2(z(x).cgst), samt: n2(z(x).sgst), csamt: 0});
  const i = (ty, x) => ({ty, iamt: n2(z(x).igst), camt: n2(z(x).cgst), samt: n2(z(x).sgst), csamt: 0});
  const it = opt.interest || {};
  return {gstin: String(gstin || '').toUpperCase(), ret_period: r.fp,
    sup_details: {osup_det: t(r.t31.a), osup_zero: {txval: n2(r.t31.b.taxable), iamt: n2(r.t31.b.igst), csamt: 0}, osup_nil_exmp: {txval: n2(r.t31.c.taxable)}, isup_rev: t(r.t31.d), osup_nongst: {txval: n2(r.t31.e.taxable)}},
    inter_sup: {unreg_details: r.t32.unreg.map(x => ({pos: x.pos, txval: n2(x.taxable), iamt: n2(x.igst)})), comp_details: r.t32.comp.map(x => ({pos: x.pos, txval: n2(x.taxable), iamt: n2(x.igst)})), uin_details: []},
    itc_elg: {itc_avl: [i('IMPG', {}), i('IMPS', {}), i('ISRC', r.t4.a3), i('ISD', {}), i('OTH', r.t4.a5)], itc_rev: [i('RUL', {}), i('OTH', r.t4.b2)], itc_net: {iamt: n2(r.t4.net.igst), camt: n2(r.t4.net.cgst), samt: n2(r.t4.net.sgst), csamt: 0}, itc_inelg: [i('RUL', r.t4.ineligible), i('OTH', {})]},
    inward_sup: {isup_details: [{ty: 'GST', inter: 0, intra: 0}, {ty: 'NONGST', inter: 0, intra: 0}]},
    intr_ltfee: {intr_details: {iamt: n2(it.igst), camt: n2(it.cgst), samt: n2(it.sgst), csamt: 0}}};
}

/* ---------------------------------------------------------------- due dates, late fee and interest ---- */
const GROUP1 = new Set(['22', '23', '24', '25', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37']);   /* QRMP GSTR-3B: 22nd for these states/UTs, 24th for the rest */
const pad = n => String(n).padStart(2, '0');
/* type: 'gstr1' | 'gstr3b'; fp: 'MMYYYY'; freq: 'monthly' | 'qrmp'; stateCode: for the QRMP 22nd/24th rule. Returns 'YYYY-MM-DD' or ''. */
function dueDates(type, fpv, freq, stateCode) {
  const m = /^(\d{2})(\d{4})$/.exec(fpv || ''); if (!m) return '';
  let mo = +m[1], y = +m[2];
  if (freq === 'qrmp') { mo = Math.ceil(mo / 3) * 3; }   /* quarter-end month */
  mo += 1; if (mo > 12) { mo = 1; y++; }
  const day = type === 'gstr1' ? (freq === 'qrmp' ? 13 : 11) : (freq === 'qrmp' ? (GROUP1.has(String(stateCode)) ? 22 : 24) : 20);
  return y + '-' + pad(mo) + '-' + pad(day);
}
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const SLABS = {upto1_5: 2000, upto5: 5000, above5: 10000};
/* Defaults are the rates in force when written (Rs 25 + 25 a day, Rs 10 + 10 for nil; interest 18 %). They are editable because notifications change - verify before paying.
   p: {type, dueDate, filedDate, nil, slab: 'upto1_5'|'upto5'|'above5', cash: {igst,cgst,sgst} (tax paid in cash, i.e. net of ITC), itcExcess (optional, 24 % interest base),
       rates: {perDay, perDayNil, interestPct, itcInterestPct, caps}} */
function lateFeeInterest(p) {
  p = p || {}; const rt = Object.assign({perDay: 50, perDayNil: 20, interestPct: 18, itcInterestPct: 24, caps: {nil: 500, upto1_5: 2000, upto5: 5000, above5: 10000}}, p.rates || {});
  const res = {days: 0, late: false, lateFee: {total: 0, cgst: 0, sgst: 0, capped: false, cap: 0}, interest: {igst: 0, cgst: 0, sgst: 0, total: 0, itc: 0}, rates: rt};
  if (!p.dueDate || !p.filedDate) return res;
  const d = daysBetween(p.dueDate, p.filedDate); if (!(d > 0)) return res;
  res.days = d; res.late = true;
  const cap = p.nil ? rt.caps.nil : (rt.caps[p.slab] != null ? rt.caps[p.slab] : rt.caps.upto1_5), raw = d * (p.nil ? rt.perDayNil : rt.perDay), tot = c2(Math.min(raw, cap));
  res.lateFee = {total: tot, cgst: c2(tot / 2), sgst: c2(tot - c2(tot / 2)), capped: raw > cap, cap};
  if (p.type === 'gstr3b') {
    const cash = p.cash || {}, f = x => c2(Math.max(0, +x || 0) * rt.interestPct / 100 * d / 365);
    res.interest = {igst: f(cash.igst), cgst: f(cash.cgst), sgst: f(cash.sgst), total: 0, itc: p.itcExcess > 0 ? c2(p.itcExcess * rt.itcInterestPct / 100 * d / 365) : 0};
    res.interest.total = c2(res.interest.igst + res.interest.cgst + res.interest.sgst + res.interest.itc);
  }
  return res;
}

/* ---------------------------------------------------------------- tables for CSV / Excel ---- */
function gstr1Sheets(r) {
  const S = {};
  S['B2B'] = [['GSTIN of recipient', 'Receiver name', 'Invoice number', 'Invoice date', 'Invoice value', 'Place of supply', 'Reverse charge', 'Invoice type', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST']]
    .concat(r.b2b.flatMap(x => x.rows.map(l => [x.gstin, x.name, x.number, dmy(x.date), x.value, x.pos, x.rchrg, x.invType, l.rate, l.taxable, l.igst, l.cgst, l.sgst])));
  S['B2CL'] = [['Place of supply', 'Invoice number', 'Invoice date', 'Invoice value', 'Customer', 'Rate %', 'Taxable value', 'IGST']].concat(r.b2cl.flatMap(x => x.rows.map(l => [x.pos, x.number, dmy(x.date), x.value, x.customer, l.rate, l.taxable, l.igst])));
  S['B2CS'] = [['Type', 'Place of supply', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST']].concat(r.b2cs.map(x => [x.type, x.pos, x.rate, x.taxable, x.igst, x.cgst, x.sgst]));
  S['CDNR'] = [['GSTIN of recipient', 'Receiver name', 'Note number', 'Note date', 'Note type', 'Original invoice', 'Original date', 'Place of supply', 'Note value', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Reason']].concat(r.cdnr.map(x => [x.gstin, x.name, x.number, dmy(x.date), x.ntty === 'C' ? 'Credit' : 'Debit', x.origNo, dmy(x.origDate), x.pos, x.value, x.rate, x.taxable, x.igst, x.cgst, x.sgst, x.reason]));
  S['CDNUR'] = [['Note number', 'Note date', 'Note type', 'Original invoice', 'Place of supply', 'Note value', 'Rate %', 'Taxable value', 'IGST', 'Customer']].concat(r.cdnur.map(x => [x.number, dmy(x.date), x.ntty === 'C' ? 'Credit' : 'Debit', x.origNo, x.pos, x.value, x.rate, x.taxable, x.igst, x.customer]));
  S['Nil-Exempt'] = [['Description', 'Nil-rated / exempt value']].concat(r.nil.map(x => [x.label, x.taxable]));
  S['Exports-SEZ'] = [['Invoice number', 'Date', 'Customer', 'Type', 'Invoice value', 'Taxable value', 'IGST']].concat(r.exp.map(x => [x.number, dmy(x.date), x.customer, x.type, x.value, x.taxable, x.igst]));
  const hs = (list) => [['HSN / SAC', 'Description', 'UQC', 'Quantity', 'Rate %', 'Total value', 'Taxable value', 'IGST', 'CGST', 'SGST']].concat(list.map(x => [x.hsn, x.desc, x.uqc, x.qty, x.rate, x.val, x.taxable, x.igst, x.cgst, x.sgst]));
  S['HSN-B2B'] = hs(r.hsn.b2b); S['HSN-B2C'] = hs(r.hsn.b2c);
  if (r.supeco && r.supeco.clttx && r.supeco.clttx.length) S['Table14-ECO'] = [['Operator GSTIN', 'Operator', 'Net taxable value', 'IGST', 'CGST', 'SGST']].concat(r.supeco.clttx.map(x => [x.etin, x.name || '', x.suppval, x.igst, x.cgst, x.sgst]));
  S['Documents'] = [['Document type', 'From', 'To', 'Total issued', 'Cancelled', 'Net issued', 'Numbers missing']].concat(r.docs.map(x => [x.label, x.from, x.to, x.total, x.cancelled, x.net, x.gaps]));
  return S;
}
function gstr3bSheet(r) {
  const row = (l, x) => [l, x.taxable == null ? '' : x.taxable, x.igst, x.cgst, x.sgst];
  const rows = [['Table', 'Taxable value', 'IGST', 'CGST', 'SGST'],
    row('3.1(a) Outward taxable supplies (other than zero rated, nil rated, exempted)', r.t31.a), row('3.1(b) Outward taxable supplies (zero rated)', r.t31.b), row('3.1(c) Other outward supplies (nil rated, exempted)', {taxable: r.t31.c.taxable, igst: '', cgst: '', sgst: ''}),
    row('3.1(d) Inward supplies (liable to reverse charge)', r.t31.d), row('3.1(e) Non-GST outward supplies', {taxable: r.t31.e.taxable, igst: '', cgst: '', sgst: ''}), [],
    ['3.2 Inter-state supplies to unregistered persons', 'Taxable value', 'IGST', '', ''], ...r.t32.unreg.map(x => ['  Place of supply ' + x.pos, x.taxable, x.igst, '', '']), [],
    ['4 Eligible ITC', '', 'IGST', 'CGST', 'SGST'], row('4(A)(3) Inward supplies liable to reverse charge', {taxable: '', ...r.t4.a3}), row('4(A)(5) All other ITC', {taxable: '', ...r.t4.a5}), row('4(B)(2) ITC reversed: others (debit notes)', {taxable: '', ...r.t4.b2}),
    row('4(C) Net ITC available', {taxable: '', ...r.t4.net}), row('4(D)(2) Ineligible ITC (not claimed)', {taxable: '', ...r.t4.ineligible}), [],
    ['6.1 Payment of tax', '', 'IGST', 'CGST', 'SGST'], row('Tax payable on outward supplies', {taxable: '', ...r.t61.outward}), row('Tax payable on reverse charge (cash only)', {taxable: '', ...r.t61.rcm}),
    ['Paid through IGST credit', '', r.t61.itcUsed.igst.igst, r.t61.itcUsed.igst.cgst, r.t61.itcUsed.igst.sgst], ['Paid through CGST credit', '', r.t61.itcUsed.cgst.igst, r.t61.itcUsed.cgst.cgst, ''], ['Paid through SGST credit', '', r.t61.itcUsed.sgst.igst, '', r.t61.itcUsed.sgst.sgst],
    row('Paid in cash', {taxable: '', ...r.t61.cash}), row('Credit carried forward', {taxable: '', ...r.t61.carryForward})];
  return {'GSTR-3B': rows};
}

/* ---------------------------------------------------------------- GSTR-2B reconciliation ---- */
const normNo = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
const toIso = s => { s = String(s == null ? '' : s).trim(); let m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(s); if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0'); m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[0]; m = /^(\d{1,2})[-\/ ]([A-Za-z]{3})[a-z]*[-\/ ](\d{2,4})$/.exec(s); if (m) { const mo = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(m[2].toLowerCase()); if (mo >= 0) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + String(mo + 1).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0'); } if (/^\d{5}$/.test(s)) { const t = new Date(Date.UTC(1899, 11, 30) + (+s) * 864e5); return t.toISOString().slice(0, 10); } return ''; };
const taxOf = x => ({taxable: c2(x.txval != null ? x.txval : x.taxable), igst: c2(x.igst != null ? x.igst : x.iamt), cgst: c2(x.cgst != null ? x.cgst : x.camt), sgst: c2(x.sgst != null ? x.sgst : x.samt)});
const sumTax = list => list.reduce((a, t) => ({taxable: c2(a.taxable + t.taxable), igst: c2(a.igst + t.igst), cgst: c2(a.cgst + t.cgst), sgst: c2(a.sgst + t.sgst)}), {taxable: 0, igst: 0, cgst: 0, sgst: 0});
/* Reads the GSTR-2B (or 2A) JSON downloaded from the portal. Returns {rows, period, gstin}. */
function parse2BJson(text) {
  let j; try { j = typeof text === 'string' ? JSON.parse(text.replace(/^﻿/, '')) : text; } catch (e) { throw new Error('This file is not valid JSON. Download the GSTR-2B JSON again from the GST portal.'); }
  const d = j && (j.data || j), doc = d && (d.docdata || d), rows = [];
  if (!doc || (!doc.b2b && !doc.cdnr && !doc.b2ba && !doc.cdn)) throw new Error('No B2B or credit/debit note section was found. Is this a GSTR-2B or GSTR-2A JSON file?');
  const one = (ctin, name, x, isNote) => {
    const items = x.items || x.itms || [], tx = items.length ? sumTax(items.map(i => taxOf(i.itm_det || i))) : taxOf(x);
    rows.push({gstin: String(ctin || '').toUpperCase(), supplier: name || '', number: String(x.inum || x.ntnum || x.nt_num || ''), date: toIso(x.dt || x.idt || x.nt_dt), value: c2(x.val), ...tx, itc: String(x.itcavl || x.itcavl === 0 ? x.itcavl : 'Y').toUpperCase() === 'N' ? 'N' : 'Y', reason: x.rsn || '', rcm: String(x.rev || x.rchrg || 'N').toUpperCase() === 'Y', note: !!isNote, noteType: isNote ? String(x.typ || x.ntty || 'C').toUpperCase()[0] : ''});
  };
  (doc.b2b || []).forEach(s => (s.inv || []).forEach(x => one(s.ctin, s.trdnm, x, false)));
  (doc.cdnr || doc.cdn || []).forEach(s => (s.nt || []).forEach(x => one(s.ctin, s.trdnm, x, true)));
  return {rows, period: d.rtnprd || d.fp || '', gstin: d.gstin || ''};
}
const A2B = {gstin: ['gstin of supplier', 'supplier gstin', 'gstin', 'gstin/uin', 'ctin', 'gstin of the supplier'], supplier: ['trade/legal name', 'trade name', 'legal name', 'supplier name', 'supplier', 'party name', 'name'], number: ['invoice number', 'invoice no', 'invoice no.', 'inv no', 'bill no', 'bill number', 'note number', 'document number'], date: ['invoice date', 'date', 'bill date', 'note date', 'document date'], taxable: ['taxable value', 'taxable value (₹)', 'taxable amount', 'taxable'], igst: ['integrated tax', 'integrated tax (₹)', 'igst'], cgst: ['central tax', 'central tax (₹)', 'cgst'], sgst: ['state/ut tax', 'state/ut tax (₹)', 'state tax', 'sgst', 'sgst/utgst'], value: ['invoice value', 'invoice value (₹)', 'total value'], itc: ['itc availability', 'itc available', 'eligible itc'], type: ['note type', 'invoice type', 'type', 'document type']};
const hnorm = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
/* Spreadsheet rows (from CSV or xlsx) -> same row shape. Finds the header line itself, so portal workbooks with a few title lines work. */
function parse2BTable(rows) {
  rows = (rows || []).map(r => Array.isArray(r) ? r : (r && r.cells) || []);
  let hi = -1, map = null;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = rows[r].map(hnorm), m = {};
    for (const k of Object.keys(A2B)) { const i = cells.findIndex(c => A2B[k].includes(c)); if (i >= 0) m[k] = i; }
    if (m.gstin != null && m.number != null && (m.taxable != null || m.igst != null || m.cgst != null)) { hi = r; map = m; break; }
  }
  if (hi < 0) throw new Error('Could not find the columns. The file needs at least: GSTIN of supplier, Invoice number, Taxable value and the tax columns (Integrated, Central, State/UT tax).');
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[₹,\s]/g, '')); return isNaN(n) ? 0 : n; };
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const g = String(r[map.gstin] || '').trim().toUpperCase(), no = String(r[map.number] == null ? '' : r[map.number]).trim(); if (!g && !no) continue;
    if (!/^\d{2}[A-Z0-9]{13}$/.test(g)) continue;
    const ty = map.type != null ? String(r[map.type] || '').toLowerCase() : '', note = /credit|debit|^c$|^d$/.test(ty);
    out.push({gstin: g, supplier: map.supplier != null ? String(r[map.supplier] || '').trim() : '', number: no, date: map.date != null ? toIso(r[map.date]) : '', value: map.value != null ? c2(num(r[map.value])) : 0, taxable: c2(num(r[map.taxable])), igst: c2(num(r[map.igst])), cgst: c2(num(r[map.cgst])), sgst: c2(num(r[map.sgst])), itc: map.itc != null && /^(n|no)/i.test(String(r[map.itc] || '').trim()) ? 'N' : 'Y', reason: '', rcm: false, note, noteType: note ? (/debit|^d$/.test(ty) ? 'D' : 'C') : ''});
  }
  if (!out.length) throw new Error('The file has no rows with a valid supplier GSTIN below the header.');
  return {rows: out, period: '', gstin: ''};
}
/* Match books (purchase bills + purchase debit notes) against the 2B rows.
   Matched = same supplier GSTIN and invoice number (ignoring case, spaces, dashes, leading zeros) and tax within one rupee.
   Mismatch = same GSTIN and number but the tax or taxable value differs. Probable = same GSTIN and date and amount but a different number.
   Only rows from the selected month of the books are listed as "not in 2B" (older bills may have been in an earlier 2B). */
function reconcile2B(data, rows2b, from, to, opt) {
  const C = context(data), tol = (opt && opt.tolerance) || 1, out = {matched: [], mismatch: [], probable: [], only2b: [], onlyBooks: [], from, to, warnings: []};
  const books = [];
  for (const b of (data.invoices || []).filter(i => i.kind === 'purchase')) {
    const p = C.parties.get(b.party_id) || {}, lines = C.linesOf(b);
    books.push({id: b.id, gstin: String(p.gstin || '').trim().toUpperCase(), supplier: p.name || '', number: b.number, date: b.date, value: c2(b.amount), taxable: sum(lines, l => l.taxable), igst: sum(lines, l => l.igst), cgst: sum(lines, l => l.cgst), sgst: sum(lines, l => l.sgst), blocked: !!b.itc_blocked, rcm: !!b.reverse_charge, note: false});
  }
  for (const n of (data.notes || [])) { const inv = C.invById.get(n.invoice_id); if (!inv || inv.kind !== 'purchase' || n.kind !== 'debit') continue; const p = C.parties.get(inv.party_id) || {};
    books.push({id: 'n' + n.id, gstin: String(p.gstin || '').trim().toUpperCase(), supplier: p.name || '', number: n.number, date: n.date, value: c2(n.amount), taxable: c2(n.taxable), igst: c2(n.igst), cgst: c2(n.cgst), sgst: c2(n.sgst), blocked: false, rcm: false, note: true}); }
  const tax = x => c2(x.igst + x.cgst + x.sgst);
  const used = new Set(), byKey = new Map();
  books.forEach(b => { const k = b.gstin + '|' + normNo(b.number) + '|' + (b.note ? 'N' : 'I'); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(b); });
  const pending = [];
  for (const r of rows2b) {
    const k = r.gstin + '|' + normNo(r.number) + '|' + (r.note ? 'N' : 'I'), cand = (byKey.get(k) || []).find(b => !used.has(b.id));
    if (cand) {
      used.add(cand.id); const dt = c2(tax(r) - tax(cand)), dv = c2(r.taxable - cand.taxable);
      const row = {books: cand, gst2b: r, taxDiff: dt, taxableDiff: dv};
      if (Math.abs(dt) <= tol && Math.abs(dv) <= tol * 2) out.matched.push(row); else out.mismatch.push(row);
    } else pending.push(r);
  }
  for (const r of pending) {
    const cand = books.find(b => !used.has(b.id) && b.gstin === r.gstin && b.note === r.note && Math.abs(tax(r) - tax(b)) <= tol && Math.abs(r.taxable - b.taxable) <= tol * 2 && (!r.date || !b.date || r.date === b.date));
    if (cand) { used.add(cand.id); out.probable.push({books: cand, gst2b: r, taxDiff: c2(tax(r) - tax(cand)), taxableDiff: c2(r.taxable - cand.taxable)}); } else out.only2b.push({gst2b: r});
  }
  out.onlyBooks = books.filter(b => !used.has(b.id) && inRange(b.date, from, to)).map(b => ({books: b, reason: !b.gstin ? 'Supplier has no GSTIN in your books' : b.blocked ? 'ITC not allowed on this bill (not claimed)' : b.rcm ? 'Reverse charge bill (does not appear in 2B)' : ''}));
  const sg = x => (x.note && (x.noteType === 'C' || x.books == null && false)) ? -1 : 1;
  const itcOf = (x) => x.note ? -tax(x) : tax(x);
  const claim = list => c2(list.reduce((s, r) => s + (r.books.blocked || r.books.rcm ? 0 : (r.books.note ? -tax(r.books) : tax(r.books))), 0));
  const all2b = [...out.matched, ...out.mismatch, ...out.probable].map(r => r.gst2b).concat(out.only2b.map(r => r.gst2b));
  out.summary = {
    rows2b: rows2b.length, matched: out.matched.length, mismatch: out.mismatch.length, probable: out.probable.length, only2b: out.only2b.length, onlyBooks: out.onlyBooks.length,
    itc2b: c2(all2b.filter(r => r.itc !== 'N').reduce((s, r) => s + (r.note ? -(tax(r)) : tax(r)), 0)),
    itcBooks: c2(books.filter(b => inRange(b.date, from, to) && !b.blocked && !b.rcm).reduce((s, b) => s + (b.note ? -tax(b) : tax(b)), 0)),
    atRisk: c2(out.onlyBooks.filter(r => !r.books.blocked && !r.books.rcm && r.books.gstin).reduce((s, r) => s + (r.books.note ? 0 : tax(r.books)), 0)),
    unbooked: c2(out.only2b.filter(r => r.gst2b.itc !== 'N' && !r.gst2b.note).reduce((s, r) => s + tax(r.gst2b), 0)),
    mismatchTax: c2(out.mismatch.reduce((s, r) => s + Math.abs(r.taxDiff), 0))};
  /* supplier-wise */
  const sup = new Map(), S_ = g => { if (!sup.has(g)) sup.set(g, {gstin: g, supplier: '', matched: 0, mismatch: 0, probable: 0, only2b: 0, onlyBooks: 0, atRisk: 0}); return sup.get(g); };
  const nm = (o, s) => { if (s && !o.supplier) o.supplier = s; };
  out.matched.forEach(r => { const o = S_(r.gst2b.gstin); nm(o, r.gst2b.supplier || r.books.supplier); o.matched++; });
  out.mismatch.forEach(r => { const o = S_(r.gst2b.gstin); nm(o, r.gst2b.supplier || r.books.supplier); o.mismatch++; });
  out.probable.forEach(r => { const o = S_(r.gst2b.gstin); nm(o, r.gst2b.supplier || r.books.supplier); o.probable++; });
  out.only2b.forEach(r => { const o = S_(r.gst2b.gstin); nm(o, r.gst2b.supplier); o.only2b++; });
  out.onlyBooks.forEach(r => { const o = S_(r.books.gstin || '(no GSTIN)'); nm(o, r.books.supplier); o.onlyBooks++; if (!r.books.blocked && !r.books.rcm && r.books.gstin) o.atRisk = c2(o.atRisk + tax(r.books)); });
  out.suppliers = [...sup.values()].sort((a, b) => (b.atRisk - a.atRisk) || (b.mismatch + b.only2b + b.onlyBooks) - (a.mismatch + a.only2b + a.onlyBooks));
  if (rows2b.some(r => r.itc === 'N')) out.warnings.push('Some 2B rows are marked ITC not available. They are listed but not counted in "ITC per 2B".');
  return out;
}
function reconSheets(rc) {
  const hdr = ['Status', 'Supplier GSTIN', 'Supplier', 'Invoice number', 'Invoice date', 'Taxable (books)', 'Tax (books)', 'Taxable (2B)', 'Tax (2B)', 'Tax difference', 'Note'];
  const t = x => x ? c2(x.igst + x.cgst + x.sgst) : '';
  const line = (st, r, note) => [st, (r.gst2b || r.books).gstin, (r.gst2b && r.gst2b.supplier) || (r.books && r.books.supplier) || '', (r.books || r.gst2b).number, (r.books || r.gst2b).date, r.books ? r.books.taxable : '', t(r.books), r.gst2b ? r.gst2b.taxable : '', t(r.gst2b), r.taxDiff != null ? r.taxDiff : '', note || ''];
  return {'Reconciliation': [hdr].concat(rc.mismatch.map(r => line('Mismatch', r, 'Tax or taxable value differs')), rc.probable.map(r => line('Probable match', r, 'Invoice number differs: ' + r.books.number + ' (books) vs ' + r.gst2b.number + ' (2B)')), rc.only2b.map(r => line('In 2B, not in books', r, r.gst2b.itc === 'N' ? 'ITC not available per 2B' : 'Book this bill to claim the credit')), rc.onlyBooks.map(r => line('In books, not in 2B', r, r.reason || 'Do not claim until the supplier reports it')), rc.matched.map(r => line('Matched', r, ''))),
    'Suppliers': [['Supplier GSTIN', 'Supplier', 'Matched', 'Mismatch', 'Probable', 'In 2B only', 'In books only', 'ITC at risk']].concat(rc.suppliers.map(s => [s.gstin, s.supplier, s.matched, s.mismatch, s.probable, s.only2b, s.onlyBooks, s.atRisk]))};
}

/* ---------------------------------------------------------------- files ---- */
const csvCell = v => { v = v == null ? '' : String(v); if (/^[=+@\t\r]/.test(v) || (/^-/.test(v) && !/^-?\d+(\.\d+)?$/.test(v))) v = "'" + v; return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n');
/* Minimal .xlsx writer (stored zip, no compression, no dependencies). Sheet names <= 31 characters without []:*?/\ . */
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const xe = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
function toXlsx(sheets) {
  const names = Object.keys(sheets).map(n => n.replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31));
  const enc = new TextEncoder(), files = [];
  const add = (name, text) => files.push({name, data: enc.encode(text)});
  add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + names.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>');
  add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n, i) => '<sheet name="' + xe(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
  add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (names.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  add('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  Object.values(sheets).forEach((rows, si) => {
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    rows.forEach((r, ri) => { x += '<row r="' + (ri + 1) + '">'; r.forEach((v, ci) => { if (v === '' || v == null) return; const ref = colName(ci) + (ri + 1), s = ri === 0 ? ' s="1"' : ''; x += typeof v === 'number' && isFinite(v) ? '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>' : '<c r="' + ref + '" t="inlineStr"' + s + '><is><t xml:space="preserve">' + xe(v) + '</t></is></c>'; }); x += '</row>'; });
    add('xl/worksheets/sheet' + (si + 1) + '.xml', x + '</sheetData></worksheet>');
  });
  const parts = [], cd = []; let off = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = Uint8Array.from([0x50, 0x4B, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0)]);
    parts.push(lh, nm, f.data);
    cd.push(Uint8Array.from([0x50, 0x4B, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
    off += lh.length + nm.length + sz;
  }
  const cdSize = cd.reduce((s, b) => s + b.length, 0);
  const end = Uint8Array.from([0x50, 0x4B, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
  const all = [...parts, ...cd, end], out = new Uint8Array(all.reduce((s, b) => s + b.length, 0)); let p = 0; for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}

const api = {validate1, lateFeeInterest, dueDates, b2clLimit, gstr1, gstr3b, setoff, gstr1Json, gstr3bJson, gstr1Sheets, gstr3bSheet, parse2BJson, parse2BTable, reconcile2B, reconSheets, toCSV, toXlsx, normNo, toIso, c2, B2CL_LIMIT, nearRate};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GR = api;
})(typeof window !== 'undefined' ? window : globalThis);
