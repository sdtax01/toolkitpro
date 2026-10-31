/* Toolkit Pro - GST Returns screens: GSTR-1, GSTR-3B and GSTR-2B reconciliation. Calculations live in assets/gst-returns.js (GR).
   Read-only: this page never writes to your books. */
(function (root) {
'use strict';
const h = s => esc(s);
const dl = (name, data, type) => { const a = document.createElement('a'), u = URL.createObjectURL(new Blob([data], {type})); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); };
const XL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const S = {tab: 'gstr1', mode: 'month', month: '', q2b: null, f2b: 'mismatch', data: null, opt: {slab: 'upto1_5', nil: false, freq: 'monthly', hsnDigits: 4, filed: '', due: '', ci: false, itcExcess: 0, perDay: 50, perDayNil: 20, pct: 18}};
try { Object.assign(S.opt, JSON.parse(localStorage.getItem('tp_gstr_opt') || '{}'), {filed: '', due: '', ci: false}); } catch (_) {}
const saveOpt = () => { try { const o = {...S.opt}; delete o.filed; delete o.due; delete o.ci; localStorage.setItem('tp_gstr_opt', JSON.stringify(o)); } catch (_) {} };
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const range = () => {
  const [y, mo] = S.month.split('-').map(Number);
  if (S.mode === 'month') return [PC.ymd(y, mo, 1), PC.ymd(y, mo, PC.daysIn(y, mo))];
  const q0 = Math.floor((mo - 1) / 3) * 3 + 1;
  return [PC.ymd(y, q0, 1), PC.ymd(y, q0 + 2, PC.daysIn(y, q0 + 2))];
};
const label = () => { const [a, b] = range(); return S.mode === 'month' ? PC.monthName(+a.slice(0, 4), +a.slice(5, 7)) : PC.monthName(+a.slice(0, 4), +a.slice(5, 7)) + ' to ' + PC.monthName(+b.slice(0, 4), +b.slice(5, 7)); };
const num = v => (v === '' || v == null) ? '' : inr2(v);
const tbl = (head, rows, right) => '<div class=tablewrap><table><tr>' + head.map((x, i) => '<th' + (right && right.includes(i) ? ' class=r' : '') + '>' + h(x) + '</th>').join('') + '</tr>' + (rows.length ? rows.map(r => '<tr>' + r.map((c, i) => '<td' + (right && right.includes(i) ? ' class=r' : '') + '>' + c + '</td>').join('') + '</tr>').join('') : '<tr><td colspan=' + head.length + ' class=k>Nothing in this period.</td></tr>') + '</table></div>';
const warnBox = w => w.length ? '<div class=card style="border-left:4px solid #d9480f"><h3>Check before you file (' + w.length + ')</h3><ul style="margin:0;padding-left:18px">' + w.slice(0, 40).map(x => '<li>' + h(x.message) + '</li>').join('') + (w.length > 40 ? '<li class=k>and ' + (w.length - 40) + ' more (see the Excel download)</li>' : '') + '</ul></div>' : '<div class=card><p>No warnings.</p></div>';
const hsnTbl = list => tbl(['HSN / SAC', 'Description', 'UQC', 'Qty', 'Rate %', 'Taxable', 'IGST', 'CGST', 'SGST'], list.map(x => [h(x.hsn), h(x.desc), h(x.uqc), x.qty, x.rate, num(x.taxable), num(x.igst), num(x.cgst), num(x.sgst)]), [3, 4, 5, 6, 7, 8]);
const checkBox = v => { const e = v.filter(x => x.level === 'error'), w = v.filter(x => x.level !== 'error');
  return '<div class=card style="border-left:4px solid ' + (e.length ? '#b42318' : w.length ? '#d9480f' : '#2f9e44') + '"><h3>Portal upload check</h3>' +
    (!v.length ? '<p>No problems found that would normally make the portal reject the file.</p>' : (e.length ? '<p><b>' + e.length + ' problem(s) will make the portal reject the file. Fix them in your invoices first.</b></p><ul style="margin:0;padding-left:18px">' + e.slice(0, 30).map(x => '<li>' + h(x.message) + '</li>').join('') + '</ul>' : '') + (w.length ? '<p class=k>' + w.length + ' point(s) to look at:</p><ul style="margin:0;padding-left:18px">' + w.slice(0, 20).map(x => '<li>' + h(x.message) + '</li>').join('') + '</ul>' : '')) + '</div>'; };
const optsBox = (type, r, cash, fpv, own) => {
  const o = S.opt, due = o.due || GR.dueDates(type, fpv, o.freq, own), filed = o.filed || today();
  const res = GR.lateFeeInterest({type, dueDate: due, filedDate: filed, nil: o.nil, slab: o.slab, cash, itcExcess: o.itcExcess, rates: {perDay: +o.perDay, perDayNil: +o.perDayNil, interestPct: +o.pct}});
  const sel = (id, cur, opts) => '<select id=' + id + '>' + opts.map(([v, l]) => '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
  const html = '<div class=card><h3>Late fee' + (type === 'gstr3b' ? ' and interest' : '') + '</h3>' +
    '<div class=f2 style="flex-wrap:wrap;align-items:end"><label>Filing date<input type=date id=lf-filed value="' + h(filed) + '"></label><label>Due date<input type=date id=lf-due value="' + h(due) + '"></label>' +
    '<label>Filing frequency' + sel('lf-freq', o.freq, [['monthly', 'Monthly'], ['qrmp', 'Quarterly (QRMP)']]) + '</label>' +
    '<label>Annual turnover' + sel('lf-slab', o.slab, [['upto1_5', 'Up to ₹1.5 crore'], ['upto5', '₹1.5 to ₹5 crore'], ['above5', 'Above ₹5 crore']]) + '</label>' +
    '<label><input type=checkbox id=lf-nil' + (o.nil ? ' checked' : '') + '> Nil return</label></div>' +
    '<div class=f2 style="flex-wrap:wrap;align-items:end;margin-top:8px"><label>Late fee per day ₹<input type=number id=lf-pd min=0 step=1 value="' + h(o.perDay) + '"></label><label>Nil return per day ₹<input type=number id=lf-pn min=0 step=1 value="' + h(o.perDayNil) + '"></label>' + (type === 'gstr3b' ? '<label>Interest % a year<input type=number id=lf-pct min=0 step=0.5 value="' + h(o.pct) + '"></label><label>ITC wrongly used ₹ (24%)<input type=number id=lf-itc min=0 step=1 value="' + h(o.itcExcess) + '"></label>' : '') + '</div>' +
    (res.late ? '<p><b>' + res.days + ' day(s) late.</b> Late fee ' + inr2(res.lateFee.total) + ' (CGST ' + inr2(res.lateFee.cgst) + ' + SGST ' + inr2(res.lateFee.sgst) + ')' + (res.lateFee.capped ? ', capped at ' + inr2(res.lateFee.cap) : '') + '.' + (type === 'gstr3b' ? ' Interest: IGST ' + inr2(res.interest.igst) + ', CGST ' + inr2(res.interest.cgst) + ', SGST ' + inr2(res.interest.sgst) + (res.interest.itc ? ', excess ITC ' + inr2(res.interest.itc) : '') + ' = <b>' + inr2(res.interest.total) + '</b>.' : '') + '</p>' : '<p>Not late on the dates above. No late fee or interest.</p>') +
    (type === 'gstr3b' ? '<label><input type=checkbox id=lf-ci' + (o.ci ? ' checked' : '') + '> Put the interest (IGST / CGST / SGST) into the 3B JSON</label>' : '') +
    '<p class=k>Interest is worked out on the tax you pay in cash (after credit) for each day after the due date. The late fee is paid separately through the cash ledger. Rates and caps are the usual ones but the government changes them (waivers, amnesty); change the boxes above and check the current notification. Due dates ignore holidays.</p></div>';
  return {html, res};
};
const bindOpts = (body, again) => {
  const g = id => body.querySelector('#' + id), set = (id, k, fn) => { const e = g(id); if (e) e.onchange = () => { S.opt[k] = fn ? fn(e) : e.value; saveOpt(); again(); }; };
  set('lf-filed', 'filed'); set('lf-due', 'due'); set('lf-freq', 'freq'); set('lf-slab', 'slab'); set('lf-nil', 'nil', e => e.checked); set('lf-ci', 'ci', e => e.checked);
  set('lf-pd', 'perDay', e => +e.value || 0); set('lf-pn', 'perDayNil', e => +e.value || 0); set('lf-pct', 'pct', e => +e.value || 0); set('lf-itc', 'itcExcess', e => +e.value || 0);
};

async function loadData() {
  const L = await load(); let notes = [], items = [], noteErr = false;
  try { notes = await fetchAll(() => db.from('gst_notes').select('*')); } catch (_) { noteErr = true; }
  try { items = await fetchAll(() => db.from('invoice_items').select('*')); } catch (_) {}
  return {settings: L.S, parties: L.p, invoices: L.i, notes, items, noteErr};
}
async function mount(m) {
  if (!S.month) S.month = prevMonth();
  const D = S.data = await loadData();
  const draw = () => {
    const [from, to] = range();
    m.innerHTML = '<div class=card><h3>GST returns</h3><p class=k>Working papers built from your sales invoices, purchase bills and credit / debit notes. Use them to prepare and cross-check GSTR-1 and GSTR-3B and to match purchases with GSTR-2B. They do not file anything and change nothing in your books. Check the figures against the portal before you file.</p>' +
      '<div class=f2 style="align-items:end;flex-wrap:wrap"><label>Return period<select id=pm><option value=month' + (S.mode === 'month' ? ' selected' : '') + '>Month</option><option value=quarter' + (S.mode === 'quarter' ? ' selected' : '') + '>Quarter (QRMP)</option></select></label>' +
      '<label>' + (S.mode === 'month' ? 'Month' : 'Any month in the quarter') + '<input type=month id=mo value="' + h(S.month) + '"></label><span class=k>' + h(label()) + ' (' + from + ' to ' + to + ')</span></div>' +
      '<div class=f2 style="margin-top:10px;flex-wrap:wrap" role=tablist>' + [['gstr1', 'GSTR-1'], ['gstr3b', 'GSTR-3B'], ['recon', 'GSTR-2B match']].map(([k, l]) => '<button type=button role=tab aria-selected=' + (S.tab === k) + ' class="' + (S.tab === k ? '' : 'g') + '" data-t="' + k + '">' + l + '</button>').join('') + '</div></div><div id=body></div>';
    m.querySelector('#pm').onchange = e => { S.mode = e.target.value; draw(); };
    m.querySelector('#mo').onchange = e => { if (e.target.value) { S.month = e.target.value; draw(); } };
    m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { S.tab = b.dataset.t; draw(); });
    const body = m.querySelector('#body');
    if (!/^\d{4}-\d{2}$/.test(S.month)) { body.innerHTML = '<div class=card><p>Choose a month.</p></div>'; return; }
    try { (S.tab === 'gstr1' ? g1 : S.tab === 'gstr3b' ? g3 : rc)(body, from, to); } catch (e) { body.innerHTML = '<div class=card><p role=alert style="color:#b42318">' + h(e.message || e) + '</p></div>'; }
  };
  const gstin = () => String(D.settings.gstin || '').trim().toUpperCase();
  const stamp = () => S.month.replace('-', '');
  function g1(body, from, to) {
    const r = GR.gstr1(D, from, to, {hsnDigits: S.opt.hsnDigits}), V = GR.validate1(r, {gstin: gstin(), hsnDigits: S.opt.hsnDigits}), LF = optsBox('gstr1', r, {}, r.fp, gstin().slice(0, 2)), T = r.totals, notesNote = D.noteErr ? '<p class=k>Credit / debit notes are not installed (migration 018), so notes are not included.</p>' : '';
    body.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:12px">' +
      [['Invoices in period', T.invoices, ''], ['B2B (registered)', inr2(T.b2b.taxable) + '<div class=k>' + T.b2b.count + ' invoices · tax ' + inr2(T.b2b.igst + T.b2b.cgst + T.b2b.sgst) + '</div>', ''], ['B2C large (inter-state, above the ₹1 lakh limit)', inr2(T.b2cl.taxable) + '<div class=k>' + T.b2cl.count + ' invoices</div>', ''], ['B2C small (consolidated)', inr2(T.b2cs.taxable) + '<div class=k>tax ' + inr2(T.b2cs.igst + T.b2cs.cgst + T.b2cs.sgst) + '</div>', ''], ['Nil / exempt', inr2(T.nil), '']].map(([l, v]) => '<div class=card style="margin:0"><div class=k>' + l + '</div><div class=v style="font-size:18px">' + v + '</div></div>').join('') + '</div>' +
      '<div class=card><div class=f2 style="flex-wrap:wrap"><button type=button id=x1>Download Excel</button><button type=button class=g id=j1>Download JSON for the offline tool</button></div>' + notesNote + '<p class=k>The JSON follows the GSTR-1 offline-tool layout (HSN split B2B / B2C, document issue, nil, exports). Turnover figures are not included in the file; the portal takes them from your profile. Check the Portal upload check below, then upload on the portal (Returns > GSTR-1 > Prepare offline) or import it into the offline tool first.</p></div>' + checkBox(V) + LF.html + warnBox(r.warnings) +
      '<div class=card><details open><summary><b>B2B: registered customers (' + r.b2b.length + ')</b></summary>' + tbl(['GSTIN', 'Customer', 'Invoice', 'Date', 'Place of supply', 'Rate %', 'Taxable', 'IGST', 'CGST', 'SGST'], r.b2b.flatMap(x => x.rows.map(l => [h(x.gstin), h(x.name), h(x.number), h(x.date), h(x.pos), l.rate, num(l.taxable), num(l.igst), num(l.cgst), num(l.sgst)])), [5, 6, 7, 8, 9]) + '</details></div>' +
      '<div class=card><details><summary><b>B2C large (' + r.b2cl.length + ')</b></summary>' + tbl(['Place of supply', 'Invoice', 'Date', 'Customer', 'Rate %', 'Taxable', 'IGST'], r.b2cl.flatMap(x => x.rows.map(l => [h(x.pos), h(x.number), h(x.date), h(x.customer), l.rate, num(l.taxable), num(l.igst)])), [4, 5, 6]) + '</details></div>' +
      '<div class=card><details><summary><b>B2C small, state and rate wise (' + r.b2cs.length + ')</b></summary>' + tbl(['Type', 'Place of supply', 'Rate %', 'Taxable', 'IGST', 'CGST', 'SGST'], r.b2cs.map(x => [x.type, h(x.pos), x.rate, num(x.taxable), num(x.igst), num(x.cgst), num(x.sgst)]), [2, 3, 4, 5, 6]) + '</details></div>' +
      '<div class=card><details><summary><b>Credit / debit notes to registered customers (' + r.cdnr.length + ') and to consumers (' + r.cdnur.length + ')</b></summary>' + tbl(['Note', 'Date', 'Type', 'Against invoice', 'Customer / GSTIN', 'Rate %', 'Taxable', 'Tax'], r.cdnr.map(x => [h(x.number), h(x.date), x.ntty === 'C' ? 'Credit' : 'Debit', h(x.origNo), h(x.name) + ' ' + h(x.gstin), x.rate, num(x.taxable), num(x.igst + x.cgst + x.sgst)]).concat(r.cdnur.map(x => [h(x.number), h(x.date), x.ntty === 'C' ? 'Credit' : 'Debit', h(x.origNo), h(x.customer), x.rate, num(x.taxable), num(x.igst)])), [5, 6, 7]) + '</details></div>' +
      '<div class=card><details><summary><b>Nil-rated / exempt, exports and SEZ</b></summary>' + tbl(['Nil-rated / exempt', 'Value'], r.nil.map(x => [h(x.label), num(x.taxable)]), [1]) + '<p></p>' + tbl(['Invoice', 'Date', 'Customer', 'Type', 'Taxable', 'IGST'], r.exp.map(x => [h(x.number), h(x.date), h(x.customer), h(x.type), num(x.taxable), num(x.igst)]), [4, 5]) + '</details></div>' +
      '<div class=card><details><summary><b>HSN / SAC summary, registered customers (' + r.hsn.b2b.length + ')</b></summary><p class=k>Credit and debit notes are already taken off these figures.</p>' + hsnTbl(r.hsn.b2b) + '</details></div>' +
      '<div class=card><details><summary><b>HSN / SAC summary, consumers (' + r.hsn.b2c.length + ')</b></summary>' + hsnTbl(r.hsn.b2c) + '</details></div>' +
      '<div class=card><details><summary><b>Documents issued (' + r.docs.length + ')</b></summary>' + tbl(['Document', 'From', 'To', 'Total', 'Cancelled', 'Missing numbers'], r.docs.map(x => [h(x.label), h(x.from), h(x.to), x.total, x.cancelled, x.gaps ? '<b style="color:#b42318">' + x.gaps + '</b>' : '0']), [3, 4, 5]) + '</details></div>';
    bindOpts(body, () => g1(body, from, to));
    body.querySelector('#x1').onclick = () => dl('GSTR1-' + stamp() + '.xlsx', GR.toXlsx(GR.gstr1Sheets(r)), XL);
    body.querySelector('#j1').onclick = () => { const er = V.filter(x => x.level === 'error'); if (er.length && !confirm(er.length + ' problem(s) will make the GST portal reject this file (see Portal upload check). Download anyway?')) return; dl('GSTR1-' + stamp() + '.json', JSON.stringify(GR.gstr1Json(r, gstin()), null, 1), 'application/json'); };
  }
  function g3(body, from, to) {
    const r = GR.gstr3b(D, from, to), LF = optsBox('gstr3b', null, r.t61.cash, r.fp, gstin().slice(0, 2)), a = r.t31, row = (l, x, cols) => '<tr><td>' + l + '<td class=r>' + (cols === 'tax' ? '' : num(x.taxable)) + '<td class=r>' + num(x.igst) + '<td class=r>' + num(x.cgst) + '<td class=r>' + num(x.sgst) + '</tr>';
    body.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:12px">' + [['Output tax (3.1a)', inr2(r.totals.outwardTax)], ['Net ITC (4C)', inr2(r.totals.itcNet)], ['Cash to pay', inr2(r.totals.cash)]].map(([l, v]) => '<div class=card style="margin:0"><div class=k>' + l + '</div><div class=v>' + v + '</div></div>').join('') + '</div>' +
      '<div class=card><div class=f2 style="flex-wrap:wrap"><button type=button id=x3>Download Excel</button><button type=button class=g id=j3>Download JSON</button></div></div>' + warnBox(r.warnings) +
      '<div class=card><h3>3.1 Outward and inward supplies</h3><div class=tablewrap><table><tr><th>Nature<th class=r>Taxable<th class=r>IGST<th class=r>CGST<th class=r>SGST</tr>' + row('(a) Outward taxable supplies (net of credit notes)', a.a) + row('(b) Zero rated: exports / SEZ', a.b) + row('(c) Nil rated and exempt', {taxable: a.c.taxable, igst: '', cgst: '', sgst: ''}) + row('(d) Inward supplies on reverse charge', a.d) + '</table></div></div>' +
      '<div class=card><h3>3.2 Inter-state supplies to consumers, by place of supply</h3>' + tbl(['Place of supply', 'Taxable', 'IGST'], r.t32.unreg.map(x => [h(x.pos), num(x.taxable), num(x.igst)]), [1, 2]) + '</div>' +
      '<div class=card><h3>4 Input tax credit</h3><div class=tablewrap><table><tr><th>Item<th class=r>IGST<th class=r>CGST<th class=r>SGST</tr>' + row('(A)(3) Inward supplies on reverse charge', r.t4.a3, 'tax') + row('(A)(5) All other ITC (purchase bills, ITC allowed)', r.t4.a5, 'tax') + row('(B)(2) Reversed: debit notes on purchases', r.t4.b2, 'tax') + row('<b>(C) Net ITC available</b>', r.t4.net, 'tax') + row('(D)(2) Ineligible ITC (blocked bills, not claimed)', r.t4.ineligible, 'tax') + '</table></div></div>' +
      '<div class=card><h3>6.1 Payment of tax</h3><div class=tablewrap><table><tr><th>Item<th class=r>IGST<th class=r>CGST<th class=r>SGST</tr>' + row('Tax payable on outward supplies', r.t61.outward, 'tax') + row('Tax payable on reverse charge (cash only)', r.t61.rcm, 'tax') +
      '<tr><td>Paid through IGST credit<td class=r>' + num(r.t61.itcUsed.igst.igst) + '<td class=r>' + num(r.t61.itcUsed.igst.cgst) + '<td class=r>' + num(r.t61.itcUsed.igst.sgst) + '</tr><tr><td>Paid through CGST credit<td class=r>' + num(r.t61.itcUsed.cgst.igst) + '<td class=r>' + num(r.t61.itcUsed.cgst.cgst) + '<td class=r></tr><tr><td>Paid through SGST credit<td class=r>' + num(r.t61.itcUsed.sgst.igst) + '<td class=r><td class=r>' + num(r.t61.itcUsed.sgst.sgst) + '</tr>' +
      row('<b>Paid in cash</b>', r.t61.cash, 'tax') + row('Credit left to carry forward', r.t61.carryForward, 'tax') + '</table></div><p class=k>Credit is applied in the order the law requires: IGST credit against IGST, then CGST, then SGST; CGST and SGST credit against their own tax first, then IGST; CGST credit is never used for SGST or the reverse.</p></div>';
    body.insertAdjacentHTML('beforeend', LF.html);
    bindOpts(body, () => g3(body, from, to));
    body.querySelector('#x3').onclick = () => dl('GSTR3B-' + stamp() + '.xlsx', GR.toXlsx(GR.gstr3bSheet(r)), XL);
    body.querySelector('#j3').onclick = () => dl('GSTR3B-' + stamp() + '.json', JSON.stringify(GR.gstr3bJson(r, gstin(), S.opt.ci ? {interest: LF.res.interest} : {}), null, 1), 'application/json');
  }
  function rc(body, from, to) {
    const ready = S.q2b && S.q2b.rows;
    body.innerHTML = '<div class=card><h3>Match purchases with GSTR-2B</h3><p class=k>Upload the GSTR-2B you downloaded from the GST portal: the <b>JSON</b> file (best) or an Excel / CSV with columns for supplier GSTIN, invoice number, invoice date, taxable value and the tax amounts. Your purchase bills are matched by supplier GSTIN and invoice number (ignoring case, dashes and leading zeros). Nothing is saved or changed.</p>' +
      '<label>GSTR-2B file<input type=file id=f2 accept=".json,.xlsx,.csv"></label><p class=k id=ferr role=alert style="color:#b42318"></p>' + (ready ? '<p class=k>Loaded ' + S.q2b.rows.length + ' rows from ' + h(S.q2b.name) + (S.q2b.period ? ' (return period ' + h(S.q2b.period) + ')' : '') + '. Books side: purchase bills dated ' + from + ' to ' + to + '.</p>' : '') + '</div><div id=rb></div>';
    const showErr = t => { body.querySelector('#ferr').textContent = t || ''; };
    body.querySelector('#f2').onchange = async e => { const f = e.target.files[0]; if (!f) return; showErr('');
      try { if (f.size > 20 * 1024 * 1024) throw new Error('This file is larger than 20 MB.'); const buf = new Uint8Array(await f.arrayBuffer()); let res;
        if (/\.json$/i.test(f.name) || buf[0] === 0x7B || (buf[0] === 0xEF && buf[3] === 0x7B)) res = GR.parse2BJson(new TextDecoder().decode(buf));
        else if (/\.xlsx$/i.test(f.name) || (buf[0] === 0x50 && buf[1] === 0x4B)) res = GR.parse2BTable(await IM.readXlsx(buf));
        else if (/\.xls$/i.test(f.name)) throw new Error('Old .xls files are not supported. Save as .xlsx or CSV, or use the JSON file.');
        else res = GR.parse2BTable(IM.parseCSV(IM.decodeText(buf)));
        if (res.gstin && gstin() && res.gstin.toUpperCase() !== gstin()) throw new Error('This 2B belongs to GSTIN ' + res.gstin + ', but your GSTIN in Settings is ' + gstin() + '.');
        S.q2b = {...res, name: f.name}; draw(); } catch (er) { showErr(er.message || String(er)); } };
    if (!ready) return;
    const R = GR.reconcile2B(D, S.q2b.rows, from, to), sm = R.summary, rb = body.querySelector('#rb');
    const tab = (k, l, n) => '<button type=button class="' + (S.f2b === k ? '' : 'g') + '" data-f="' + k + '">' + l + ' (' + n + ')</button>';
    const lines = {mismatch: R.mismatch, probable: R.probable, only2b: R.only2b, onlyBooks: R.onlyBooks, matched: R.matched}[S.f2b] || [];
    const tx = x => x ? x.igst + x.cgst + x.sgst : '';
    rb.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:12px">' + [['ITC per GSTR-2B', inr2(sm.itc2b), ''], ['ITC per your books', inr2(sm.itcBooks), ''], ['ITC at risk (in books, not in 2B)', inr2(sm.atRisk), sm.atRisk ? 'dn' : ''], ['In 2B, not yet booked', inr2(sm.unbooked), sm.unbooked ? 'dn' : ''], ['Tax differences on matched bills', inr2(sm.mismatchTax), sm.mismatchTax ? 'dn' : '']].map(([l, v, c]) => '<div class=card style="margin:0"><div class=k>' + l + '</div><div class="v ' + c + '" style="font-size:18px">' + v + '</div></div>').join('') + '</div>' +
      '<div class=card><div class=f2 style="flex-wrap:wrap">' + tab('mismatch', 'Mismatch', sm.mismatch) + tab('probable', 'Probable', sm.probable) + tab('only2b', 'In 2B, not in books', sm.only2b) + tab('onlyBooks', 'In books, not in 2B', sm.onlyBooks) + tab('matched', 'Matched', sm.matched) + '<button type=button class=g id=xr>Download Excel</button></div>' +
      tbl(['Supplier', 'GSTIN', 'Invoice', 'Date', 'Taxable (books)', 'Tax (books)', 'Taxable (2B)', 'Tax (2B)', 'Difference', 'What to do'], lines.map(x => { const b = x.books, g = x.gst2b, t = g || b; return [h((g && g.supplier) || (b && b.supplier) || ''), h(t.gstin), h((b || g).number) + (b && g && normNo(b.number) !== normNo(g.number) ? '<div class=k>2B: ' + h(g.number) + '</div>' : ''), h((b || g).date), b ? num(b.taxable) : '', b ? num(tx(b)) : '', g ? num(g.taxable) : '', g ? num(tx(g)) : '', x.taxDiff != null ? num(x.taxDiff) : '', S.f2b === 'only2b' ? (g.itc === 'N' ? 'ITC not available per 2B' : 'Book this bill to claim the credit') : S.f2b === 'onlyBooks' ? h(x.reason || 'Do not claim until the supplier reports it') : S.f2b === 'probable' ? 'Invoice number differs: confirm and correct' : S.f2b === 'mismatch' ? 'Ask the supplier or correct the bill' : ''];
      }), [4, 5, 6, 7, 8]) + '</div>' +
      '<div class=card><h3>By supplier</h3>' + tbl(['Supplier', 'GSTIN', 'Matched', 'Mismatch', 'Probable', 'In 2B only', 'In books only', 'ITC at risk'], R.suppliers.map(s => [h(s.supplier), h(s.gstin), s.matched, s.mismatch, s.probable, s.only2b, s.onlyBooks, num(s.atRisk)]), [2, 3, 4, 5, 6, 7]) + '</div>' + (R.warnings.length ? warnBox(R.warnings.map(message => ({message}))) : '');
    rb.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.f2b = b.dataset.f; draw(); });
    rb.querySelector('#xr').onclick = () => dl('GSTR2B-reconciliation-' + stamp() + '.xlsx', GR.toXlsx(GR.reconSheets(R)), XL);
  }
  const normNo = GR.normNo;
  draw();
}
root.ReturnsUI = {mount};
})(typeof window !== 'undefined' ? window : globalThis);
