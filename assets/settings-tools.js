/* Toolkit Pro - Settings tools: document numbering series and "Reset posted entries".
   Loaded by settings.html after app.js, gst-fields.js and doc-series.js; uses the globals app.js defines (db, esc, toast, fetchAll, noFn, noTable, load ...).
   Reset needs migration 022 once the ledger is switched on (posted journals are locked in the database). With the ledger off it also works without it. */
(function (root) {
'use strict';

/* ---------------------------------------------------------------- numbering series ---- */
async function mountSeries(el, S) {
  const kinds = DS.KINDS, has = S && S.id ? ('doc_series' in S) : true;
  const cur = {};
  kinds.forEach(k => cur[k] = DS.getSeries(S, k));
  let inv = []; try { inv = (await load()).i; } catch (_) {}
  const existing = {};
  for (const k of kinds) existing[k] = await existingNos(k, inv);
  const row = k => { const s = cur[k], d = DS.DEFAULTS[k];
    return `<tr data-k="${k}"><td><b>${DS.LABELS[k]}</b>${DS.GST_DOC[k] ? '<br><span class=k>GST document: 16 characters max</span>' : ''}
      <td><input data-f=prefix value="${esc(s.prefix)}" aria-label="${DS.LABELS[k]} prefix" style="width:9em" maxlength=20>
      <td><input data-f=digits type=number min=1 max=9 value="${s.digits}" aria-label="${DS.LABELS[k]} digits" style="width:4.5em">
      <td><input data-f=start type=number min=1 value="${s.start}" aria-label="${DS.LABELS[k]} start number" style="width:6em">
      <td><input data-f=suffix value="${esc(s.suffix)}" aria-label="${DS.LABELS[k]} suffix" style="width:7em" maxlength=20>
      <td><span data-pv class=k></span><div data-is class=k style="color:#b42318"></div>
      <td><button type=button class=g data-rs title="Back to ${esc(d.prefix)}0001">Default</button></tr>`; };
  el.innerHTML = `<h3>Document numbering</h3>
    <p class=k>Choose how new documents are numbered. The next number is always the highest one already used in the series plus one, so nothing is ever renumbered and clashes are impossible. Use <b>{FY}</b> for the financial year (2026-27) or <b>{FYS}</b> for the short form (26-27); the series then starts again at 1 every 1 April. Example: <code>SDS/{FYS}/</code> gives SDS/26-27/001.</p>
    ${has ? '' : '<p class=k style="color:#b42318">Run <b>supabase/migrations/022_series_import_reset.sql</b> in Supabase to save these settings. Until then the standard numbers (INV-0001, BILL-0001, ...) are used.</p>'}
    <div class=tablewrap><table><tr><th>Document<th>Prefix<th>Digits<th>Start at<th>Suffix<th>Next number<th></tr>${kinds.map(row).join('')}</table></div>
    <p><button id=ssave ${has ? '' : 'disabled'}>Save numbering</button></p>`;
  const rows = [...el.querySelectorAll('tr[data-k]')];
  const read = tr => { const o = {}; tr.querySelectorAll('[data-f]').forEach(i => o[i.dataset.f] = i.value); return DS.clean(tr.dataset.k, o); };
  const upd = () => { let hard = false;
    rows.forEach(tr => { const k = tr.dataset.k, s = read(tr), is = DS.issues(k, s);
      tr.querySelector('[data-pv]').textContent = DS.nextNumber(s, existing[k], today()).no;
      tr.querySelector('[data-is]').innerHTML = is.map(x => esc(x.msg)).join('<br>');
      if (is.some(x => x.hard)) hard = true; });
    el.querySelector('#ssave').disabled = !has || hard; };
  el.addEventListener('input', upd);
  el.querySelectorAll('[data-rs]').forEach(b => b.onclick = () => { const tr = b.closest('tr'), d = DS.DEFAULTS[tr.dataset.k];
    tr.querySelectorAll('[data-f]').forEach(i => i.value = d[i.dataset.f]); upd(); });
  upd();
  el.querySelector('#ssave').onclick = () => guard(el, async () => {
    const map = {}; rows.forEach(tr => map[tr.dataset.k] = read(tr));
    const value = DS.toStore(map), r = await (S.id ? db.from('settings').update({doc_series: value}).eq('id', S.id) : db.from('settings').insert({doc_series: value}));
    if (r.error) return alert(GF.colErr(r.error) ? 'Run supabase/migrations/022_series_import_reset.sql in Supabase first, then try again.' : r.error.message);
    toast('Numbering saved. New documents use it from now on.'); });
}

/* ---------------------------------------------------------------- backup + reset ---- */
const BACKUP_TABLES = ['invoices', 'invoice_items', 'transactions', 'gst_notes', 'tds_entries', 'stock_valuations', 'fixed_asset_dep', 'journals', 'journal_lines'];
const SHOW = [['sales_invoices', 'sales invoices'], ['purchase_bills', 'purchase bills'], ['transactions', 'receipts, payments and expenses'], ['notes', 'credit / debit notes'], ['tds_entries', 'TDS entries'], ['stock_entries', 'closing-stock entries'], ['depreciation_entries', 'depreciation postings'], ['journals', 'journal entries (automatic and manual)']];
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); };
function download(name, text, type) {
  const a = document.createElement('a'), u = URL.createObjectURL(new Blob([text], {type: type || 'application/json'}));
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
}
/* Every posted-entry table as one JSON file. Tables that do not exist yet are skipped. */
async function backup() {
  const out = {app: 'Toolkit Pro', kind: 'posted-entries-backup', created: new Date().toISOString(), tables: {}};
  for (const t of BACKUP_TABLES) {
    try { out.tables[t] = await fetchAll(() => db.from(t).select('*')); }
    catch (e) { if (noTable(e)) continue; throw new Error('Backup of ' + t + ' failed: ' + (e.message || e)); }
  }
  const total = Object.values(out.tables).reduce((s, l) => s + l.length, 0);
  download('toolkitpro-backup-' + stamp() + '.json', JSON.stringify(out, null, 1));
  return total;
}
/* What a reset would erase, and how: {mode:'rpc'|'client'|'needs_migration', counts, blocked} */
async function plan() {
  const r = await db.rpc('reset_posted_entries', {p_confirm: '', p_dry_run: true});
  if (!r.error) return {mode: 'rpc', counts: r.data};
  if (r.error.code === 'TP001') return {mode: 'rpc', blocked: r.error.message};
  if (!noFn(r.error)) throw r.error;
  const ls = await db.from('ledger_settings').select('posting_enabled').limit(1);
  if (!ls.error && ((ls.data || [])[0] || {}).posting_enabled) return {mode: 'needs_migration'};
  const {i, t} = await load(), cnt = async tb => { const q = await db.from(tb).select('id', {count: 'exact', head: true}); return q.error ? 0 : (q.count || 0); };
  return {mode: 'client', counts: {sales_invoices: i.filter(x => x.kind === 'sale').length, purchase_bills: i.filter(x => x.kind === 'purchase').length, transactions: t.length, notes: await cnt('gst_notes'), tds_entries: await cnt('tds_entries')}};
}
/* Ledger switched off (or not installed): plain deletes in a safe order. */
async function clientReset() {
  const NIL = '00000000-0000-0000-0000-000000000000', del = async (tb, soft) => { const r = await db.from(tb).delete().neq('id', NIL); if (r.error && !(soft && (noTable(r.error) || GF.colErr(r.error)))) throw r.error; };
  await del('gst_notes', 1); await del('tds_entries', 1); await del('transactions'); await del('invoice_items', 1); await del('invoices');
}
function modal(html) {
  const o = document.createElement('div'), prev = document.activeElement; o.className = 'modal';
  o.innerHTML = `<div class=card role=dialog aria-modal=true aria-labelledby=rst-t style="max-width:620px">${html}</div>`;
  document.body.appendChild(o);
  const close = () => { o.remove(); try { prev && prev.focus && prev.focus(); } catch (_) {} };
  o.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  o.addEventListener('mousedown', e => { if (e.target === o) close(); });
  return {o, close};
}
function mountReset(el) {
  el.innerHTML = `<h3>Data reset</h3>
    <p class=k>Erases <b>only the entries you have posted</b>: sales invoices, purchase bills, receipts, payments, expenses, credit / debit notes, TDS entries, closing stock, depreciation and the journals made from them. Customers, suppliers, bank accounts and opening balances, chart of accounts, fixed-asset register, settings, numbering series, budgets, goals and documents are <b>not touched</b>. Useful after a trial run or a test import. A backup file is downloaded automatically first.</p>
    <button type=button class=x id=rstbtn>Reset posted entries…</button>`;
  el.querySelector('#rstbtn').onclick = async () => {
    const m = modal('<h3 id=rst-t>Reset posted entries</h3><p class=k>Checking what would be erased…</p>');
    const body = m.o.querySelector('.card');
    let p; try { p = await plan(); } catch (e) { body.innerHTML = '<h3 id=rst-t>Reset posted entries</h3><p>Could not check: ' + esc(e.message || e) + '</p><button type=button class=g id=rx>Close</button>'; body.querySelector('#rx').onclick = m.close; return; }
    const rows = p.counts ? SHOW.filter(([k]) => p.counts[k] != null && (p.counts[k] > 0 || ['sales_invoices', 'purchase_bills', 'transactions'].includes(k))).map(([k, l]) => `<li><b>${p.counts[k]}</b> ${l}`).join('') : '';
    const none = p.counts && SHOW.every(([k]) => !(p.counts[k] > 0));
    body.innerHTML = `<h3 id=rst-t>Reset posted entries</h3>
      ${p.blocked ? `<p role=alert style="color:#b42318">${esc(p.blocked)}</p>` : p.mode === 'needs_migration' ? '<p role=alert style="color:#b42318">Your ledger is switched on, so posted journals are locked in the database. Run <b>supabase/migrations/022_series_import_reset.sql</b> in Supabase once, then come back.</p>' : none ? '<p>There are no posted entries to erase.</p>' : `<p>This will permanently erase:</p><ul>${rows}</ul><p class=k>Everything else stays exactly as it is. This cannot be undone; the backup file is the only way back.</p>
      <label class=full>Type <b>RESET</b> to confirm<input id=rc autocomplete=off placeholder=RESET style="width:100%"></label>`}
      <p class=f2 style="margin-top:12px"><button type=button class=x id=rgo disabled>Download backup and erase</button><button type=button class=g id=rbk ${p.counts ? '' : 'disabled'}>Backup only</button><button type=button class=g id=rx>Cancel</button></p>`;
    body.querySelector('#rx').onclick = m.close;
    body.querySelector('#rbk').onclick = async e => { e.target.disabled = true; try { toast('Backup downloaded (' + await backup() + ' records)'); } catch (er) { alert(er.message); } e.target.disabled = false; };
    const go = body.querySelector('#rgo'), rc = body.querySelector('#rc');
    if (!rc || none || p.blocked || p.mode === 'needs_migration') { go.hidden = true; return; }
    rc.oninput = () => { go.disabled = rc.value.trim() !== 'RESET'; };
    go.onclick = () => guard(body, async () => {
      try { await backup(); } catch (er) { return alert('Nothing was erased because the backup failed: ' + er.message); }
      if (p.mode === 'rpc') { const r = await db.rpc('reset_posted_entries', {p_confirm: 'RESET', p_dry_run: false}); if (r.error) return alert(r.error.message); }
      else { try { await clientReset(); } catch (er) { return alert('Reset stopped part-way: ' + (er.message || er) + '. Run it again to finish; your backup file is safe.'); } }
      m.close(); toast('Posted entries erased. Reloading…'); setTimeout(() => location.reload(), 900);
    });
  };
}
const api = {mountSeries, mountReset, backup, plan};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ST = api;
})(typeof window !== 'undefined' ? window : globalThis);
