/* Toolkit Pro - PDF documents: GST Tax Invoice and Ledger Statement (A4, Inter font, Toolkit Pro colours, timestamp bottom right of every page).
   Layout code is pure (it only needs a jsPDF constructor, the font data and a clock), so tests/pdf.test.js runs it in Node.
   In the browser, TPPdf.invoice(...) / TPPdf.statement(...) load jsPDF and the fonts on first use, then return {blob, filename, doc}.
   Tax Invoice contents follow Rule 46, CGST Rules 2017: supplier name, address, GSTIN; consecutive invoice number and date; recipient name, address, state and code, GSTIN;
   place of supply; HSN/SAC; description, quantity, taxable value; rate and amount of CGST / SGST / IGST; reverse charge; signature of the supplier; amount in words.
   E-invoicing (IRN / QR) is not required for this business and is not produced here. */
(function (root) {
'use strict';
const GF = root.GF || (typeof require !== 'undefined' ? require('./gst-fields.js') : null);
const QV = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src.split('?')[1]) || '';

/* ---------- theme (same tokens as assets/app.css) ---------- */
const C = {navy: [17, 36, 107], blue: [31, 79, 216], ink: [20, 33, 61], mut: [79, 92, 124], line: [213, 219, 236], soft: [238, 243, 255], white: [255, 255, 255], ok: [22, 101, 52], er: [180, 35, 24]};
const PT = 0.3528; /* mm per point */
const PAGE = {w: 210, h: 297, m: 14};

/* ---------- formatting ---------- */
const paise = n => Math.round((+n || 0) * 100 + ((+n || 0) < 0 ? -1e-9 : 1e-9));
const fmt = n => { const s = (paise(n) / 100).toFixed(2); let [i, d] = s.split('.'); const neg = i[0] === '-'; if (neg) i = i.slice(1); const last = i.slice(-3); let rest = i.slice(0, -3); if (rest) rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ','; return (neg ? '-' : '') + rest + last + '.' + d; };
const rs = n => '₹' + fmt(n);
const dmy = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(d || ''); };
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = n => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
const three = n => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
/* Indian numbering: "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only" */
function inrWords(amount) {
  let p = paise(Math.abs(amount)); const r = Math.floor(p / 100), ps = p % 100, parts = [];
  const cr = Math.floor(r / 1e7), lk = Math.floor(r % 1e7 / 1e5), th = Math.floor(r % 1e5 / 1e3), h = r % 1e3;
  if (cr) parts.push(three(cr) + ' Crore'); if (lk) parts.push(two(lk) + ' Lakh'); if (th) parts.push(two(th) + ' Thousand'); if (h) parts.push(three(h));
  const rw = parts.join(' ') || 'Zero';
  return 'Rupees ' + rw + (ps ? ' and ' + two(ps) + ' Paise' : '') + ' Only';
}
const stampOf = now => {
  const f = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true}).formatToParts(now || new Date()), g = t => (f.find(x => x.type === t) || {}).value || '';
  return g('day') + ' ' + g('month') + ' ' + g('year') + ', ' + g('hour') + ':' + g('minute') + ' ' + String(g('dayPeriod')).toUpperCase() + ' IST';
};
const safeName = s => String(s || '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'document';

/* GSTIN check digit (same rule as app.js gstinOk, repeated so this file stands alone). */
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gstinOk = g => { g = String(g || '').trim().toUpperCase(); if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false; let s = 0; for (let i = 0; i < 14; i++) { const v = CH.indexOf(g[i]) * (i % 2 ? 2 : 1); s += Math.floor(v / 36) + v % 36; } return g[14] === CH[(36 - s % 36) % 36]; };

/* ---------- drawing kit ---------- */
function kit(doc) {
  const k = {
    fill: c => doc.setFillColor(c[0], c[1], c[2]), stroke: c => doc.setDrawColor(c[0], c[1], c[2]), ink: c => doc.setTextColor(c[0], c[1], c[2]),
    font(size, bold, color) { doc.setFont('Inter', bold ? 'bold' : 'normal'); doc.setFontSize(size); k.ink(color || C.ink); },
    /* text at baseline y; align left|right|center; returns nothing */
    t(str, x, y, o) { o = o || {}; k.font(o.s || 9, o.b, o.c); doc.text(String(str == null ? '' : str), x, y, {align: o.al || 'left'}); },
    wrap(str, w, size, bold) { k.font(size, bold); return doc.splitTextToSize(String(str == null ? '' : str), w); },
    /* wrapped paragraph; returns new y after the block */
    para(str, x, y, w, o) { o = o || {}; const size = o.s || 8.5, lh = size * PT * 1.38, lines = k.wrap(str, w, size, o.b); const max = o.max || 99; lines.slice(0, max).forEach((ln, i) => k.t(ln, x, y + i * lh, o)); return y + Math.min(lines.length, max) * lh; },
    lh: size => size * PT * 1.38,
    box(x, y, w, h, o) { o = o || {}; if (o.bg) { k.fill(o.bg); doc.roundedRect(x, y, w, h, o.r == null ? 1.6 : o.r, o.r == null ? 1.6 : o.r, 'F'); } k.stroke(o.line || C.line); doc.setLineWidth(o.lw || 0.25); if (!o.noStroke) doc.roundedRect(x, y, w, h, o.r == null ? 1.6 : o.r, o.r == null ? 1.6 : o.r, 'S'); },
    hline(x1, x2, y, c, lw) { k.stroke(c || C.line); doc.setLineWidth(lw || 0.25); doc.line(x1, y, x2, y); }
  };
  return k;
}

function newDoc(env) {
  const doc = new env.JsPDF({unit: 'mm', format: 'a4', orientation: 'portrait', compress: true});
  doc.addFileToVFS('Inter-Regular.ttf', env.fonts.regular); doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
  doc.addFileToVFS('Inter-Bold.ttf', env.fonts.bold); doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
  doc.setFont('Inter', 'normal');
  return doc;
}

/* top colour bar + business block (logo, name, address, GSTIN, PAN, contact) and a title on the right. Returns y below the header. */
function header(doc, k, env, S, title, sub) {
  const {m, w} = PAGE, R = w - m;
  k.fill(C.navy); doc.rect(0, 0, w, 3.2, 'F'); k.fill(C.blue); doc.rect(0, 3.2, w, 0.7, 'F');
  let x0 = m;
  if (env.logo) { try { doc.addImage(env.logo, 'PNG', m, 8.5, 24, 15.9, undefined, 'FAST'); x0 = m + 28; } catch (_) { x0 = m; } }
  const biz = S.business_name || 'Shree Digitax Solutions', tw = 112 - (x0 - m);
  let y = 13.2;
  k.t(biz, x0, y, {s: 13.5, b: 1, c: C.navy}); y += 4.6;
  const addr = [S.address, [S.city, S.pincode].filter(Boolean).join(' - '), S.state ? S.state + (GF.stateCodeOf(S.gstin, S.state) ? ' (' + GF.stateCodeOf(S.gstin, S.state) + ')' : '') : ''].filter(Boolean).join(', ');
  if (addr) y = k.para(addr, x0, y, tw, {s: 8, c: C.mut, max: 3});
  const ids = [S.gstin ? 'GSTIN: ' + String(S.gstin).toUpperCase() : '', (S.pan || GF.panOf(S.gstin)) ? 'PAN: ' + String(S.pan || GF.panOf(S.gstin)).toUpperCase() : ''].filter(Boolean).join('   ');
  if (ids) { k.t(ids, x0, y + 0.2, {s: 8, b: 1, c: C.ink}); y += 3.8; }
  const ct = [S.phone ? 'Ph: ' + S.phone : '', S.email || ''].filter(Boolean).join('   ');
  if (ct) { k.t(ct, x0, y + 0.2, {s: 8, c: C.mut}); y += 3.8; }
  k.t(title, R, 15, {s: 17, b: 1, c: C.blue, al: 'right'});
  if (sub) k.t(sub, R, 20, {s: 7.5, c: C.mut, al: 'right'});
  y = Math.max(y, 27.5) + 2;
  k.hline(m, R, y, C.line, 0.3);
  return y + 3.5;
}

/* page footer on every page: page x of y bottom-left, timestamp bottom-right */
function footers(doc, k, env, note) {
  const n = doc.getNumberOfPages(), {m, w, h} = PAGE, R = w - m, st = 'Generated on ' + stampOf(env.now);
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); k.hline(m, R, h - 12.5, C.line, 0.25);
    k.t(note + '   |   Page ' + i + ' of ' + n, m, h - 8.3, {s: 7.5, c: C.mut});
    k.t(st, R, h - 8.3, {s: 7.5, c: C.mut, al: 'right'});
  }
}

/* ============================ TAX INVOICE ============================ */
/* Lines of an invoice: the saved item rows when there are some, otherwise one line made from the invoice itself (single-line invoices). */
function linesOf(x, items) {
  if (items && items.length) return items.map(i => ({description: i.description, hsn_sac: i.hsn_sac, quantity: +i.quantity > 0 ? +i.quantity : 1, unit: i.unit, rate: +i.rate || 0, discount: +i.discount || 0, taxable: +i.taxable || 0, gst_rate: +i.gst_rate || 0, cgst: +i.cgst || 0, sgst: +i.sgst || 0, igst: +i.igst || 0}));
  const q = +x.quantity > 0 ? +x.quantity : 1, t = +x.taxable || 0;
  return [{description: x.description, hsn_sac: x.hsn_sac, quantity: q, unit: x.unit, rate: t / q, discount: 0, taxable: t, gst_rate: +x.gst_rate || 0, cgst: +x.cgst || 0, sgst: +x.sgst || 0, igst: +x.igst || 0}];
}
function invoiceChecks(S, P, x, items) {
  const err = [], warn = [], L = items && items.length ? items : null;
  if (x.taxable == null) err.push('This invoice has no GST breakup. Use "Set GST" first.');
  if (!String(S.business_name || '').trim()) warn.push('Your business name is missing in Settings');
  if (!String(S.gstin || '').trim()) warn.push('Your GSTIN is missing in Settings: the document will be titled "Invoice", not "Tax Invoice"');
  else if (!gstinOk(S.gstin)) warn.push('Your GSTIN in Settings looks invalid');
  if (!String(S.address || '').trim()) warn.push('Your address is missing in Settings');
  if (!GF.stateCodeOf(S.gstin, S.state)) warn.push('Your state is missing in Settings');
  GF.partyIssues(P, true).forEach(i => warn.push(i));
  if (P && P.gstin && !gstinOk(P.gstin)) warn.push('Customer GSTIN looks invalid');
  const no = String(x.number || '');
  if (no.length > 16) warn.push('Invoice number is longer than 16 characters (Rule 46 allows at most 16)');
  if (!/^[A-Za-z0-9\/-]+$/.test(no)) warn.push('Invoice number should use only letters, digits, "-" and "/"');
  if (L) L.forEach((l, i) => {
    const n = L.length > 1 ? 'Line ' + (i + 1) + ': ' : '';
    if (!String(l.hsn_sac || '').trim()) warn.push(n + 'HSN / SAC code is missing'); else if (!/^\d{4,8}$/.test(String(l.hsn_sac).trim())) warn.push(n + 'HSN / SAC should be 4 to 8 digits');
    if (!String(l.description || '').trim()) warn.push(n + 'description is missing');
  });
  else {
    if (!String(x.hsn_sac || '').trim()) warn.push('HSN / SAC code is missing on this invoice');
    else if (!/^\d{4,8}$/.test(String(x.hsn_sac).trim())) warn.push('HSN / SAC should be 4 to 8 digits');
    if (!String(x.description || '').trim()) warn.push('Description of goods / services is missing on this invoice');
  }
  return {errors: err, warnings: warn};
}

function buildInvoice(env, a) {
  const S = a.S || {}, P = a.P || {}, x = a.x, doc = newDoc(env), k = kit(doc), {m, w, h} = PAGE, R = w - m, W = w - 2 * m, LIM = h - 18;
  const sup = !!(S.gstin && String(S.gstin).trim()), title = sup ? 'TAX INVOICE' : 'INVOICE';
  const L = linesOf(x, a.items), multi = L.length > 1;
  let y = header(doc, k, env, S, title, 'ORIGINAL FOR RECIPIENT');
  const total = +x.amount || 0, taxable = +x.taxable || 0, inter = L.some(l => l.igst > 0) || +x.igst > 0;
  const supCode = GF.stateCodeOf(S.gstin, S.state) || '', rcvCode = GF.stateCodeOf(P.gstin, P.state) || '';
  const pos = x.place_of_supply || P.state || '', posCode = GF.stateCodeByName(pos) || rcvCode;
  /* continuation page: slim header so every page says which invoice it belongs to */
  const nextPage = () => { doc.addPage(); k.fill(C.navy); doc.rect(0, 0, w, 3.2, 'F'); k.fill(C.blue); doc.rect(0, 3.2, w, 0.7, 'F'); k.t(S.business_name || 'Shree Digitax Solutions', m, 11, {s: 10, b: 1, c: C.navy}); k.t(title + ' ' + (x.number || '') + ' (continued)', R, 11, {s: 9, b: 1, c: C.blue, al: 'right'}); k.hline(m, R, 14, C.line, 0.3); return 19; };
  /* --- row of key facts --- */
  const cells = [['Invoice No.', x.number || ''], ['Invoice Date', dmy(x.date)], ['Due Date', x.due_date ? dmy(x.due_date) : '-'], ['Reverse Charge', x.reverse_charge ? 'Yes' : 'No']], cw = W / cells.length;
  k.box(m, y, W, 12, {bg: C.soft});
  cells.forEach((c, i) => { const cx = m + i * cw; if (i) { k.stroke(C.line); doc.setLineWidth(0.25); doc.line(cx, y + 2, cx, y + 10); } k.t(c[0], cx + 3, y + 4.6, {s: 7, c: C.mut}); k.t(c[1], cx + 3, y + 9.3, {s: 10, b: 1, c: C.ink}); });
  y += 15.5;
  /* --- receiver and supply boxes --- */
  const bw = 112, sx = m + bw + 4, sw = W - bw - 4, top = y;
  let ly = y + 5.4; k.t('BILL TO (RECEIVER)', m + 3.5, ly, {s: 7, b: 1, c: C.blue}); ly += 4.6;
  k.t(P.name || '', m + 3.5, ly, {s: 10.5, b: 1, c: C.navy}); ly += 4.6;
  const adr = [P.address, [P.city, P.pincode].filter(Boolean).join(' - ')].filter(Boolean).join(', ');
  if (adr) ly = k.para(adr, m + 3.5, ly, bw - 7, {s: 8.5, c: C.ink, max: 4});
  const rows = [['State', P.state ? P.state + (rcvCode ? ' (Code ' + rcvCode + ')' : '') : (rcvCode ? 'Code ' + rcvCode : '-')], ['GSTIN', P.gstin ? String(P.gstin).toUpperCase() : (GF.gstTypeOf(P) === 'unregistered' ? 'Unregistered' : '-')]];
  const pan = P.pan || GF.panOf(P.gstin); if (pan) rows.push(['PAN', String(pan).toUpperCase()]);
  ly += 1; rows.forEach(r => { k.t(r[0], m + 3.5, ly, {s: 8, c: C.mut}); k.t(r[1], m + 20, ly, {s: 8.5, b: 1}); ly += 4.1; });
  const bh = Math.max(ly - top + 1.5, 36);  /* the supply box needs 36 mm for its three entries */
  k.box(m, top, bw, bh); k.box(sx, top, sw, bh);
  let ry = top + 5.4; k.t('SUPPLY DETAILS', sx + 3.5, ry, {s: 7, b: 1, c: C.blue}); ry += 4.8;
  [['Place of supply', pos ? pos + (posCode ? ' (' + posCode + ')' : '') : '-'], ['Supplier state', S.state ? S.state + (supCode ? ' (' + supCode + ')' : '') : '-'], ['Type of supply', inter ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)']].forEach(r => {
    k.t(r[0], sx + 3.5, ry, {s: 7, c: C.mut}); ry = k.para(r[1], sx + 3.5, ry + 3.5, sw - 7, {s: 8.5, b: 1, max: 2}) + 1.8;
  });
  y = top + Math.max(bh, ry - top + 1) + 5;
  /* --- items table (rows can run onto further pages; the header repeats) --- */
  const hasDisc = L.some(l => l.discount > 0.004);
  const cols = hasDisc ? [['#', 8, 'c'], ['Description of goods / services', 54, 'l'], ['HSN / SAC', 19, 'c'], ['Qty', 17, 'r'], ['Rate (₹)', 22, 'r'], ['Disc. (₹)', 18, 'r'], ['GST %', 12, 'c'], ['Taxable value (₹)', 32, 'r']]
    : [['#', 8, 'c'], ['Description of goods / services', 62, 'l'], ['HSN / SAC', 20, 'c'], ['Qty', 18, 'r'], ['Rate (₹)', 24, 'r'], ['GST %', 14, 'c'], ['Taxable value (₹)', 36, 'r']];
  const tableHead = (cs, yy) => { k.fill(C.navy); doc.roundedRect(m, yy, W, 8, 1.2, 1.2, 'F'); let cx = m; cs.forEach(c => { const al = c[2] === 'r' ? 'right' : c[2] === 'c' ? 'center' : 'left', tx = c[2] === 'r' ? cx + c[1] - 2.5 : c[2] === 'c' ? cx + c[1] / 2 : cx + 2.5; k.t(c[0], tx, yy + 5.2, {s: 7.5, b: 1, c: C.white, al}); cx += c[1]; }); return yy + 8; };
  const cellAt = (cs, i, cx, yy, v, o) => { const c = cs[i]; k.t(v, c[2] === 'r' ? cx + c[1] - 2.5 : c[2] === 'c' ? cx + c[1] / 2 : cx + 2.5, yy, Object.assign({s: 9, al: c[2] === 'r' ? 'right' : c[2] === 'c' ? 'center' : 'left'}, o || {})); };
  if (y + 8 + 14 > LIM) y = nextPage();
  y = tableHead(cols, y);
  L.forEach((l, n) => {
    const dl = k.wrap(l.description || 'Goods / services supplied', cols[1][1] - 5, 9, false), rh = Math.max(9, dl.length * k.lh(9) + 4);
    if (y + rh > LIM) { y = tableHead(cols, nextPage()); }
    if (n % 2 === 1) { k.fill([248, 250, 255]); doc.rect(m, y, W, rh, 'F'); }
    const qtxt = String(l.quantity) + (l.unit ? ' ' + l.unit : '');
    const vals = [String(n + 1), null, l.hsn_sac || '-', qtxt, fmt(l.rate), ...(hasDisc ? [l.discount > 0.004 ? fmt(l.discount) : '-'] : []), l.gst_rate + '%', fmt(l.taxable)];
    let cx = m; vals.forEach((v, i) => { if (i === 1) dl.forEach((ln, j) => k.t(ln, cx + 2.5, y + 5.6 + j * k.lh(9), {s: 9})); else cellAt(cols, i, cx, y + 5.6, v, {b: i === vals.length - 1}); cx += cols[i][1]; });
    y += rh; k.hline(m, R, y, C.line, 0.2);
  });
  y += 6;
  /* --- tax summary by HSN / SAC and rate --- */
  const grp = new Map(); L.forEach(l => { const kk = (l.hsn_sac || '-') + '|' + l.gst_rate, g = grp.get(kk) || {hsn: l.hsn_sac || '-', rate: l.gst_rate, t: 0, cg: 0, sg: 0, ig: 0}; g.t += paise(l.taxable); g.cg += paise(l.cgst); g.sg += paise(l.sgst); g.ig += paise(l.igst); grp.set(kk, g); });
  const G = [...grp.values()].sort((p, q) => String(p.hsn).localeCompare(String(q.hsn)) || p.rate - q.rate);
  const tcols = inter ? [['HSN / SAC', 36, 'c'], ['Taxable value (₹)', 40, 'r'], ['IGST rate', 30, 'c'], ['IGST amount (₹)', 40, 'r'], ['Total tax (₹)', 36, 'r']] : [['HSN / SAC', 26, 'c'], ['Taxable value (₹)', 34, 'r'], ['CGST rate', 18, 'c'], ['CGST amt (₹)', 28, 'r'], ['SGST rate', 18, 'c'], ['SGST amt (₹)', 28, 'r'], ['Total tax (₹)', 30, 'r']];
  if (y + 8 + 9 * Math.min(G.length, 2) > LIM) y = nextPage();
  y = tableHead(tcols, y);
  G.forEach(g => {
    if (y + 9 > LIM) y = tableHead(tcols, nextPage());
    const tv = inter ? [g.hsn, fmt(g.t / 100), g.rate + '%', fmt(g.ig / 100), fmt(g.ig / 100)] : [g.hsn, fmt(g.t / 100), (g.rate / 2) + '%', fmt(g.cg / 100), (g.rate / 2) + '%', fmt(g.sg / 100), fmt((g.cg + g.sg) / 100)];
    let cx = m; tv.forEach((v, i) => { cellAt(tcols, i, cx, y + 5.6, v); cx += tcols[i][1]; }); y += 9; k.hline(m, R, y, C.line, 0.2);
  });
  y += 6;
  /* --- totals: one tax line per rate --- */
  const lines = [['Taxable value', fmt(taxable)]], rates = [...new Set(L.map(l => l.gst_rate))].sort((p, q) => p - q);
  const showRates = rates.filter(r => rates.length === 1 || L.some(l => l.gst_rate === r && (l.cgst + l.sgst + l.igst) > 0));
  showRates.forEach(r => {
    const sum = f => L.filter(l => l.gst_rate === r).reduce((q, l) => q + paise(l[f]), 0) / 100;
    if (inter) lines.push(['IGST @ ' + r + '%', fmt(sum('igst'))]); else { lines.push(['CGST @ ' + (r / 2) + '%', fmt(sum('cgst'))]); lines.push(['SGST @ ' + (r / 2) + '%', fmt(sum('sgst'))]); }
  });
  const paid = +x.paid || 0, adj = +x.adjusted || 0, extra = (paid > 0.004 ? 5.4 : 0) + (adj > 0.004 ? 5.4 : 0) + (paid > 0.004 || adj > 0.004 ? 7 : 0);
  const totH = lines.length * 6.2 + 12 + extra, termsH = S.terms && String(S.terms).trim() ? Math.min(6, k.wrap(String(S.terms), W, 8, false).length) * k.lh(8) + 7.5 : 0, need = Math.max(21, totH) + 5 + 34 + 5 + termsH + 14;
  if (y + Math.max(21, totH) > LIM) y = nextPage();  /* totals stay together; the blocks below move on only when they do not fit */
  const lw = 104, tx0 = m + lw + 4, tw = W - lw - 4, ty0 = y;
  let ty = y; lines.forEach(r => { k.t(r[0], tx0 + 3, ty + 4.4, {s: 9, c: C.mut}); k.t('₹ ' + r[1], R - 3, ty + 4.4, {s: 9, al: 'right'}); ty += 6.2; });
  k.fill(C.navy); doc.roundedRect(tx0, ty, tw, 9.5, 1.4, 1.4, 'F'); k.t('Total invoice value', tx0 + 3, ty + 6.2, {s: 9, b: 1, c: C.white}); k.t('₹ ' + fmt(total), R - 3, ty + 6.4, {s: 11, b: 1, c: C.white, al: 'right'}); ty += 12;
  if (paid > 0.004) { k.t(a.sale === false ? 'Amount paid' : 'Amount received', tx0 + 3, ty + 3.6, {s: 8.5, c: C.mut}); k.t('₹ ' + fmt(paid), R - 3, ty + 3.6, {s: 8.5, al: 'right'}); ty += 5.4; }
  if (adj > 0.004) { k.t('Credit / debit notes and TDS', tx0 + 3, ty + 3.6, {s: 8.5, c: C.mut}); k.t('₹ ' + fmt(adj), R - 3, ty + 3.6, {s: 8.5, al: 'right'}); ty += 5.4; }
  if (paid > 0.004 || adj > 0.004) { const bal = (paise(total) - paise(paid) - paise(adj)) / 100; k.t('Balance due', tx0 + 3, ty + 4, {s: 9, b: 1}); k.t('₹ ' + fmt(bal), R - 3, ty + 4, {s: 9.5, b: 1, c: bal > 0.004 ? C.er : C.ok, al: 'right'}); ty += 7; }
  k.box(m, ty0, lw, 21, {bg: C.soft}); k.t('AMOUNT IN WORDS', m + 3.5, ty0 + 5.2, {s: 7, b: 1, c: C.blue}); k.para(inrWords(total), m + 3.5, ty0 + 10.2, lw - 7, {s: 9.5, b: 1, c: C.navy, max: 3});
  y = Math.max(ty, ty0 + 21) + 5;
  /* --- bank + signature --- */
  if (y + 34 > LIM) y = nextPage();
  const bank = [['Bank', S.bank_name], ['A/c no.', S.bank_account], ['IFSC', S.bank_ifsc], ['UPI', S.upi_id]].filter(r => r[1]), bh2 = 34;
  k.box(m, y, lw, bh2); k.t('BANK DETAILS', m + 3.5, y + 5.2, {s: 7, b: 1, c: C.blue});
  if (bank.length) bank.forEach((r, i) => { k.t(r[0], m + 3.5, y + 11 + i * 5, {s: 8, c: C.mut}); k.t(String(r[1]), m + 20, y + 11 + i * 5, {s: 8.8, b: 1}); });
  else k.para('Add your bank details in Settings to print them here.', m + 3.5, y + 11, lw - 7, {s: 8, c: C.mut});
  k.box(tx0, y, tw, bh2); k.t('For ' + (S.business_name || 'Shree Digitax Solutions'), R - 3, y + 5.6, {s: 8.8, b: 1, c: C.navy, al: 'right'});
  k.hline(tx0 + 8, R - 4, y + bh2 - 9, C.mut, 0.3); k.t('Authorised signatory' + (S.signatory ? ': ' + S.signatory : ''), R - 4, y + bh2 - 4.6, {s: 8, c: C.mut, al: 'right'});
  y += bh2 + 5;
  /* --- terms + declaration --- */
  if (y + termsH > LIM) y = nextPage();
  if (S.terms && String(S.terms).trim()) { k.t('TERMS & CONDITIONS', m, y, {s: 7, b: 1, c: C.blue}); y = k.para(String(S.terms), m, y + 4.2, W, {s: 8, c: C.ink, max: 6}) + 3; }
  if (y + 14 > LIM) y = nextPage();
  k.t('DECLARATION', m, y, {s: 7, b: 1, c: C.blue});
  y = k.para('We declare that this invoice shows the actual price of the goods / services described and that all particulars are true and correct.' + (x.reverse_charge ? ' Tax on this supply is payable by the recipient on reverse charge basis.' : ''), m, y + 4.2, W, {s: 8, c: C.mut});
  footers(doc, k, env, sup ? 'This is a computer-generated tax invoice' : 'This is a computer-generated invoice');
  return doc;
}

/* ============================ STATEMENT OF ACCOUNT ============================ */
function buildStatement(env, a) {
  const S = a.S || {}, P = a.P || {}, st = a.st, doc = newDoc(env), k = kit(doc), {m, w, h} = PAGE, R = w - m, W = w - 2 * m, cust = P.kind !== 'supplier';
  let y = header(doc, k, env, S, 'STATEMENT OF ACCOUNT', cust ? 'Sales ledger' : 'Purchase ledger');
  /* party + period */
  const rcvCode = GF.stateCodeOf(P.gstin, P.state), adr = [P.address, [P.city, P.pincode].filter(Boolean).join(' - ')].filter(Boolean).join(', ');
  const top = y; let ly = y + 5.4; k.t(cust ? 'CUSTOMER' : 'SUPPLIER', m + 3.5, ly, {s: 7, b: 1, c: C.blue}); ly += 4.8;
  k.t(P.name || '', m + 3.5, ly, {s: 11, b: 1, c: C.navy}); ly += 4.6;
  if (adr) ly = k.para(adr, m + 3.5, ly, 104, {s: 8.5, max: 3});
  const idl = [P.state ? P.state + (rcvCode ? ' (' + rcvCode + ')' : '') : '', P.gstin ? 'GSTIN: ' + String(P.gstin).toUpperCase() : ''].filter(Boolean).join('   ');
  if (idl) { k.t(idl, m + 3.5, ly + 0.4, {s: 8.5, c: C.mut}); ly += 4.2; }
  const bh = Math.max(ly - top + 2, 26); k.box(m, top, 112, bh);
  k.box(m + 116, top, W - 116, bh, {bg: C.soft}); k.t('PERIOD', m + 119.5, top + 5.4, {s: 7, b: 1, c: C.blue});
  k.t((a.from ? dmy(a.from) : 'Beginning') + '  to  ' + (a.to ? dmy(a.to) : dmy(a.today)), m + 119.5, top + 11.2, {s: 9.5, b: 1, c: C.navy});
  k.t('Amounts in Indian Rupees (₹)', m + 119.5, top + 16.2, {s: 7.5, c: C.mut});
  y = top + bh + 5;
  /* summary tiles */
  const tiles = [['Opening balance', st.opening], [cust ? 'Invoiced' : 'Billed', st.billed], [cust ? 'Received' : 'Paid', st.paid], ['Closing balance', st.closing]], tw = (W - 9) / 4;
  tiles.forEach((t, i) => { const tx = m + i * (tw + 3), last = i === 3; k.box(tx, y, tw, 15, {bg: last ? C.navy : C.soft, line: last ? C.navy : C.line}); k.t(t[0], tx + 3, y + 5.2, {s: 7.2, c: last ? [200, 215, 255] : C.mut}); k.t('₹ ' + fmt(t[1]), tx + 3, y + 11.4, {s: 10.5, b: 1, c: last ? C.white : (i === 3 && t[1] > 0 ? C.er : C.ink)}); });
  y += 20;
  /* table */
  const cols = [['Date', 24, 'l'], ['Type', 28, 'l'], ['Reference', 50, 'l'], [cust ? 'Invoiced (₹)' : 'Billed (₹)', 26, 'r'], [cust ? 'Received (₹)' : 'Paid (₹)', 26, 'r'], ['Balance (₹)', 28, 'r']];
  const head = yy => { k.fill(C.navy); doc.roundedRect(m, yy, W, 8, 1.2, 1.2, 'F'); let cx = m; cols.forEach(c => { k.t(c[0], c[2] === 'r' ? cx + c[1] - 2.5 : cx + 2.5, yy + 5.2, {s: 7.5, b: 1, c: C.white, al: c[2] === 'r' ? 'right' : 'left'}); cx += c[1]; }); return yy + 8; };
  const LIM = h - 20, RH = 6.4;
  y = head(y);
  const rows = [{date: a.from ? dmy(a.from) : '', type: '', ref: 'Opening balance', billed: '', paid: '', balance: st.opening, em: 1}, ...st.rows.map(r => ({date: dmy(r.date), type: r.type, ref: r.ref, billed: r.billed ? fmt(r.billed) : '', paid: r.paid ? fmt(r.paid) : '', balance: r.balance}))];
  rows.forEach((r, i) => {
    const ref = k.wrap(r.ref || '', cols[2][1] - 5, 8.5, false), rh = Math.max(RH, ref.length * k.lh(8.5) + 2.6);
    if (y + rh > LIM) { doc.addPage(); y = head(18); }
    if (i % 2 === 1) { k.fill([248, 250, 255]); doc.rect(m, y, W, rh, 'F'); }
    let cx = m; const cells = [r.date, r.type, null, r.billed, r.paid, fmt(r.balance)];
    cells.forEach((v, j) => { const c = cols[j]; if (j === 2) ref.forEach((ln, q) => k.t(ln, cx + 2.5, y + 4.4 + q * k.lh(8.5), {s: 8.5, b: r.em, c: r.em ? C.mut : C.ink})); else k.t(v, c[2] === 'r' ? cx + c[1] - 2.5 : cx + 2.5, y + 4.4, {s: 8.5, al: c[2] === 'r' ? 'right' : 'left', b: j === 5}); cx += c[1]; });
    y += rh; k.hline(m, R, y, C.line, 0.15);
  });
  if (!st.rows.length) { k.t('No entries in this period.', m + 2.5, y + 5, {s: 8.5, c: C.mut}); y += 8; }
  /* closing row */
  if (y + 11 > LIM) { doc.addPage(); y = 18; }
  k.fill(C.soft); doc.roundedRect(m, y + 1, W, 9, 1.2, 1.2, 'F'); k.t('Closing balance', m + 2.5, y + 7, {s: 9, b: 1, c: C.navy});
  k.t(fmt(st.billed), m + cols[0][1] + cols[1][1] + cols[2][1] + cols[3][1] - 2.5, y + 7, {s: 8.8, b: 1, al: 'right'}); k.t(fmt(st.paid), m + W - cols[5][1] - 2.5, y + 7, {s: 8.8, b: 1, al: 'right'});
  k.t(fmt(st.closing), R - 2.5, y + 7, {s: 9.5, b: 1, al: 'right', c: st.closing > 0 ? C.er : C.ink});
  y += 15;
  if (y + 16 > LIM) { doc.addPage(); y = 18; }
  k.para('Please reconcile this statement with your records and let us know of any difference.' + (S.business_name ? '  - ' + S.business_name : ''), m, y, W, {s: 8, c: C.mut});
  footers(doc, k, env, 'This is a computer-generated statement');
  return doc;
}

/* ============================ browser glue ============================ */
/* WhatsApp number in international form, or '' when the saved number cannot take WhatsApp (landline, unknown shape). */
const waPhone = p => { let d = String(p || '').replace(/\D/g, '').replace(/^00/, ''); if (!d) return ''; if (d.length === 10 && /^[6-9]/.test(d)) return '91' + d; if (d.length === 11 && /^0[6-9]/.test(d)) return '91' + d.slice(1); if (d.length === 12 && /^91[6-9]/.test(d)) return d; return d.length >= 11 && !/^0/.test(d) && !/^91/.test(d) ? d : ''; };
const api = {linesOf, waPhone, fmt, rs, dmy, inrWords, stampOf, gstinOk, invoiceChecks, buildInvoice, buildStatement, safeName, PAGE, C};
let ENV = null;
const b64 = buf => { let s = ''; const u = new Uint8Array(buf), n = 0x8000; for (let i = 0; i < u.length; i += n) s += String.fromCharCode.apply(null, u.subarray(i, i + n)); return btoa(s); };
const getBuf = async u => { const r = await fetch(u); if (!r.ok) throw new Error('Could not load ' + u.split('?')[0] + ' (' + r.status + ')'); return r.arrayBuffer(); };
const addScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src.split('?')[0])); document.head.appendChild(s); });
async function env() {
  if (ENV) return ENV;
  ENV = (async () => {
    if (!(root.jspdf && root.jspdf.jsPDF)) await addScript('assets/vendor/jspdf.umd.min.js' + (QV ? '?' + QV : ''));
    const [rg, bd] = await Promise.all([getBuf('assets/vendor/Inter-Regular.ttf' + (QV ? '?' + QV : '')), getBuf('assets/vendor/Inter-Bold.ttf' + (QV ? '?' + QV : ''))]);
    let logo = null; try { logo = 'data:image/png;base64,' + b64(await getBuf('assets/logo.png' + (QV ? '?' + QV : ''))); } catch (_) {}
    return {JsPDF: root.jspdf.jsPDF, fonts: {regular: b64(rg), bold: b64(bd)}, logo};
  })();
  ENV.catch(() => { ENV = null; });
  return ENV;
}
const pack = (doc, filename, title) => ({doc, blob: doc.output('blob'), filename, title});
async function invoice(a) { const e = await env(); return pack(buildInvoice({...e, now: new Date()}, a), 'Invoice-' + safeName(a.x.number) + '-' + safeName(a.P && a.P.name) + '.pdf', 'Invoice ' + a.x.number); }
async function statement(a) { const e = await env(); return pack(buildStatement({...e, now: new Date()}, a), 'Statement-' + safeName(a.P && a.P.name) + '-' + (a.to || a.today || '').replace(/-/g, '') + '.pdf', 'Statement of account: ' + (a.P && a.P.name)); }
function download(res) { const u = URL.createObjectURL(res.blob), l = document.createElement('a'); l.href = u; l.download = res.filename; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000); }
/* Share the PDF itself through the device share sheet (WhatsApp, Gmail, ...). Must run from a tap/click. Where the browser cannot share files (most desktops), the PDF is saved and WhatsApp opens with the message so it can be attached. */
async function share(res, text, phone) {
  try {
    const f = new File([res.blob], res.filename, {type: 'application/pdf'});
    if (navigator.canShare && navigator.canShare({files: [f]})) { try { await navigator.share({files: [f], title: res.title, text: text || res.title}); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; } }
  } catch (_) {}
  download(res);
  if (phone) { try { window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(text || res.title), '_blank', 'noopener'); } catch (_) {} }
  return 'downloaded';
}
Object.assign(api, {invoice, statement, download, share});
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TPPdf = api;
})(typeof window !== 'undefined' ? window : globalThis);
