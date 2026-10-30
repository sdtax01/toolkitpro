/* Toolkit Pro - Import / Export page (screens). The rules live in assets/import-core.js (IM); this file only draws the steps:
   1 choose + template/export + upload   2 map columns   3 check (ledgers, spelling, errors)   4 confirm and post   5 result.
   Nothing is written to the database before the confirmation in step 4. */
(function (root) {
'use strict';
const TYPES = [['sales', 'Sales invoices'], ['purchase', 'Purchase bills'], ['bank', 'Bank entries']];
const MAXROWS = 5000, MAXBYTES = 8 * 1024 * 1024;
const fresh = type => ({type, step: 'start', fileName: '', rows: null, header: null, body: [], map: {}, opt: {dayFirst: true, autoNumber: false, debitMeans: 'out', defaultAccountId: ''}, fixes: {party: {}, account: {}, head: {}, category: {}}, edits: {}, include: {}, skipErrors: false, filter: 'all', busy: false, results: null, built: null, progress: null, cancel: false});
let ST = fresh('sales'), D = null, M = null;
const h = esc;
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()); };
const dl = (name, text, type) => { const a = document.createElement('a'), u = URL.createObjectURL(new Blob([text], {type: type || 'text/csv;charset=utf-8'})); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); };
const fields = () => IM.FIELDS[ST.type];
const kindOf = () => ST.type === 'sales' ? 'sale' : 'purchase';

/* ---------------------------------------------------------------- data ---- */
async function loadData() {
  const L = await load(), out = {S: L.S, parties: L.p, accounts: L.a, invoices: L.i, txns: L.t, lockedThrough: null, heads: {}, categories: {income: [], expense: []}};
  try { const r = await db.from('ledger_settings').select('locked_through,posting_enabled').limit(1), s = r.error ? null : (r.data || [])[0]; if (s && s.posting_enabled && s.locked_through) out.lockedThrough = s.locked_through; } catch (_) {}
  const cats = {income: new Map(), expense: new Map()};
  L.t.forEach(x => { const c = String(x.category || '').trim(); if (c && cats[x.type]) cats[x.type].set(c.toLowerCase(), c); });
  try { const g = await db.from('gl_accounts').select('name,type,bank_account_id,is_active'); if (!g.error) (g.data || []).forEach(a => { if (cats[a.type] && !a.bank_account_id && a.is_active !== false) cats[a.type].set(a.name.toLowerCase(), a.name); }); } catch (_) {}
  out.categories = {income: [...cats.income.values()], expense: [...cats.expense.values()]};
  for (const k of ['sale', 'purchase']) { try { out.heads[k] = await loadHeads(k); } catch (_) { out.heads[k] = {on: false, heads: []}; } }
  return out;
}
const envObj = () => ({gst, gstinOk, RATES, GF, DS: root.DS});
function ctx() {
  const hd = D.heads[kindOf()] || {on: false, heads: []};
  return {env: envObj(), S: D.S, parties: D.parties, accounts: D.accounts, invoices: D.invoices, txns: D.txns, lockedThrough: D.lockedThrough, heads: hd.heads, headsOn: hd.on, fixes: ST.fixes, edits: ST.edits, include: ST.include, categories: D.categories, today: today(),
    nextNo: (k, date, taken) => root.DS ? DS.nextNumber(DS.getSeries(D.S, k), [], date, taken).no : '' };
}
function rebuild() {
  const recs = IM.records(ST.body, ST.map, ST.type);
  ST.built = ST.type === 'bank' ? IM.buildBank(recs, ST.opt, ctx()) : IM.buildDocs(ST.type, recs, ST.opt, ctx());
  return ST.built;
}
const items = () => ST.built ? (ST.type === 'bank' ? ST.built.txns : ST.built.docs) : [];

/* ---------------------------------------------------------------- dialogs ---- */
function dialog(html, wide) {
  const o = document.createElement('div'), prev = document.activeElement; o.className = 'modal';
  o.innerHTML = '<div class=card role=dialog aria-modal=true' + (wide ? ' style="max-width:640px"' : '') + '>' + html + '</div>'; document.body.appendChild(o);
  const close = () => { o.remove(); try { prev && prev.focus && prev.focus(); } catch (_) {} };
  o.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  const f = o.querySelector('input,select,button'); if (f) f.focus();
  return {o, close, card: o.querySelector('.card')};
}

/* ---------------------------------------------------------------- start ---- */
function guide() {
  return '<div class=tablewrap><table class=sm><tr><th>Column<th>Required<th>What to put there</tr>' + fields().map(f => '<tr><td><b>' + h(f.label) + '</b><td>' + (f.req ? 'Yes' : 'Optional') + '<td>' + h(f.hint || '') + '</tr>').join('') + '</table></div>' +
    (ST.type === 'bank' ? '<p class=k><b>Debit</b> is money going <b>out</b> of the bank and <b>Credit</b> money coming <b>in</b>, as on a bank statement (you can flip this on the next screen). With an invoice / bill number the entry settles that document; with a party only, it is booked as an advance; otherwise it goes to the category you give.</p>' : '') +
    '<p class=k>Dates: DD/MM/YYYY or YYYY-MM-DD. Amounts: plain numbers (commas and the rupee sign are fine). Rows whose first cell starts with # are notes and are ignored. Save Excel sheets as .xlsx or CSV.</p>';
}
function drawStart() {
  const T = IM.TITLES[ST.type];
  M.innerHTML = '<div class=card><div class=tabs role=tablist>' + TYPES.map(([k, l]) => '<button role=tab aria-selected="' + (k === ST.type) + '" data-type="' + k + '" class="' + (k === ST.type ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
    '<h3>1. Get the standard template</h3><p class=k>Fill it in Excel (or copy your data into it), then upload it below. The columns are the same ones the export produces, so an export can be edited and imported again.</p>' +
    '<p class=f2><button type=button id=tpl>Download ' + h(T.toLowerCase()) + ' template (CSV)</button><button type=button class=g id=gd>Show column guide</button></p><div id=gdbox hidden>' + guide() + '</div></div>' +
    '<div class=card><h3>2. Upload your file</h3><label class=full style="display:block;border:2px dashed #b8c3e6;border-radius:12px;padding:22px;text-align:center;cursor:pointer" id=drop>Drop a <b>.csv</b> or <b>.xlsx</b> file here, or click to choose<input type=file id=file accept=".csv,.tsv,.txt,.xlsx" style="display:block;margin:10px auto 0"></label><p class=k id=ferr role=alert style="color:#b42318"></p><p class=k>You will map the columns, then check every row before anything is posted. Up to ' + MAXROWS + ' rows per file.</p></div>' +
    '<div class=card><h3>Export existing ' + h(T.toLowerCase()) + '</h3><p class=k>Downloads your current data in the same standard format (UTF-8 CSV that opens in Excel).</p><form class=f id=ex><label>From <input type=date name=from></label><label>To <input type=date name=to></label><button>Export ' + h(T.toLowerCase()) + '</button></form></div>';
  M.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { ST = fresh(b.dataset.type); history.replaceState(null, '', 'import-export.html?type=' + ST.type); draw(); });
  M.querySelector('#tpl').onclick = () => dl('toolkitpro-template-' + ST.type + '.csv', IM.templateCSV(ST.type));
  M.querySelector('#gd').onclick = () => { const b = M.querySelector('#gdbox'); b.hidden = !b.hidden; M.querySelector('#gd').textContent = b.hidden ? 'Show column guide' : 'Hide column guide'; };
  const file = M.querySelector('#file'), drop = M.querySelector('#drop');
  file.onchange = () => file.files[0] && readFile(file.files[0]);
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.style.background = '#eef3ff'; }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => { drop.style.background = ''; }));
  drop.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  M.querySelector('#ex').onsubmit = e => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); doExport(fd.from, fd.to); };
}
async function doExport(from, to) {
  const L = await load(), inR = x => (!from || x.date >= from) && (!to || x.date <= to);
  let it = []; try { it = await fetchAll(() => db.from('invoice_items').select('*')); } catch (_) {}
  const data = {parties: L.p, accounts: L.a, invoices: L.i.filter(inR), transactions: L.t.filter(inR), items: it};
  const rows = ST.type === 'sales' ? IM.exportSales(data) : ST.type === 'purchase' ? IM.exportPurchases(data) : IM.exportBank(data);
  if (rows.length < 2) return toast('Nothing to export for that period.');
  dl('toolkitpro-' + ST.type + '-' + stamp() + '.csv', '﻿' + IM.toCSV(rows)); toast((rows.length - 1) + ' rows exported');
}
async function readFile(f) {
  const err = M.querySelector('#ferr'); err.textContent = '';
  try {
    if (f.size > MAXBYTES) throw new Error('This file is larger than 8 MB. Split it into smaller files.');
    const buf = new Uint8Array(await f.arrayBuffer()); let rows;
    if (/\.xlsx$/i.test(f.name) || (buf[0] === 0x50 && buf[1] === 0x4B)) rows = await IM.readXlsx(buf);
    else if (/\.xls$/i.test(f.name)) throw new Error('Old .xls files are not supported. In Excel choose Save As > Excel Workbook (.xlsx) or CSV.');
    else rows = IM.parseCSV(IM.decodeText(buf));
    if (!rows.length) throw new Error('The file is empty.');
    const {header, body} = IM.detectHeader(rows, ST.type);
    if (!body.length) throw new Error('No data rows were found below the header row.');
    if (body.length > MAXROWS) throw new Error('The file has ' + body.length + ' rows; the limit is ' + MAXROWS + ' per import. Split it.');
    const keep = ST.type; ST = fresh(keep); ST.fileName = f.name; ST.rows = rows; ST.header = header; ST.body = body; ST.map = IM.autoMap(keep, header.cells); ST.step = 'map';
    if (keep === 'bank' && D.accounts.length === 1) ST.opt.defaultAccountId = D.accounts[0].id;
    draw();
  } catch (e) { err.textContent = e.message || String(e); }
}

/* ---------------------------------------------------------------- map ---- */
function drawMap() {
  const hs = ST.header.cells, sample = (ci) => ci < 0 ? '' : ST.body.slice(0, 3).map(r => (r.cells[ci] || '').toString().trim()).filter(Boolean).join(' · ');
  const missing = fields().filter(f => f.req && ST.map[f.k] < 0 && !(f.k === 'account' && ST.opt.defaultAccountId) && !(f.k === 'number' && ST.opt.autoNumber)
    && !(ST.type === 'bank' && (f.k === 'debit' || f.k === 'credit')));
  const bankAmt = ST.type === 'bank' && ST.map.debit < 0 && ST.map.credit < 0;
  if (bankAmt) missing.push({label: 'Debit or Credit'});
  M.innerHTML = '<div class=card><h3>Match your columns</h3><p class=k>File: <b>' + h(ST.fileName) + '</b> · ' + ST.body.length + ' data rows · headings read from row ' + ST.header.n + '. Each template column was matched to the heading of the same meaning; change any that are wrong.</p>' +
    '<div class=tablewrap><table class=sm><tr><th>Template column<th>Column in your file<th>First values</tr>' + fields().map(f => '<tr><td><b>' + h(f.label) + '</b>' + (f.req ? ' <span class=k style="color:#b42318">required</span>' : '') + '<td><select data-f="' + f.k + '" aria-label="' + h(f.label) + '"><option value="-1">— not in my file —</option>' + hs.map((c, i) => '<option value="' + i + '" ' + (ST.map[f.k] === i ? 'selected' : '') + '>' + h(String(c).trim() || '(blank heading)') + ' [' + (i + 1) + ']</option>').join('') + '</select><td class=k data-s="' + f.k + '">' + h(sample(ST.map[f.k])) + '</tr>').join('') + '</table></div></div>' +
    '<div class=card><h3>Options</h3><div class=g2>' +
    '<label>Date format in the file<select id=o-date><option value=dmy ' + (ST.opt.dayFirst ? 'selected' : '') + '>DD/MM/YYYY (day first, India)</option><option value=mdy ' + (!ST.opt.dayFirst ? 'selected' : '') + '>MM/DD/YYYY (month first)</option></select></label>' +
    (ST.type === 'bank' ? '<label>In the Debit column the money is<select id=o-dr><option value=out ' + (ST.opt.debitMeans === 'out' ? 'selected' : '') + '>Going out of the bank (bank statement)</option><option value=in ' + (ST.opt.debitMeans === 'in' ? 'selected' : '') + '>Coming in (your books)</option></select></label>' +
      '<label class=full>Bank account for rows that have none<select id=o-acc><option value="">— none: the file has a Bank Account column —</option>' + D.accounts.map(a => '<option value="' + a.id + '" ' + (ST.opt.defaultAccountId === a.id ? 'selected' : '') + '>' + h(a.name) + '</option>').join('') + '</select></label>'
      : '<label class=full><input type=checkbox id=o-auto style="width:auto" ' + (ST.opt.autoNumber ? 'checked' : '') + '> Give rows with no ' + (ST.type === 'sales' ? 'invoice' : 'bill') + ' number the next number from my series (Settings &gt; Document numbering). Each such row becomes its own document.</label>') +
    '</div></div>' +
    '<div class=card>' + (missing.length ? '<p role=alert style="color:#b42318">Still to match: ' + missing.map(f => h(f.label)).join(', ') + '.</p>' : '') + '<p class=f2><button type=button class=g id=back>Choose another file</button><button type=button id=go ' + (missing.length ? 'disabled' : '') + '>Check my data</button></p></div>';
  M.querySelectorAll('select[data-f]').forEach(s => s.onchange = () => { const used = +s.value; if (used >= 0) for (const k of Object.keys(ST.map)) if (k !== s.dataset.f && ST.map[k] === used) ST.map[k] = -1; ST.map[s.dataset.f] = used; drawMap(); });
  M.querySelector('#o-date').onchange = e => { ST.opt.dayFirst = e.target.value === 'dmy'; };
  const dr = M.querySelector('#o-dr'); if (dr) dr.onchange = e => { ST.opt.debitMeans = e.target.value; };
  const ac = M.querySelector('#o-acc'); if (ac) ac.onchange = e => { ST.opt.defaultAccountId = e.target.value; drawMap(); };
  const au = M.querySelector('#o-auto'); if (au) au.onchange = e => { ST.opt.autoNumber = e.target.checked; drawMap(); };
  M.querySelector('#back').onclick = () => { ST = fresh(ST.type); draw(); };
  M.querySelector('#go').onclick = () => { ST.step = 'check'; rebuild(); draw(); };
}

/* ---------------------------------------------------------------- check ---- */
const LBLS = {ok: ['ok', 'Ready'], warn: ['pp', 'Ready (note)'], error: ['od', 'Error'], dup: ['du', 'Skipped'], pending: ['pp', 'Needs decision']};
const badgeOf = s => '<span class="bd ' + LBLS[s][0] + '">' + LBLS[s][1] + '</span>';
const msgs = list => list.map(i => '<div class=k style="' + (i.level === 'error' ? 'color:#b42318' : i.level === 'pending' ? 'color:#92400e' : i.level === 'warn' ? 'color:#92400e' : '') + '">' + (i.level === 'error' ? '✕ ' : i.level === 'pending' ? '? ' : i.level === 'warn' ? '! ' : i.level === 'dup' ? '↷ ' : '• ') + h(i.msg) + '</div>').join('');
const rowsTxt = rs => 'row' + (rs.length > 1 ? 's ' : ' ') + rs.slice(0, 8).join(', ') + (rs.length > 8 ? ' … (' + rs.length + ')' : '');
const pct = s => Math.round(s * 100) + '%';

function mastersCard() {
  const m = ST.built.masters, blocks = [];
  const pk = ST.type === 'bank' ? null : (ST.type === 'sales' ? 'client' : 'supplier');
  const cand = kind => D.parties.filter(p => p.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of m.party) {
    const kind = e.kind || pk, L = kind === 'client' ? 'Customer' : 'Supplier', ek = h(e.key);
    if (e.status === 'missing') blocks.push('<div class=mrow data-m="party" data-k="' + ek + '"><b>' + L + ' “' + h(e.name) + '”</b> <span class=k>' + rowsTxt(e.rows) + ' · not in your ledger</span>' +
      '<div class=f2 style="flex-wrap:wrap;margin-top:6px">' + e.suggestions.map(s => '<button type=button class=g data-act="use-party" data-id="' + s.party.id + '">Use “' + h(s.party.name) + '” (' + pct(s.score) + ' match)</button>').join('') +
      '<select data-pick aria-label="Choose another ' + L.toLowerCase() + '"><option value="">Choose another…</option>' + cand(kind).map(p => '<option value="' + p.id + '">' + h(p.name) + '</option>').join('') + '</select><button type=button class=g data-act="use-picked">Use</button>' +
      '<button type=button data-act="create-party" data-kind="' + kind + '">Create new ' + L.toLowerCase() + '…</button><button type=button class=g data-act="skip-party">Skip these rows</button></div></div>');
    else blocks.push('<div class=mrow data-m="party" data-k="' + ek + '"><b>' + L + ' “' + h(e.name) + '”</b> <span class=k>' + rowsTxt(e.rows) + ' · ' + (e.status === 'create' ? 'will be created when you post' : e.status === 'skip' ? 'rows left out' : 'matched to “' + h(((D.parties.find(p => p.id === (ST.fixes.party[e.key] || {}).id)) || {}).name || '') + '”') + '</span> <button type=button class=g data-act="undo" data-t="party">Change</button></div>');
  }
  for (const e of m.account) {
    const ek = h(e.key);
    if (e.status === 'missing') blocks.push('<div class=mrow data-m="account" data-k="' + ek + '"><b>Bank account “' + h(e.name) + '”</b> <span class=k>' + rowsTxt(e.rows) + ' · does not exist</span><div class=f2 style="flex-wrap:wrap;margin-top:6px">' +
      e.suggestions.map(s => '<button type=button class=g data-act="use-account" data-id="' + s.account.id + '">Use “' + h(s.account.name) + '” (' + pct(s.score) + ')</button>').join('') +
      '<select data-pick aria-label="Choose another account"><option value="">Choose another…</option>' + D.accounts.map(a => '<option value="' + a.id + '">' + h(a.name) + '</option>').join('') + '</select><button type=button class=g data-act="use-picked-account">Use</button><button type=button data-act="create-account">Create account “' + h(e.name) + '”</button></div></div>');
    else blocks.push('<div class=mrow data-m="account" data-k="' + ek + '"><b>Bank account “' + h(e.name) + '”</b> <span class=k>' + rowsTxt(e.rows) + ' · ' + (e.status === 'create' ? 'will be created when you post (opening balance 0)' : 'matched') + '</span> <button type=button class=g data-act="undo" data-t="account">Change</button></div>');
  }
  for (const e of m.head) {
    const ek = h(e.key);
    if (e.status === 'missing') blocks.push('<div class=mrow data-m="head" data-k="' + ek + '"><b>' + (ST.type === 'sales' ? 'Income' : 'Expense') + ' head “' + h(e.name) + '”</b> <span class=k>' + rowsTxt(e.rows) + ' · not in your Chart of Accounts</span><div class=f2 style="flex-wrap:wrap;margin-top:6px">' +
      e.suggestions.map(s => '<button type=button class=g data-act="use-head" data-id="' + s.head.id + '">Use “' + h(s.head.label) + '” (' + pct(s.score) + ')</button>').join('') + '<button type=button class=g data-act="default-head">Use the default (' + (ST.type === 'sales' ? 'Sales' : 'Purchases') + ')</button></div><p class=k>New heads are added in Books of Accounts &gt; Chart of Accounts.</p></div>');
    else blocks.push('<div class=mrow data-m="head" data-k="' + ek + '"><b>Head “' + h(e.name) + '”</b> <span class=k>' + rowsTxt(e.rows) + ' · decided</span> <button type=button class=g data-act="undo" data-t="head">Change</button></div>');
  }
  for (const e of m.category) {
    const ek = h(e.key);
    if (e.status === 'new') blocks.push('<div class=mrow data-m="category" data-k="' + ek + '"><b>' + (e.type === 'income' ? 'Income' : 'Expense') + ' head “' + h(e.name) + '”</b> <span class=k>' + rowsTxt(e.rows) + ' · does not exist yet. Check the spelling.</span><div class=f2 style="flex-wrap:wrap;margin-top:6px">' +
      e.suggestions.map(s => '<button type=button class=g data-act="use-cat" data-name="' + h(s.name) + '">Use “' + h(s.name) + '” (' + pct(s.score) + ')</button>').join('') + '<button type=button data-act="create-cat">Create head “' + h(e.name) + '”</button></div></div>');
    else blocks.push('<div class=mrow data-m="category" data-k="' + ek + '"><b>Head “' + h(e.name) + '”</b> <span class=k>' + rowsTxt(e.rows) + ' · ' + (e.status === 'create' ? 'will be created when you post' : 'using “' + h(e.use || '') + '”') + '</span> <button type=button class=g data-act="undo" data-t="category">Change</button></div>');
  }
  if (!blocks.length) return '';
  const pend = ST.built.pending;
  return '<div class=card id=masters><h3>Ledgers and spelling' + (pend ? ' <span class="bd pp">' + pend + ' to decide</span>' : ' <span class="bd ok">all decided</span>') + '</h3><p class=k>These names are not in your books exactly as typed. Pick the right one, or create it. Nothing is created until you post.</p>' + blocks.join('') + '</div>';
}
function rowLine(x) {
  if (ST.type !== 'bank') {
    const c = x.calc, pn = x.party ? (x.party.party ? x.party.party.name : (x.party.name || '')) : '', rr = x.rows.slice(0, 4).join(', ') + (x.rows.length > 4 ? '…' : '');
    return '<tr data-st="' + x.status + '"><td>' + badgeOf(x.status) + '<td class=k>' + rr + '<td>' + h(x.number || '—') + (x.auto ? ' <span class=k>(auto)</span>' : '') + '<td>' + h(x.date || '') + '<td>' + h(pn) + '<td class=r>' + (c ? inr2(c.taxable) : '') + '<td class=r>' + (c ? inr2(c.tax) : '') + '<td class=r>' + (c ? inr2(c.amount) : '') + '<td>' + msgs(x.issues) + '</tr>';
  }
  const pn = x.party ? (x.party.party ? x.party.party.name : x.party.name || '') : x.partyName || '', ed = ST.edits[x.n] || {};
  const rawRec = IM.records(ST.body.filter(r => r.n === x.n), ST.map, 'bank')[0] || {v: {}};
  return '<tr data-st="' + x.status + '"><td>' + badgeOf(x.status) + '<td class=k>' + x.n + '<td>' + h(x.date || '') + '<td>' + h(x.account && x.account.account ? x.account.account.name : '') + '<td>' + (x.type ? (x.type === 'income' ? '<span class="bd ok">In</span>' : '<span class="bd od">Out</span>') : '') + '<td class=r>' + (x.amount != null ? inr2(x.amount) : '') + '<td>' + h(x.narration) +
    '<td>' + (x.invoice ? '<span class=k>' + h(x.invoice.number) + '</span>' : '<input data-edit="party" data-n="' + x.n + '" list=dl-party value="' + h(ed.party != null ? ed.party : rawRec.v.party || '') + '" style="width:11em" aria-label="Party for row ' + x.n + '">') +
    '<td>' + (x.invoice ? '' : '<input data-edit="category" data-n="' + x.n + '" list=dl-cat-' + (x.type || 'income') + ' value="' + h(ed.category != null ? ed.category : rawRec.v.category || '') + '" style="width:11em" aria-label="Category for row ' + x.n + '">') +
    '<td>' + msgs(x.issues) + (x.dup && x.status === 'dup' && x.issues.some(i => i.level === 'dup') ? '<label class=k><input type=checkbox data-inc="' + x.n + '" style="width:auto"> Include anyway</label>' : '') + '</tr>';
}
function drawCheck() {
  const b = ST.built, its = items(), c = b.counts, ready = c.ok + c.warn, tot = b.totals;
  const flt = {all: () => true, attn: x => x.status === 'error' || x.status === 'pending' || x.status === 'warn', ready: x => x.status === 'ok' || x.status === 'warn', skipped: x => x.status === 'dup'}[ST.filter] || (() => true);
  const shown = its.filter(flt).slice(0, 400), canPost = ready > 0 && !b.pending && (!c.error || ST.skipErrors);
  const dlParty = D.parties.filter(p => ST.type === 'bank' || true).map(p => '<option value="' + h(p.name) + '">').join('');
  M.innerHTML = '<div class=card><h3>Check your data</h3><p class=k>' + h(ST.fileName) + ' · ' + IM.TITLES[ST.type] + ' · nothing has been posted yet.</p>' +
    '<div class="row c4"><div class=card><div class=k>Ready to post</div><div class="v up">' + ready + '</div></div><div class=card><div class=k>Need a decision</div><div class="v" style="color:#92400e">' + (c.pending || 0) + '</div></div><div class=card><div class=k>Errors</div><div class="v dn">' + (c.error || 0) + '</div></div><div class=card><div class=k>Skipped</div><div class=v>' + (c.dup || 0) + '</div></div></div>' +
    '<p class=k>' + (ST.type === 'bank' ? 'Money in <b>' + inr2(tot.in) + '</b> · money out <b>' + inr2(tot.out) + '</b> · ' + tot.rows + ' entries' : tot.docs + ' ' + (ST.type === 'sales' ? 'invoices' : 'bills') + ' · taxable <b>' + inr2(tot.taxable) + '</b> · GST <b>' + inr2(tot.tax) + '</b> · total <b>' + inr2(tot.amount) + '</b>') + ' (rows that are ready)</p></div>' +
    mastersCard() +
    '<div class=card><div class=tabs>' + [['all', 'All (' + its.length + ')'], ['attn', 'Needs attention (' + its.filter(x => x.status === 'error' || x.status === 'pending' || x.status === 'warn').length + ')'], ['ready', 'Ready (' + ready + ')'], ['skipped', 'Skipped (' + (c.dup || 0) + ')']].map(([k, l]) => '<button data-flt="' + k + '" class="' + (ST.filter === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
    '<div class=tablewrap><table class=sm>' + (ST.type === 'bank' ? '<tr><th>Status<th>Row<th>Date<th>Account<th>Dir<th class=r>Amount<th>Narration<th>Party<th>Category<th>Messages</tr>' : '<tr><th>Status<th>Row<th>Number<th>Date<th>' + (ST.type === 'sales' ? 'Customer' : 'Supplier') + '<th class=r>Taxable<th class=r>GST<th class=r>Total<th>Messages</tr>') + shown.map(rowLine).join('') + (shown.length ? '' : '<tr><td colspan=10>Nothing in this view.</tr>') + '</table></div>' + (its.filter(flt).length > 400 ? '<p class=k>Showing the first 400 rows of this view.</p>' : '') +
    (ST.type === 'bank' ? '<datalist id=dl-party>' + dlParty + '</datalist><datalist id=dl-cat-income>' + D.categories.income.map(x => '<option value="' + h(x) + '">').join('') + '</datalist><datalist id=dl-cat-expense>' + D.categories.expense.map(x => '<option value="' + h(x) + '">').join('') + '</datalist>' : '') + '</div>' +
    '<div class=card>' + (b.pending ? '<p role=alert style="color:#92400e">Decide the ' + b.pending + ' item(s) under “Ledgers and spelling” to continue.</p>' : '') +
    (c.error ? '<label class=full><input type=checkbox id=skiperr style="width:auto" ' + (ST.skipErrors ? 'checked' : '') + '> Skip the ' + c.error + ' row(s) with errors and post the rest (you can download them as a report afterwards)</label>' : '') +
    '<p class=f2><button type=button class=g id=back>Back to column matching</button><button type=button class=g id=rechk>Check again</button><button type=button id=post ' + (canPost ? '' : 'disabled') + '>Review and post ' + ready + ' ' + (ST.type === 'bank' ? 'entries' : ST.type === 'sales' ? 'invoices' : 'bills') + '</button></p></div>';
  M.querySelectorAll('[data-flt]').forEach(bn => bn.onclick = () => { ST.filter = bn.dataset.flt; drawCheck(); });
  M.querySelector('#back').onclick = () => { ST.step = 'map'; draw(); };
  M.querySelector('#rechk').onclick = () => { rebuild(); drawCheck(); toast('Checked again'); };
  const se = M.querySelector('#skiperr'); if (se) se.onchange = () => { ST.skipErrors = se.checked; drawCheck(); };
  const pb = M.querySelector('#post'); if (pb) pb.onclick = confirmPost;
  M.querySelectorAll('[data-edit]').forEach(i => i.onchange = () => { const n = i.dataset.n; ST.edits[n] = Object.assign({}, ST.edits[n], {[i.dataset.edit]: i.value.trim()}); rebuild(); drawCheck(); });
  M.querySelectorAll('[data-inc]').forEach(i => i.onchange = () => { ST.include[i.dataset.inc] = i.checked; rebuild(); drawCheck(); });
  M.querySelectorAll('[data-act]').forEach(bn => bn.onclick = () => masterAction(bn));
}
function masterAction(bn) {
  const row = bn.closest('[data-m]'), t = row.dataset.m, key = row.dataset.k, act = bn.dataset.act, fx = ST.fixes;
  const done = () => { rebuild(); drawCheck(); };
  const picked = () => { const s = row.querySelector('[data-pick]'); return s && s.value; };
  if (act === 'undo') { delete fx[bn.dataset.t][key]; return done(); }
  if (act === 'use-party') { fx.party[key] = {id: bn.dataset.id}; return done(); }
  if (act === 'use-picked') { const v = picked(); if (!v) return alert('Choose a name from the list first.'); fx.party[key] = {id: v}; return done(); }
  if (act === 'skip-party') { fx.party[key] = {skip: true}; return done(); }
  if (act === 'use-account') { fx.account[key] = {id: bn.dataset.id}; return done(); }
  if (act === 'use-picked-account') { const v = picked(); if (!v) return alert('Choose an account from the list first.'); fx.account[key] = {id: v}; return done(); }
  if (act === 'create-account') { fx.account[key] = {create: true}; return done(); }
  if (act === 'use-head') { fx.head[key] = {id: bn.dataset.id}; return done(); }
  if (act === 'default-head') { fx.head[key] = {none: true}; return done(); }
  if (act === 'use-cat') { fx.category[key] = {use: bn.dataset.name}; return done(); }
  if (act === 'create-cat') { fx.category[key] = {create: true}; return done(); }
  if (act === 'create-party') {
    const e = ST.built.masters.party.find(x => x.key === key) || {}, kind = bn.dataset.kind, L = kind === 'client' ? 'customer' : 'supplier';
    const st0 = e.state ? GF.canonState(e.state) : (e.gstin && GF.stateCodeOf(e.gstin, '') ? GF.stateName(GF.stateCodeOf(e.gstin, '')) : '');
    const dlg = dialog('<h3>Create new ' + L + '</h3><form class=g2 id=cp><label class=full>Name<input name=name required value="' + h(e.name || '') + '"></label><label>GSTIN<input name=gstin value="' + h(e.gstin || '') + '" maxlength=15></label>' +
      '<label>GST registration type<select name=gst_type>' + GF.typeOpts().map(o => '<option value="' + o[0] + '" ' + (o[0] === (e.gstin ? 'regular' : 'unregistered') ? 'selected' : '') + '>' + h(o[1]) + '</option>').join('') + '</select></label>' +
      '<label class=full>State / UT (decides CGST+SGST or IGST)<select name=state>' + GF.stateOpts(st0).map(o => '<option value="' + h(o[0]) + '" ' + (GF.canonState(st0) === o[0] ? 'selected' : '') + '>' + h(o[1]) + '</option>').join('') + '</select></label>' +
      '<p class="k full">Address, phone and email can be added later on the ' + L + ' page.</p><div class="f2 full"><button>Use this ' + L + '</button><button type=button class=g data-c>Cancel</button></div></form>');
    dlg.card.querySelector('[data-c]').onclick = dlg.close;
    dlg.card.querySelector('#cp').onsubmit = ev => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); d.gstin = (d.gstin || '').trim().toUpperCase(); d.name = d.name.trim();
      if (!d.name) return; if (d.gstin && !gstinOk(d.gstin) && !confirm('This GSTIN looks invalid (format or check digit). Use it anyway?')) return;
      if ((d.gst_type === 'regular' || d.gst_type === 'composition' || d.gst_type === 'sez') && !d.gstin) return alert('A registered ' + L + ' needs a GSTIN. Choose "Unregistered" if there is none.');
      if (!d.state && d.gstin && GF.stateCodeOf(d.gstin, '')) d.state = GF.stateName(GF.stateCodeOf(d.gstin, ''));
      if (!d.state && !confirm('No state given: tax will be split as CGST+SGST (same state). Continue?')) return;
      if (D.parties.some(p => p.kind === kind && IM.normName(p.name) === IM.normName(d.name))) return alert('A ' + L + ' with this name already exists. Use “Choose another…” to pick it.');
      fx.party[key] = {create: true, name: d.name, gstin: d.gstin, state: d.state, gst_type: d.gst_type}; dlg.close(); done(); };
  }
}

/* ---------------------------------------------------------------- confirm + post ---- */
function confirmPost() {
  const b = ST.built, plan = IM.mastersToCreate(b), c = b.counts, n = c.ok + c.warn, t = b.totals;
  const dlg = dialog('<h3>Post ' + n + ' ' + (ST.type === 'bank' ? 'entries' : ST.type === 'sales' ? 'invoices' : 'bills') + '?</h3>' +
    (ST.type === 'bank' ? '<p>Money in <b>' + inr2(t.in) + '</b>, money out <b>' + inr2(t.out) + '</b>.</p>' : '<p>Taxable <b>' + inr2(t.taxable) + '</b>, GST <b>' + inr2(t.tax) + '</b>, total <b>' + inr2(t.amount) + '</b>.</p>') +
    (plan.parties.length || plan.accounts.length ? '<p>Will also create: ' + plan.parties.map(p => h(p.name) + ' (' + (p.kind === 'client' ? 'customer' : 'supplier') + ')').concat(plan.accounts.map(a => h(a.name) + ' (bank account)')).join(', ') + '.</p>' : '') +
    (c.error ? '<p class=k>' + c.error + ' row(s) with errors will be skipped.</p>' : '') + (c.dup ? '<p class=k>' + c.dup + ' skipped row(s) (already in your books or left out) will not be posted.</p>' : '') +
    '<p class=k>Entries post to your ledger straight away. If something is wrong afterwards, Settings &gt; Data reset can clear posted entries (it downloads a backup first).</p><p class=f2><button type=button id=ok>Post now</button><button type=button class=g id=no>Cancel</button></p>', true);
  dlg.card.querySelector('#no').onclick = dlg.close;
  dlg.card.querySelector('#ok').onclick = () => { dlg.close(); runPost(); };
}
async function runPost() {
  ST.busy = true; ST.cancel = false; ST.step = 'posting'; ST.results = null; ST.progress = {done: 0, total: 1, label: 'Preparing'};
  draw();
  const set = (d, t, l) => { ST.progress = {done: d, total: t, label: l}; const bar = M.querySelector('#pgbar'), tx = M.querySelector('#pgtx'); if (bar) bar.style.width = Math.round(d / Math.max(1, t) * 100) + '%'; if (tx) tx.textContent = d + ' of ' + t + (l ? ' · ' + l : ''); };
  const out = {posted: 0, failed: [], created: [], notes: []};
  try {
    const built = ST.built, plan = IM.mastersToCreate(built), ex = {db, GF, rup, paise, noFn, onProgress: set, cancelled: () => ST.cancel};
    const mk = await IM.createMasters(plan, ex); out.created = [...mk.made.party.values()].map(p => p.name).concat([...mk.made.account.values()].map(a => a.name)); mk.errors.forEach(e => out.failed.push({n: '', message: e}));
    let res = [];
    if (ST.type === 'bank') {
      const series = root.DS ? DS.getSeries(D.S, 'expense') : null, exist = await existingNos('expense', []), reserved = [];
      ex.voucherNo = async date => { if (!series) return ''; const no = DS.nextNumber(series, exist, date, reserved).no; reserved.push(no); return no; }; ex.insertVoucher = insertVoucher;
      const tx = IM.toPostTxns(built, mk.made).filter(t => { if (!t.account_id) { out.failed.push({n: t.n, message: 'Bank account could not be created.'}); return false; } if (t.mode === 'advance' && !t.party_id) { out.failed.push({n: t.n, message: 'Party could not be created.'}); return false; } return true; });
      res = await IM.postBank(tx, ex);
    } else {
      const docs = IM.toPostDocs(built, mk.made).filter(d => { if (!d.party_id) { out.failed.push({n: d.rows[0], message: 'The ' + (ST.type === 'sales' ? 'customer' : 'supplier') + ' could not be created.'}); return false; } return true; });
      res = ST.type === 'sales' ? await IM.postSales(docs, ex) : await IM.postPurchases(docs, ex);
    }
    res.forEach(r => { if (r.status === 'posted') out.posted++; else out.failed.push({n: r.n, message: r.message}); });
  } catch (e) { out.failed.push({n: '', message: 'Import stopped: ' + (e.message || e)}); }
  ST.busy = false; ST.results = out; ST.step = 'done';
  try { D = await loadData(); } catch (_) {}
  draw();
}
function drawPosting() {
  M.innerHTML = '<div class=card role=status aria-live=polite><h3>Posting…</h3><div class=bar><i id=pgbar style="width:0%"></i></div><p class=k id=pgtx>Preparing</p><p class=k>Keep this page open. Each entry is posted to your ledger as it is saved.</p><button type=button class=x id=stop>Stop after the current entry</button></div>';
  M.querySelector('#stop').onclick = e => { ST.cancel = true; e.target.disabled = true; e.target.textContent = 'Stopping…'; };
}
function reportCSV() {
  const bad = new Map(); (ST.results ? ST.results.failed : []).forEach(f => f.n !== '' && bad.set(+f.n, f.message));
  const byRow = new Map(); items().forEach(x => { const rows = x.rows || [x.n]; const st = x.status; const msg = (x.issues || []).filter(i => i.level !== 'info').map(i => i.msg).join(' | '); rows.forEach(r => byRow.set(r, {st, msg})); });
  const out = [ST.header.cells.concat(['Import result'])];
  ST.body.forEach(r => { const f = bad.get(r.n), b = byRow.get(r.n); if (f) out.push(r.cells.concat(['FAILED: ' + f])); else if (b && b.st !== 'ok' && b.st !== 'warn') out.push(r.cells.concat([(b.st === 'dup' ? 'SKIPPED: ' : 'NOT POSTED: ') + b.msg])); });
  return out;
}
function drawDone() {
  const r = ST.results, nf = r.failed.length, rep = reportCSV().length > 1;
  M.innerHTML = '<div class=card role=status><h3>' + (r.posted ? '✓ ' + r.posted + ' ' + (ST.type === 'bank' ? 'entries' : ST.type === 'sales' ? 'invoices' : 'bills') + ' posted' : 'Nothing was posted') + '</h3>' +
    (r.created.length ? '<p>Created: ' + r.created.map(h).join(', ') + '.</p>' : '') + (nf ? '<p style="color:#b42318">' + nf + ' item(s) could not be posted:</p><ul>' + r.failed.slice(0, 30).map(f => '<li>' + (f.n !== '' ? 'Row ' + f.n + ': ' : '') + h(f.message) + '</li>').join('') + '</ul>' + (nf > 30 ? '<p class=k>…and ' + (nf - 30) + ' more (see the report).</p>' : '') : '<p>Every selected row went through.</p>') +
    (ST.cancel ? '<p class=k>You stopped the import; the rest was not posted. Upload the same file again to continue: rows already posted are skipped automatically.</p>' : '') +
    '<p class=f2>' + (rep ? '<button type=button class=g id=rep>Download report of rows not posted</button>' : '') + '<a class=btn href="' + (ST.type === 'bank' ? 'banking.html' : 'invoices.html?kind=' + kindOf()) + '">Open ' + (ST.type === 'bank' ? 'Banking' : ST.type === 'sales' ? 'Sales invoices' : 'Purchase bills') + '</a><button type=button class=g id=again>Import another file</button></p></div>';
  const rp = M.querySelector('#rep'); if (rp) rp.onclick = () => dl('toolkitpro-import-report-' + stamp() + '.csv', '﻿' + IM.toCSV(reportCSV()));
  M.querySelector('#again').onclick = () => { ST = fresh(ST.type); draw(); };
}

/* ---------------------------------------------------------------- shell ---- */
function draw() {
  if (ST.step === 'start') drawStart(); else if (ST.step === 'map') drawMap(); else if (ST.step === 'check') { rebuild(); drawCheck(); } else if (ST.step === 'posting') drawPosting(); else drawDone();
}
async function mount(m) {
  M = m;
  if (ST.busy) return;
  D = await loadData();
  const q = Q.get('type'); if (!ST.rows && ['sales', 'purchase', 'bank'].includes(q) && ST.type !== q && ST.step === 'start') ST = fresh(q);
  draw();
}
const api = {mount, _state: () => ST};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ImportUI = api;
})(typeof window !== 'undefined' ? window : globalThis);
