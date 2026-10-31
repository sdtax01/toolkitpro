/* Toolkit Pro - e-commerce (marketplace) sales for GST returns. Pure functions: no DOM, no database. Global: MP.
   Reads the sales / return reports that Amazon, Flipkart, Meesho and similar operators give a seller, and turns them into
   - lines to store (parse),
   - the same "books" shape gst-returns.js already understands (asBooks), so GSTR-1 / GSTR-3B are built by the existing, tested code,
   - GSTR-1 Table 14 (supplies through an e-commerce operator, per operator GSTIN) and a TCS check.
   Nothing here writes anywhere. Column names differ between operators and change over time, so columns are matched by name and you can fix
   the matching on screen before importing. */
(function (root) {
'use strict';
const GR_ = () => root.GR || require('./gst-returns.js');
const GF_ = () => root.GF || require('./gst-fields.js');
const IM_ = () => root.IM || require('./import-core.js');
const PC_ = () => root.PC || require('./practice-core.js');
const c2 = n => { n = +n || 0; return Math.round((n + (n < 0 ? -1e-9 : 1e-9)) * 100) / 100; };
const nk = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

/* field -> [label, aliases (normalised header names)] */
const FIELDS = {
  sellerGstin: ['Seller GSTIN', ['sellergstin', 'gstinofseller', 'sellergstinno', 'sellergstnumber']],
  ecoGstin: ['Operator (ECO) GSTIN', ['ecogstin', 'etin', 'ecommerceoperatorgstin', 'marketplacegstin', 'gstinofecommerceoperator', 'ecogstinno', 'operatorgstin']],
  type: ['Transaction type', ['transactiontype', 'eventtype', 'documenttype', 'doctype', 'ordertransactiontype']],
  subType: ['Event sub type', ['eventsubtype', 'subtype', 'transactionsubtype']],
  orderId: ['Order ID', ['orderid', 'suborderno', 'suborderid', 'orderno', 'ordernumber', 'orderitemid']],
  itemId: ['Order item ID', ['orderitemid', 'itemid', 'lineitemid', 'shipmentitemid', 'suborderno']],
  invoiceNo: ['Invoice number', ['invoicenumber', 'invoiceno', 'buyerinvoiceid', 'buyerinvoicenumber', 'invoiceid', 'documentnumber', 'invoice']],
  noteNo: ['Credit note number', ['creditnoteno', 'creditnotenumber', 'creditnoteid', 'creditnote', 'cnno', 'creditnotenumberid']],
  origInvoice: ['Original invoice number', ['originalinvoicenumber', 'originalinvoiceno', 'originalinvoice', 'invoicenumberoforiginalsale']],
  invoiceDate: ['Invoice date', ['invoicedate', 'buyerinvoicedate', 'invoicedateddmmyyyy', 'orderdate', 'shipmentdate']],
  noteDate: ['Credit note date', ['creditnotedate', 'cndate', 'creditnotedateddmmyyyy']],
  hsn: ['HSN / SAC', ['hsnorsac', 'hsncode', 'hsn', 'hsnsac', 'hsnsaccode', 'hsnorsaccode']],
  desc: ['Item description', ['itemdescription', 'producttitledescription', 'producttitle', 'description', 'productname', 'itemname']],
  qty: ['Quantity', ['quantity', 'itemquantity', 'qty']],
  shipTo: ['Delivery state (place of supply)', ['shiptostate', 'customersdeliverystate', 'deliverystate', 'shiptostatecode', 'placeofsupply', 'customerdeliverystate', 'statecode', 'customerstate']],
  billTo: ['Billing state', ['customersbillingstate', 'billingstate', 'billtostate', 'customerbillingstate']],
  shipFrom: ['Ship-from state', ['shipfromstate', 'ordershippedfromstate', 'shippedfromstate', 'warehousestate', 'shipfrom']],
  taxable: ['Taxable value', ['taxexclusivegross', 'taxablevalue', 'taxableamount', 'taxablevaluerupees', 'taxablevaluefinalinvoiceamounttaxes']],
  invoiceAmount: ['Invoice amount', ['invoiceamount', 'finalinvoiceamount', 'totalinvoicevalue', 'invoicevalue', 'buyerinvoiceamount', 'totalamount']],
  totalTax: ['Total tax', ['totaltaxamount', 'totaltax', 'taxamount', 'gstamount']],
  igst: ['IGST amount', ['igsttax', 'igstamount', 'igst', 'integratedtax', 'igstvalue']],
  cgst: ['CGST amount', ['cgsttax', 'cgstamount', 'cgst', 'centraltax', 'cgstvalue']],
  sgst: ['SGST / UTGST amount', ['sgsttax', 'sgstamount', 'sgst', 'statetax', 'sgstutgsttax', 'utgsttax', 'sgstvalue']],
  cess: ['Cess amount', ['cessamount', 'cess', 'luxurycessamount', 'compensationcess']],
  tcsIgst: ['TCS IGST', ['tcsigstamount', 'tcsigst']],
  tcsCgst: ['TCS CGST', ['tcscgstamount', 'tcscgst']],
  tcsSgst: ['TCS SGST', ['tcssgstamount', 'tcssgst', 'tcsutgstamount']],
  tcsTotal: ['Total TCS', ['totaltcsdeducted', 'tcsamount', 'totaltcs', 'tcsamountdeducted']],
  buyerGstin: ['Buyer GSTIN', ['businessgstnumber', 'buyergstin', 'customergstin', 'gstinofbuyer', 'buyergstnumber', 'gstinofcustomer', 'buyergstno']],
  buyerName: ['Buyer name', ['businessname', 'buyername', 'customername']]
};
const REQUIRED = ['invoiceNo', 'invoiceDate', 'shipTo'];   /* plus a taxable value or an invoice amount */

const cells = r => Array.isArray(r) ? r : (r && r.cells) || [];
const hit = (h, aliases) => { const k = nk(h); if (!k) return 0; if (aliases.includes(k)) return 2; return aliases.some(a => a.length >= 8 && k.startsWith(a)) ? 1 : 0; };
function mapHeader(hdr) {
  const map = {}, claimed = new Set();
  for (const pass of [2, 1]) for (const f of Object.keys(FIELDS)) {
    if (map[f] != null) continue;
    /* earlier alias = better; take the best-ranked alias among unclaimed columns */
    let best = -1, bi = 1e9;
    hdr.forEach((h, i) => { if (claimed.has(i) && f !== 'itemId') return; if (hit(h, FIELDS[f][1]) !== pass) return; const rank = FIELDS[f][1].findIndex(a => a === nk(h) || nk(h).startsWith(a)); if (rank < bi) { bi = rank; best = i; } });
    if (best >= 0) { map[f] = best; if (f !== 'itemId') claimed.add(best); }
  }
  return map;
}
/* rows -> {headerIndex, headers, map} using the row that matches most known column names */
function detectHeader(rows) {
  let best = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const hdr = cells(rows[i]).map(x => String(x == null ? '' : x)), map = mapHeader(hdr), n = Object.keys(map).length;
    if (!best || n > best.n) best = {i, hdr, map, n};
  }
  return best && best.n >= 3 ? {headerIndex: best.i, headers: best.hdr, map: best.map} : null;
}
const missingFields = map => { const m = REQUIRED.filter(f => map[f] == null); if (map.taxable == null && map.invoiceAmount == null) m.push('taxable'); return m.map(f => FIELDS[f] ? FIELDS[f][0] : 'Taxable value'); };

const money = v => { const x = IM_().parseAmount(v); return x == null || !isFinite(x) ? 0 : Math.abs(x); };
const gstinBad = g => { const P = PC_(); return P.gstinProblem(String(g || '').trim().toUpperCase()); };
const isGstin = g => /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(String(g || '').trim()) && !gstinBad(g);
const stateCode = v => {
  const s = String(v == null ? '' : v).trim(); if (!s) return '';
  const G = GF_(); let m = /^(\d{1,2})(?:\s*[-–:]\s*.*)?$/.exec(s);
  if (m) { const c = m[1].padStart(2, '0'); return G.stateName(c) ? c : ''; }
  m = /^(\d{2})\s*[-–:]\s*(.+)$/.exec(s); if (m && G.stateName(m[1])) return m[1];
  return G.stateCodeByName(s) || '';
};
const dateOf = v => { const s = String(v == null ? '' : v).trim(); return s ? IM_().parseDate(s, true) || '' : ''; };

/* "Maharashtra = 27AAICA3918J1CT" lines -> {'27': gstin} (state may be a name or a code) */
function parseStateMap(text) {
  const out = {}, bad = [];
  String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).forEach(line => {
    const m = /^(.+?)\s*[=:,\t]\s*([0-9A-Za-z]{15})$/.exec(line), c = m && stateCode(m[1]);
    if (!m || !c || !isGstin(m[2])) bad.push(line); else out[c] = m[2].toUpperCase();
  });
  return {map: out, bad};
}

/* rows: array of arrays (or {cells}); opt: {sellerGstin, ecoName, ecoGstin, stateMap:{code:gstin}, map:{field: columnIndex|-1}, headerIndex, forceType:'sale'|'return'|'' , source}
   -> {ok, orders, skipped:[{n,reason}], warnings:[], stats, headers, map, headerIndex, missing} */
function parse(rows, opt) {
  opt = opt || {};
  const out = {ok: false, orders: [], skipped: [], warnings: [], stats: {}, headers: [], map: {}, headerIndex: -1, missing: []};
  const det = opt.headerIndex != null ? {headerIndex: opt.headerIndex, headers: cells(rows[opt.headerIndex]).map(x => String(x == null ? '' : x)), map: null} : detectHeader(rows);
  if (!det) { out.error = 'Could not find the column headings. Check that this is the operator\'s sales / tax report and that the sheet with the order lines is selected.'; return out; }
  const map = Object.assign(det.map || mapHeader(det.headers), opt.map || {}); Object.keys(map).forEach(k => { if (map[k] < 0 || map[k] == null) delete map[k]; });
  Object.assign(out, {headers: det.headers, map, headerIndex: det.headerIndex});
  out.missing = missingFields(map); if (out.missing.length) { out.error = 'Could not find the column(s): ' + out.missing.join(', ') + '. Pick them from the lists below.'; return out; }
  const seller = String(opt.sellerGstin || '').trim().toUpperCase(), P = seller ? gstinBad(seller) : 'Seller GSTIN is required.';
  if (P) { out.error = 'Seller GSTIN: ' + P; return out; }
  const defEco = String(opt.ecoGstin || '').trim().toUpperCase(); if (defEco && gstinBad(defEco)) { out.error = 'Operator GSTIN: ' + gstinBad(defEco); return out; }
  const sm = opt.stateMap || {}, sellerSt = seller.slice(0, 2), GR = GR_(), G = GF_();
  const get = (c, f) => map[f] == null ? '' : (c[map[f]] == null ? '' : String(c[map[f]]).trim());
  const seen = new Map(); let noEco = 0, cessSeen = 0, badBuyer = 0, noTax = 0;
  for (let i = det.headerIndex + 1; i < rows.length; i++) {
    const c = cells(rows[i]); if (!c.some(x => String(x == null ? '' : x).trim() !== '')) continue;
    const n = (rows[i] && rows[i].n) || i + 1, skip = reason => out.skipped.push({n, reason});
    /* sale or return? */
    const tt = nk(get(c, 'type') + ' ' + get(c, 'subType'));
    let type = opt.forceType || 'sale';
    if (!opt.forceType && tt) { if (/returncancel/.test(tt)) type = 'sale'; else if (/return|refund|creditnote|rto/.test(tt)) type = 'return'; else if (/cancel/.test(tt)) { skip('cancelled order (not a supply)'); continue; } }
    const sg = get(c, 'sellerGstin').toUpperCase(); if (sg && isGstin(sg) && sg !== seller) { skip('belongs to another GSTIN (' + sg + ')'); continue; }
    const noteNo = get(c, 'noteNo'), invNo = get(c, 'invoiceNo'), number = type === 'return' ? (noteNo || invNo) : invNo;
    if (!number) { skip(type === 'return' ? 'no credit note number' : 'no invoice number'); continue; }
    const date = type === 'return' ? (dateOf(get(c, 'noteDate')) || dateOf(get(c, 'invoiceDate'))) : dateOf(get(c, 'invoiceDate'));
    if (!date) { skip('date not understood: ' + (get(c, type === 'return' ? 'noteDate' : 'invoiceDate') || 'blank')); continue; }
    const pos = stateCode(get(c, 'shipTo')) || stateCode(get(c, 'billTo'));
    if (!pos) { skip('delivery state not recognised: ' + (get(c, 'shipTo') || get(c, 'billTo') || 'blank')); continue; }
    const inter = pos !== sellerSt;
    let igst = money(get(c, 'igst')), cgst = money(get(c, 'cgst')), sgst = money(get(c, 'sgst')), cess = money(get(c, 'cess')), taxable = money(get(c, 'taxable'));
    const inv = money(get(c, 'invoiceAmount'));
    if (map.igst == null && map.cgst == null && map.sgst == null) {
      const tot = map.totalTax != null ? money(get(c, 'totalTax')) : (inv && taxable ? Math.max(0, c2(inv - taxable - cess)) : 0);
      if (tot) { if (inter) igst = tot; else { cgst = c2(tot / 2); sgst = c2(tot - cgst); } } else if (taxable) noTax++;
    }
    if (map.taxable == null || !taxable) { if (inv) taxable = Math.max(0, c2(inv - igst - cgst - sgst - cess)); }
    if (!taxable && !igst && !cgst && !sgst) { skip('no value'); continue; }
    const rate = taxable > 0 ? GR.nearRate((igst + cgst + sgst) / taxable * 100) : 0;
    if (cess) cessSeen++;
    let tI = money(get(c, 'tcsIgst')), tC = money(get(c, 'tcsCgst')), tS = money(get(c, 'tcsSgst'));
    if (map.tcsIgst == null && map.tcsCgst == null && map.tcsSgst == null && map.tcsTotal != null) { const t = money(get(c, 'tcsTotal')); if (inter) tI = t; else { tC = c2(t / 2); tS = c2(t - tC); } }
    let eco = get(c, 'ecoGstin').toUpperCase(); if (!isGstin(eco)) eco = sm[get(c, 'shipFrom') ? stateCode(get(c, 'shipFrom')) : ''] || defEco || '';
    if (!eco) noEco++;
    let buyer = get(c, 'buyerGstin').toUpperCase(); if (buyer && !isGstin(buyer)) { badBuyer++; buyer = ''; }
    if (buyer && buyer === seller) buyer = '';
    const hsn = get(c, 'hsn').replace(/\.0+$/, '').replace(/\s+/g, '');
    const qty = type === 'return' ? 0 : money(get(c, 'qty'));
    const base = ['mp', seller, type, eco, number, get(c, 'orderId'), get(c, 'itemId'), hsn, taxable, igst, cgst, sgst].join('|'), k = (seen.get(base) || 0) + 1; seen.set(base, k);
    out.orders.push({seller_gstin: seller, eco_name: opt.ecoName || null, eco_gstin: eco || null, doc_type: type, order_id: get(c, 'orderId') || null, invoice_no: number, invoice_date: date,
      orig_invoice_no: type === 'return' ? (get(c, 'origInvoice') || (noteNo && invNo && invNo !== noteNo ? invNo : '')) || null : null,
      hsn: hsn || null, description: get(c, 'desc').slice(0, 120) || null, qty: type === 'return' ? 0 : qty, unit: hsn && /^99/.test(hsn) ? null : 'nos', pos, buyer_gstin: buyer || null, buyer_name: buyer ? (get(c, 'buyerName') || null) : null,
      taxable: c2(taxable), rate, igst: c2(igst), cgst: c2(cgst), sgst: c2(sgst), cess: c2(cess), tcs_igst: c2(tI), tcs_cgst: c2(tC), tcs_sgst: c2(tS), row_key: base + '#' + k, source: opt.source || null});
  }
  const O = out.orders;
  out.stats = {lines: O.length, sales: O.filter(o => o.doc_type === 'sale').length, returns: O.filter(o => o.doc_type === 'return').length, skipped: out.skipped.length,
    from: O.reduce((m, o) => !m || o.invoice_date < m ? o.invoice_date : m, ''), to: O.reduce((m, o) => !m || o.invoice_date > m ? o.invoice_date : m, '')};
  if (noEco) out.warnings.push(noEco + ' line(s) have no operator GSTIN. They are included in the sales tables but cannot go into Table 14. Enter the operator GSTIN (or the state-wise list) and import again.');
  if (cessSeen) out.warnings.push(cessSeen + ' line(s) carry cess. Cess is not carried into the return; add it in the portal.');
  if (badBuyer) out.warnings.push(badBuyer + ' buyer GSTIN(s) failed the check-digit test and are treated as consumer sales.');
  if (noTax) out.warnings.push(noTax + ' line(s) have a taxable value but no tax. They are reported as nil-rated. If that is wrong, map the tax columns.');
  out.ok = true; return out;
}

/* ---------- books shape for gst-returns.js ---------- */
const ECO_KEY = o => (o.eco_gstin || o.eco_name || '') + '~' + o.invoice_no;
function asBooks(orders) {
  const G = GF_(), parties = new Map(), invoices = [], items = [], notes = [];
  parties.set('mp-c', {id: 'mp-c', name: 'Consumers (marketplace)', gst_type: 'unregistered'});
  const party = o => { if (!o.buyer_gstin) return 'mp-c'; const id = 'mp-' + o.buyer_gstin; if (!parties.has(id)) parties.set(id, {id, name: o.buyer_name || o.buyer_gstin, gstin: o.buyer_gstin, gst_type: 'regular', state: G.stateName(o.buyer_gstin.slice(0, 2))}); return id; };
  const sales = orders.filter(o => o.doc_type === 'sale'), rets = orders.filter(o => o.doc_type === 'return');
  const by = (list, keyf) => { const m = new Map(); list.forEach(o => { const k = keyf(o); if (!m.has(k)) m.set(k, []); m.get(k).push(o); }); return m; };
  const byOrder = new Map(), byInv = new Map();
  for (const [k, ls] of by(sales, ECO_KEY)) {
    const f = ls[0], id = 'mp:s:' + k, sum = x => c2(ls.reduce((s, o) => s + o[x], 0));
    invoices.push({id, kind: 'sale', number: f.invoice_no, date: f.invoice_date, party_id: party(f), place_of_supply: G.stateName(f.pos), reverse_charge: false, taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), amount: c2(sum('taxable') + sum('cgst') + sum('sgst') + sum('igst') + sum('cess')), description: f.description || '', hsn_sac: f.hsn || '', mp: true});
    ls.forEach((o, i) => items.push({invoice_id: id, line_no: i + 1, description: o.description || '', hsn_sac: o.hsn || '', quantity: o.qty, unit: o.unit || '', taxable: o.taxable, gst_rate: o.rate, cgst: o.cgst, sgst: o.sgst, igst: o.igst}));
    byInv.set(f.invoice_no, id); if (f.order_id) byOrder.set(f.order_id, id);
  }
  for (const [k, ls] of by(rets, ECO_KEY)) {
    const f = ls[0], sum = x => c2(ls.reduce((s, o) => s + o[x], 0));
    let inv = (f.orig_invoice_no && byInv.get(f.orig_invoice_no)) || (f.order_id && byOrder.get(f.order_id));
    if (!inv) {   /* the sale is not in the data (an earlier period or not uploaded): a placeholder with no date, used only to report the note */
      inv = 'mp:o:' + k;
      invoices.push({id: inv, kind: 'sale', number: f.orig_invoice_no || '', date: '', party_id: party(f), place_of_supply: G.stateName(f.pos), reverse_charge: false, taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), amount: 0, description: f.description || '', hsn_sac: f.hsn || '', mp: true, placeholder: true});
      ls.forEach((o, i) => items.push({invoice_id: inv, line_no: i + 1, description: o.description || '', hsn_sac: o.hsn || '', quantity: 0, unit: '', taxable: o.taxable, gst_rate: o.rate, cgst: o.cgst, sgst: o.sgst, igst: o.igst}));
    }
    notes.push({id: 'mp:n:' + k, kind: 'credit', invoice_id: inv, number: f.invoice_no, date: f.invoice_date, taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), amount: c2(sum('taxable') + sum('cgst') + sum('sgst') + sum('igst') + sum('cess')), reason: 'Sales return', mp: true});
  }
  return {parties: [...parties.values()], invoices, items, notes};
}

/* ---------- Table 14: supplies through an operator, net of returns, per operator GSTIN ---------- */
const inR = (d, a, b) => !!d && d >= a && d <= b;
function supeco(orders, from, to) {
  const m = new Map(), warnings = []; let noEco = 0;
  for (const o of orders) {
    if (!inR(o.invoice_date, from, to)) continue;
    if (!o.eco_gstin) { noEco++; continue; }
    const sg = o.doc_type === 'return' ? -1 : 1, x = m.get(o.eco_gstin) || {etin: o.eco_gstin, name: o.eco_name || '', suppval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0};
    x.suppval += sg * o.taxable; x.igst += sg * o.igst; x.cgst += sg * o.cgst; x.sgst += sg * o.sgst; if (o.eco_name && !x.name) x.name = o.eco_name; m.set(o.eco_gstin, x);
  }
  const clttx = [];
  for (const x of m.values()) {
    const neg = x.suppval < -0.005 || x.igst < -0.005 || x.cgst < -0.005 || x.sgst < -0.005;
    if (neg) warnings.push('Operator ' + x.etin + ': returns are larger than sales in this period, so Table 14 shows zero. The portal does not take negative values.');
    const z = v => neg ? 0 : c2(v); const row = {etin: x.etin, name: x.name, suppval: z(x.suppval), igst: z(x.igst), cgst: z(x.cgst), sgst: z(x.sgst), cess: 0};
    if (row.suppval || row.igst || row.cgst || row.sgst) clttx.push(row);
  }
  clttx.sort((a, b) => a.etin.localeCompare(b.etin));
  if (noEco) warnings.push(noEco + ' line(s) in this period have no operator GSTIN and are left out of Table 14.');
  return {clttx, warnings, noEco};
}

/* ---------- TCS check: what the operator reports collecting vs what the rate implies ---------- */
function tcsCheck(orders, from, to, ratePct) {
  const rt = ratePct == null ? 0.5 : +ratePct, m = new Map();
  for (const o of orders) {
    if (!inR(o.invoice_date, from, to)) continue;
    const sg = o.doc_type === 'return' ? -1 : 1, k = o.eco_gstin || '(no operator GSTIN)', x = m.get(k) || {etin: k, name: o.eco_name || '', net: 0, file: 0, expected: 0};
    x.net += sg * o.taxable; x.file += sg * (o.tcs_igst + o.tcs_cgst + o.tcs_sgst); x.expected += sg * o.taxable * rt / 100; m.set(k, x);
  }
  const rows = [...m.values()].map(x => ({...x, net: c2(x.net), file: c2(x.file), expected: c2(x.expected), diff: c2(x.file - x.expected)})).sort((a, b) => a.etin.localeCompare(b.etin));
  return {rows, rate: rt, net: c2(rows.reduce((s, x) => s + x.net, 0)), file: c2(rows.reduce((s, x) => s + x.file, 0)), expected: c2(rows.reduce((s, x) => s + x.expected, 0))};
}

/* ---------- everything for one seller GSTIN and period ---------- */
function prepare(orders, sellerGstin, from, to, opt) {
  opt = opt || {}; const G = GF_(), GR = GR_(), g = String(sellerGstin || '').toUpperCase(), mine = orders.filter(o => o.seller_gstin === g);
  const B = asBooks(mine), data = {settings: {gstin: g, state: G.stateName(g.slice(0, 2))}, parties: B.parties, invoices: B.invoices, items: B.items, notes: B.notes};
  const r1 = GR.gstr1(data, from, to, {hsnDigits: opt.hsnDigits || 4}), r3 = GR.gstr3b(data, from, to), sp = supeco(mine, from, to);
  r1.supeco = {clttx: sp.clttx}; sp.warnings.forEach(w => r1.warnings.push({message: w, ref: ''}));
  return {data, r1, r3, supeco: sp, tcs: tcsCheck(mine, from, to, opt.tcsRate), orders: mine};
}

const api = {FIELDS, detectHeader, mapHeader, parse, parseStateMap, asBooks, supeco, tcsCheck, prepare, stateCode, nk};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MP = api;
})(typeof window !== 'undefined' ? window : globalThis);
