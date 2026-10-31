/* Toolkit Pro - E-commerce Sales screen: import marketplace reports, see the GSTR-1 / 3B figures per seller GSTIN, download the JSON.
   Calculations live in assets/marketplace-core.js (MP) and assets/gst-returns.js (GR). Needs migration 024; without it the page says what to run. */
(function (root) {
'use strict';
const h = s => esc(s);
const dl = (name, data, type) => { const a = document.createElement('a'), u = URL.createObjectURL(new Blob([data], {type})); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); };
const XL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const missing = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache|could not find the table/i.test(e.message || ''));
const num = v => (v === '' || v == null) ? '' : inr2(v);
const tbl = (head, rows, right) => '<div class=tablewrap><table><tr>' + head.map((x, i) => '<th' + (right && right.includes(i) ? ' class=r' : '') + '>' + h(x) + '</th>').join('') + '</tr>' + (rows.length ? rows.map(r => '<tr>' + r.map((c, i) => '<td' + (right && right.includes(i) ? ' class=r' : '') + '>' + c + '</td>').join('') + '</tr>').join('') : '<tr><td colspan=' + head.length + ' class=k>Nothing in this period.</td></tr>') + '</table></div>';
const S = {seller: '', mode: 'month', month: '', rows: null, fileName: '', sheets: [], sheet: null, buf: null, form: {sellerGstin: '', ecoName: '', ecoGstin: '', stateMap: '', forceType: ''}, map: {}, parsed: null, tcsRate: 0.5, msg: ''};
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const range = () => { const [y, mo] = S.month.split('-').map(Number); if (S.mode === 'month') return [PC.ymd(y, mo, 1), PC.ymd(y, mo, PC.daysIn(y, mo))]; const q0 = Math.floor((mo - 1) / 3) * 3 + 1; return [PC.ymd(y, q0, 1), PC.ymd(y, q0 + 2, PC.daysIn(y, q0 + 2))]; };
const needMig = '<div class=card><h3>E-commerce Sales needs one database step</h3><p>Run <b>supabase/migrations/024_marketplace_sales.sql</b> in the Supabase SQL editor once, then reload this page. Nothing else in the app is affected.</p></div>';
const checkBox = v => { const e = v.filter(x => x.level === 'error'), w = v.filter(x => x.level !== 'error');
  return '<div class=card style="border-left:4px solid ' + (e.length ? '#b42318' : w.length ? '#d9480f' : '#2f9e44') + '"><h3>Portal upload check</h3>' + (!v.length ? '<p>No problems found that would normally make the portal reject the file.</p>' : (e.length ? '<p><b>' + e.length + ' problem(s) will make the portal reject the file.</b> Fix the numbers or GSTINs in the source report and import again.</p><ul style="margin:0;padding-left:18px">' + e.slice(0, 30).map(x => '<li>' + h(x.message) + '</li>').join('') + '</ul>' : '') + (w.length ? '<p class=k>' + w.length + ' point(s) to look at:</p><ul style="margin:0;padding-left:18px">' + w.slice(0, 20).map(x => '<li>' + h(x.message) + '</li>').join('') + '</ul>' : '')) + '</div>'; };

async function mount(m) {
  let orders = [], L;
  const reload = async () => { const r = await fetchAll(() => db.from('marketplace_orders').select('*')); orders = r; };
  try { L = await load(); await reload(); } catch (e) { if (missing(e)) { m.innerHTML = needMig; return; } throw e; }
  const own = String((L.S && L.S.gstin) || '').trim().toUpperCase();
  if (!S.month) S.month = prevMonth();
  if (!S.form.sellerGstin) S.form.sellerGstin = own;
  const sellers = () => [...new Set([own, ...orders.map(o => o.seller_gstin)].filter(Boolean))];
  if (!S.seller) S.seller = sellers()[0] || '';

  const draw = () => {
    const [from, to] = /^\d{4}-\d{2}$/.test(S.month) ? range() : ['', ''];
    m.innerHTML = '<div class=card><h3>E-commerce sales (Amazon, Flipkart, Meesho and similar)</h3><p class=k>Upload the sales / tax report an operator gives a seller. The lines are stored per seller GSTIN, and this page works out what goes into <b>GSTR-1</b> (sales tables, credit notes, <b>Table 14</b>) and the outward figures of <b>GSTR-3B</b>. The tax collected at source (TCS) is checked against the rate. It does not change your invoices, ledgers or reports. If the seller GSTIN is the one in your Settings, these lines are also added to <a href="gst-returns.html">GST Returns</a>.</p></div>' +
      '<div class=card id=imp><h3>1. Import a report</h3><div class=f2 style="flex-wrap:wrap;align-items:end"><label>Report file (.csv or .xlsx)<input type=file id=file accept=".csv,.xlsx,.txt"></label>' +
      (S.sheets.length > 1 ? '<label>Sheet<select id=sheet>' + S.sheets.map(x => '<option' + (x === S.sheet ? ' selected' : '') + '>' + h(x) + '</option>').join('') + '</select></label>' : '') + '</div>' +
      (S.rows ? '<div class=f2 style="flex-wrap:wrap;align-items:end;margin-top:8px"><label>Seller GSTIN (your client)<input id=sg value="' + h(S.form.sellerGstin) + '" maxlength=15 style="text-transform:uppercase"></label><label>Operator name<input id=en value="' + h(S.form.ecoName) + '" placeholder="Amazon, Flipkart ..."></label><label>Operator GSTIN (ECO)<input id=eg value="' + h(S.form.ecoGstin) + '" maxlength=15 style="text-transform:uppercase"></label>' +
        '<label>File contains<select id=ft>' + [['', 'Sales and returns (read from the file)'], ['sale', 'Only sales'], ['return', 'Only returns / refunds']].map(([v, l]) => '<option value="' + v + '"' + (S.form.forceType === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label></div>' +
        '<details style="margin-top:8px"' + (S.form.stateMap ? ' open' : '') + '><summary>Operator has a different GSTIN for each state? (optional)</summary><label>One per line: <i>ship-from state = operator GSTIN</i><textarea id=sm rows=3 style="width:100%" placeholder="Maharashtra = 27AAAAA0000A1Z5">' + h(S.form.stateMap) + '</textarea></label></details>' +
        '<div class=f2 style="margin-top:8px"><button type=button id=chk>Check the file</button><span class=k>' + h(S.fileName) + '</span></div>' : '') +
      '<p role=alert class=k id=impmsg style="color:#b42318">' + h(S.msg) + '</p><div id=prev></div></div>' +
      '<div class=card><h3>2. Return figures</h3><div class=f2 style="flex-wrap:wrap;align-items:end"><label>Seller GSTIN<select id=sel>' + (sellers().length ? sellers().map(g => '<option' + (g === S.seller ? ' selected' : '') + '>' + h(g) + '</option>').join('') : '<option value="">(import a report first)</option>') + '</select></label>' +
      '<label>Return period<select id=pm><option value=month' + (S.mode === 'month' ? ' selected' : '') + '>Month</option><option value=quarter' + (S.mode === 'quarter' ? ' selected' : '') + '>Quarter (QRMP)</option></select></label><label>' + (S.mode === 'month' ? 'Month' : 'Any month in the quarter') + '<input type=month id=mo value="' + h(S.month) + '"></label>' +
      '<label>TCS rate %<input type=number id=tr step=0.05 min=0 value="' + h(S.tcsRate) + '" style="width:90px"></label></div></div><div id=out></div><div id=files></div>';
    wire(); preview(); out(from, to); files();
  };
  const g = id => m.querySelector('#' + id);
  const keep = () => { const v = id => g(id) ? g(id).value : null; if (g('sg')) { S.form.sellerGstin = v('sg').trim().toUpperCase(); S.form.ecoName = v('en').trim(); S.form.ecoGstin = v('eg').trim().toUpperCase(); S.form.forceType = v('ft'); S.form.stateMap = v('sm'); } };
  async function readRows() {
    const buf = S.buf; let rows;
    if (S.sheets.length) rows = await IM.readXlsx(buf, S.sheet); else rows = IM.parseCSV(IM.decodeText(buf));
    S.rows = rows; S.map = {}; S.parsed = null; S.msg = '';
  }
  function wire() {
    g('file').onchange = async e => { const f = e.target.files[0]; if (!f) return; S.msg = '';
      try { if (f.size > 40 * 1024 * 1024) throw new Error('This file is larger than 40 MB. Split it by month.'); const buf = new Uint8Array(await f.arrayBuffer()); S.buf = buf; S.fileName = f.name; S.sheets = []; S.sheet = null;
        if (/\.xls$/i.test(f.name)) throw new Error('Old .xls files are not supported. Save as .xlsx or CSV.');
        if (/\.xlsx$/i.test(f.name) || (buf[0] === 0x50 && buf[1] === 0x4B)) { S.sheets = await IM.xlsxSheets(buf); const pick = S.sheets.find(x => /sales|tax|gst|b2c|b2b|mtr|report/i.test(x) && !/help|read ?me|instruction/i.test(x)); S.sheet = pick || S.sheets[0]; }
        await readRows(); } catch (er) { S.rows = null; S.msg = er.message || String(er); }
      draw(); };
    if (g('sheet')) g('sheet').onchange = async e => { S.sheet = e.target.value; try { await readRows(); } catch (er) { S.rows = null; S.msg = er.message; } draw(); };
    if (g('chk')) g('chk').onclick = () => { keep(); S.parsed = run(); draw(); };
    g('sel').onchange = e => { S.seller = e.target.value; draw(); };
    g('pm').onchange = e => { S.mode = e.target.value; draw(); };
    g('mo').onchange = e => { if (e.target.value) { S.month = e.target.value; draw(); } };
    g('tr').onchange = e => { S.tcsRate = +e.target.value || 0; draw(); };
  }
  function run() {
    const sm = MP.parseStateMap(S.form.stateMap);
    const p = MP.parse(S.rows, {sellerGstin: S.form.sellerGstin, ecoGstin: S.form.ecoGstin, ecoName: S.form.ecoName, stateMap: sm.map, map: S.map, forceType: S.form.forceType, source: S.fileName});
    if (sm.bad.length) p.warnings.push('Not understood in the state list: ' + sm.bad.join('; '));
    return p;
  }
  function preview() {
    const box = g('prev'), p = S.parsed; if (!box || !p) return;
    const hdr = p.headers || [], F = MP.FIELDS;
    const mapUi = '<details' + (p.error ? ' open' : '') + '><summary>Columns found in the file (change if wrong)</summary><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:6px;margin-top:6px">' + Object.keys(F).map(f => '<label>' + h(F[f][0]) + '<select data-f="' + f + '"><option value="-1">(not in the file)</option>' + hdr.map((x, i) => '<option value="' + i + '"' + (p.map[f] === i ? ' selected' : '') + '>' + h(x || ('column ' + (i + 1))) + '</option>').join('') + '</select></label>').join('') + '</div></details>';
    let html = mapUi;
    if (p.error) html = '<p role=alert style="color:#b42318"><b>' + h(p.error) + '</b></p>' + html;
    else {
      const st = p.stats; html = '<p><b>' + st.lines + ' line(s) ready</b> (' + st.sales + ' sales, ' + st.returns + ' returns) dated ' + h(st.from) + ' to ' + h(st.to) + '.' + (st.skipped ? ' <b>' + st.skipped + ' skipped.</b>' : '') + '</p>' +
        (p.warnings.length ? '<ul style="margin:0;padding-left:18px;color:#b54708">' + p.warnings.map(w => '<li>' + h(w) + '</li>').join('') + '</ul>' : '') +
        (p.skipped.length ? '<details><summary>Skipped lines (' + p.skipped.length + ')</summary><ul style="margin:0;padding-left:18px">' + p.skipped.slice(0, 40).map(x => '<li>Row ' + x.n + ': ' + h(x.reason) + '</li>').join('') + (p.skipped.length > 40 ? '<li class=k>and ' + (p.skipped.length - 40) + ' more</li>' : '') + '</ul></details>' : '') + html +
        '<div class=f2 style="margin-top:8px"><button type=button id=go' + (st.lines ? '' : ' disabled') + '>Import ' + st.lines + ' line(s)</button><span class=k>Lines already imported are ignored, so uploading the same report twice is safe.</span></div>';
    }
    box.innerHTML = html;
    box.querySelectorAll('[data-f]').forEach(s => s.onchange = () => { keep(); S.map[s.dataset.f] = +s.value; S.parsed = run(); draw(); });
    const go = box.querySelector('#go'); if (go) go.onclick = async () => {
      go.disabled = true; const have = new Set(orders.map(o => o.row_key)), fresh = p.orders.filter(o => !have.has(o.row_key)), batch = (S.fileName || 'report') + ' @ ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
      try { for (let i = 0; i < fresh.length; i += 400) { const r = await db.from('marketplace_orders').insert(fresh.slice(i, i + 400).map(o => ({...o, batch}))); if (r.error) throw r.error; }
        await reload(); S.seller = p.orders[0] ? p.orders[0].seller_gstin : S.seller; S.parsed = null; S.rows = null; S.msg = ''; toast(fresh.length + ' line(s) imported' + (p.orders.length - fresh.length ? ', ' + (p.orders.length - fresh.length) + ' already there' : ''));
        if (p.stats.from) S.month = p.stats.from.slice(0, 7); draw(); } catch (e) { S.msg = e.message || String(e); go.disabled = false; draw(); } };
  }
  function out(from, to) {
    const box = g('out'); if (!box) return; if (!S.seller || !from) { box.innerHTML = ''; return; }
    const mine = orders.filter(o => o.seller_gstin === S.seller);
    if (!mine.some(o => o.invoice_date >= from && o.invoice_date <= to)) { box.innerHTML = '<div class=card><p>No lines for ' + h(S.seller) + ' between ' + h(from) + ' and ' + h(to) + '.' + (mine.length ? ' Lines exist for ' + h(mine.reduce((a, o) => a < o.invoice_date ? a : o.invoice_date, mine[0].invoice_date)) + ' to ' + h(mine.reduce((a, o) => a > o.invoice_date ? a : o.invoice_date, mine[0].invoice_date)) + '.' : '') + '</p></div>'; return; }
    const R = MP.prepare(orders, S.seller, from, to, {tcsRate: S.tcsRate}), r1 = R.r1, r3 = R.r3, V = GR.validate1(r1, {gstin: S.seller, hsnDigits: 4}), T = r1.totals, sp = r1.supeco.clttx, tcs = R.tcs;
    const tax = x => x.igst + x.cgst + x.sgst;
    box.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:12px">' +
      [['Invoices', T.invoices], ['Net taxable (Table 14)', inr2(sp.reduce((s, x) => s + x.suppval, 0))], ['Output tax (3.1a)', inr2(r3.totals.outwardTax)], ['TCS per report', inr2(tcs.file) + '<div class=k>expected ' + inr2(tcs.expected) + ' at ' + tcs.rate + '%</div>']].map(([l, v]) => '<div class=card style="margin:0"><div class=k>' + h(l) + '</div><div class=v>' + v + '</div></div>').join('') + '</div>' +
      '<div class=card><div class=f2 style="flex-wrap:wrap"><button type=button id=j1>Download GSTR-1 JSON</button><button type=button class=g id=x1>Download Excel</button></div><p class=k>The JSON holds only this seller\'s e-commerce sales (B2B, B2C, credit notes, Table 14, HSN, documents issued). ' + (S.seller === own ? 'This is your own GSTIN: for a combined file with your other invoices use <a href="gst-returns.html">GST Returns</a>, which includes these lines.' : 'Upload it on the portal under Returns > GSTR-1 > Prepare offline, or import it into the offline tool first. If this client has other sales, merge them in the portal or add them before uploading.') + '</p></div>' +
      checkBox(V) + (r1.warnings.length ? '<div class=card style="border-left:4px solid #d9480f"><h3>Check before you file (' + r1.warnings.length + ')</h3><ul style="margin:0;padding-left:18px">' + r1.warnings.slice(0, 25).map(x => '<li>' + h(x.message) + '</li>').join('') + '</ul></div>' : '') +
      '<div class=card><h3>Table 14: supplies through an e-commerce operator (operator collects TCS)</h3><p class=k>Net of returns, per operator GSTIN. This is a summary only; the same sales are also in the tables below.</p>' + tbl(['Operator GSTIN', 'Operator', 'Net taxable value', 'IGST', 'CGST', 'SGST'], sp.map(x => [h(x.etin), h(x.name), num(x.suppval), num(x.igst), num(x.cgst), num(x.sgst)]), [2, 3, 4, 5]) + '</div>' +
      '<div class=card><h3>Tax collected at source (TCS)</h3>' + tbl(['Operator GSTIN', 'Net taxable', 'TCS in the report', 'TCS at ' + tcs.rate + '%', 'Difference'], tcs.rows.map(x => [h(x.etin), num(x.net), num(x.file), num(x.expected), x.diff ? '<b style="color:#b54708">' + inr2(x.diff) + '</b>' : '0.00']), [1, 2, 3, 4]) +
      '<p class=k>The operator pays this tax to the government and files GSTR-8. It shows as credit in your electronic cash ledger once their return is filed (check GSTR-2B / the TCS credit screen and the cash ledger on the portal), and you use it when paying GSTR-3B. A difference here usually means the operator has not collected or reported it yet. The rate is the usual 0.5% (0.25% + 0.25% or 0.5% IGST); confirm the current rate.</p></div>' +
      '<div class=card><details open><summary><b>B2B: registered buyers (' + r1.b2b.length + ')</b></summary>' + tbl(['GSTIN', 'Invoice', 'Date', 'Place of supply', 'Rate %', 'Taxable', 'IGST', 'CGST', 'SGST'], r1.b2b.flatMap(x => x.rows.map(l => [h(x.gstin), h(x.number), h(x.date), h(x.pos), l.rate, num(l.taxable), num(l.igst), num(l.cgst), num(l.sgst)])), [4, 5, 6, 7, 8]) + '</details></div>' +
      '<div class=card><details open><summary><b>B2C small, state and rate wise (' + r1.b2cs.length + ')</b></summary>' + tbl(['Type', 'Place of supply', 'Rate %', 'Taxable', 'IGST', 'CGST', 'SGST'], r1.b2cs.map(x => [x.type, h(x.pos), x.rate, num(x.taxable), num(x.igst), num(x.cgst), num(x.sgst)]), [2, 3, 4, 5, 6]) + '</details></div>' +
      '<div class=card><details><summary><b>B2C large (' + r1.b2cl.length + ')</b> and <b>credit notes to registered buyers (' + r1.cdnr.length + ')</b></summary>' + tbl(['Place of supply', 'Invoice', 'Date', 'Rate %', 'Taxable', 'IGST'], r1.b2cl.flatMap(x => x.rows.map(l => [h(x.pos), h(x.number), h(x.date), l.rate, num(l.taxable), num(l.igst)])), [3, 4, 5]) + '<p></p>' + tbl(['Note', 'Date', 'GSTIN', 'Rate %', 'Taxable', 'IGST', 'CGST', 'SGST'], r1.cdnr.map(x => [h(x.number), h(x.date), h(x.gstin), x.rate, num(x.taxable), num(x.igst), num(x.cgst), num(x.sgst)]), [3, 4, 5, 6, 7]) + '</details></div>' +
      '<div class=card><details><summary><b>GSTR-3B outward figures</b></summary>' + tbl(['', 'Taxable', 'IGST', 'CGST', 'SGST'], [['3.1(a) Outward taxable supplies (net of returns)', num(r3.t31.a.taxable), num(r3.t31.a.igst), num(r3.t31.a.cgst), num(r3.t31.a.sgst)]], [1, 2, 3, 4]) + '<p></p>' + tbl(['3.2 Inter-state to consumers: place of supply', 'Taxable', 'IGST'], r3.t32.unreg.map(x => [h(x.pos), num(x.taxable), num(x.igst)]), [1, 2]) + '<p class=k>Purchases, input credit and the payment set-off for this client come from their own books. ' + (S.seller === own ? 'For your own GSTIN the GST Returns page combines everything.' : '') + '</p></details></div>';
    g('j1').onclick = () => { const er = V.filter(x => x.level === 'error'); if (er.length && !confirm(er.length + ' problem(s) will make the GST portal reject this file (see Portal upload check). Download anyway?')) return; dl('GSTR1-ecommerce-' + S.seller + '-' + from.slice(0, 7).replace('-', '') + '.json', JSON.stringify(GR.gstr1Json(r1, S.seller), null, 1), 'application/json'); };
    g('x1').onclick = () => dl('GSTR1-ecommerce-' + S.seller + '-' + from.slice(0, 7).replace('-', '') + '.xlsx', GR.toXlsx(GR.gstr1Sheets(r1)), XL);
  }
  function files() {
    const box = g('files'); if (!box || !orders.length) return;
    const by = new Map(); orders.forEach(o => { const k = o.batch || '(no batch)'; const x = by.get(k) || {k, seller: o.seller_gstin, n: 0, from: o.invoice_date, to: o.invoice_date}; x.n++; if (o.invoice_date < x.from) x.from = o.invoice_date; if (o.invoice_date > x.to) x.to = o.invoice_date; by.set(k, x); });
    box.innerHTML = '<div class=card><details><summary><b>Imported files (' + by.size + ')</b></summary>' + tbl(['File', 'Seller GSTIN', 'Lines', 'From', 'To', ''], [...by.values()].map(x => [h(x.k), h(x.seller), x.n, h(x.from), h(x.to), '<button type=button class=g data-del="' + h(x.k) + '">Delete</button>']), [2]) + '<p class=k>Deleting removes only these imported lines. Your invoices and books are not touched.</p></details></div>';
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const k = b.dataset.del; if (!confirm('Delete all lines imported from "' + k + '"?')) return;
      const r = await db.from('marketplace_orders').delete().eq('batch', k); if (r.error) { alert(r.error.message); return; } await reload(); toast('Deleted'); draw(); });
  }
  draw();
}
root.MarketplaceUI = {mount};
})(typeof window !== 'undefined' ? window : globalThis);
