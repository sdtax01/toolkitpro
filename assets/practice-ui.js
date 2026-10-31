/* Toolkit Pro - practice suite screens: Clients (client master), Compliance tracker, Recurring fee invoices.
   Rules live in assets/practice-core.js (PC). Needs migration 023; without it each page explains what to run and nothing else changes. */
(function (root) {
'use strict';
const h = s => esc(s);
const SEL = (name, opts, cur, extra) => '<select name="' + name + '" ' + (extra || '') + '>' + opts.map(o => { const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + h(v) + '"' + (String(v) === String(cur == null ? '' : cur) ? ' selected' : '') + '>' + h(l) + '</option>'; }).join('') + '</select>';
const dl = (name, text, type) => { const a = document.createElement('a'), u = URL.createObjectURL(new Blob([text], {type: type || 'text/csv;charset=utf-8'})); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); };
const csvDl = (name, rows) => dl(name, '﻿' + rows.map(r => r.map(v => { v = v == null ? '' : String(v); if (/^[=+@\t\r]/.test(v)) v = "'" + v; return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n'));
function modal(html, wide) {
  const o = document.createElement('div'), prev = document.activeElement; o.className = 'modal';
  o.innerHTML = '<div class=card role=dialog aria-modal=true style="max-width:' + (wide || 640) + 'px;width:94vw">' + html + '</div>';
  document.body.appendChild(o);
  const close = () => { o.remove(); try { prev && prev.focus && prev.focus(); } catch (_) {} };
  o.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  o.addEventListener('mousedown', e => { if (e.target === o) close(); });
  const f = o.querySelector('input,select,textarea,button'); if (f) f.focus();
  return {o, close};
}
const needMig = what => '<div class=card><h3>' + h(what) + ' needs one database step</h3><p>Run <b>supabase/migrations/023_practice_suite.sql</b> in the Supabase SQL editor once, then reload this page. Nothing else in the app is affected.</p></div>';
const missing = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache|could not find the table/i.test(e.message || ''));
async function table(name, order) { const r = await db.from(name).select('*'); if (r.error) { if (missing(r.error)) return {missing: true, rows: []}; throw r.error; } const rows = r.data || []; if (order) rows.sort(order); return {rows}; }
const stCodeOf = p => (root.GF.stateCodeOf ? root.GF.stateCodeOf(p.gstin, p.state) : '') || '';
const cardGrid = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:12px">';
const stat = (l, v, cls, tab) => '<div class=card style="margin:0;' + (tab ? 'cursor:pointer' : '') + '"' + (tab ? ' data-tab="' + tab + '" tabindex=0 role=button' : '') + '><div class=k>' + h(l) + '</div><div class="v ' + (cls || '') + '">' + v + '</div></div>';

/* ================================================================== CLIENTS ================================================================== */
const CF = {q: '', status: 'active', svc: ''};
async function mountClients(m) {
  const L = await load(), cm = await table('client_master');
  if (cm.missing) { m.innerHTML = needMig('The client master'); return; }
  const ct = await table('compliance_tasks'), today_ = today();
  const masters = new Map(cm.rows.map(x => [x.party_id, x])), clients = L.p.filter(p => p.kind === 'client').sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const merged = p => { const x = masters.get(p.id) || {}; return {...x, party_id: p.id, party: p, name: p.name, gstin: p.gstin || '', state_code: stCodeOf(p), pan: x.pan || p.pan || '', services: x.services || [], status: x.status || 'active', hasMaster: !!x.id}; };
  const rows = clients.map(merged);
  const open = new Map(); (ct.rows || []).forEach(t => { if (PC.isOpen(t) && t.party_id) { const o = open.get(t.party_id) || {n: 0, od: 0}; o.n++; if (t.due_date < today_) o.od++; open.set(t.party_id, o); } });
  const view = () => {
    const q = CF.q.toLowerCase(), list = rows.filter(c => (!CF.status || c.status === CF.status) && (!CF.svc || c.services.includes(CF.svc)) && (!q || [c.name, c.pan, c.gstin, c.tan, c.contact_person, c.assignee].join(' ').toLowerCase().includes(q)));
    const body = list.map(c => { const o = open.get(c.party_id) || {n: 0, od: 0}, gaps = PC.clientGaps(c), iss = PC.clientIssues(c);
      return '<tr><td><b>' + h(c.name) + '</b><div class=k>' + h((PC.CONSTITUTIONS.find(x => x[0] === c.constitution) || [, ''])[1]) + (c.contact_person ? ' · ' + h(c.contact_person) : '') + '</div>' +
        '<td>' + h(PC.effectivePan(c) || '') + (c.tan ? '<div class=k>TAN ' + h(c.tan) + '</div>' : '') + '<td>' + h(c.gstin) + (iss.some(x => x.field === 'gstin') ? '<div class=k style="color:#b42318">check GSTIN</div>' : '') +
        '<td>' + (c.services.length ? c.services.map(s => '<span class=bd style="background:#eef2ff;color:#3730a3;margin:1px">' + h((PC.SVC[s] || {short: s}).short) + '</span>').join(' ') : '<span class=k>none</span>') + (c.services.some(s => /^gstr/.test(s)) ? '<div class=k>' + (c.gst_frequency === 'qrmp' ? 'Quarterly (QRMP)' : 'Monthly') + '</div>' : '') +
        '<td class=r>' + (c.fee_amount > 0 ? inr2(c.fee_amount) + '<div class=k>' + h({monthly: 'per month', quarterly: 'per quarter', yearly: 'per year', one_time: 'one time'}[c.fee_cycle] || '') + '</div>' : '<span class=k>-</span>') +
        '<td>' + h(c.assignee || '') + '<td>' + (c.status === 'active' ? '<span class="bd ok">Active</span>' : c.status === 'on_hold' ? '<span class="bd du">On hold</span>' : '<span class="bd">Closed</span>') +
        '<td>' + (o.od ? '<span class="bd od">' + o.od + ' overdue</span> ' : '') + (o.n - o.od ? '<span class=k>' + (o.n - o.od) + ' open</span>' : (o.od ? '' : '<span class=k>-</span>')) +
        (gaps.length ? '<div class=k>missing: ' + h(gaps.join(', ')) + '</div>' : '') + '<td><button type=button class=g data-edit="' + h(c.party_id) + '">' + (c.hasMaster ? 'Edit profile' : 'Set up') + '</button></tr>'; }).join('');
    m.querySelector('#clist').innerHTML = list.length ? '<div class=tablewrap><table><tr><th>Client<th>PAN / TAN<th>GSTIN<th>Services<th class=r>Fee<th>Assigned to<th>Status<th>Compliance<th></tr>' + body + '</table></div><p class=k>' + list.length + ' of ' + rows.length + ' clients</p>' : '<p class=k>No clients match. ' + (rows.length ? 'Clear the filters.' : 'Add your first client with the button above.') + '</p>';
    m.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editClient(rows.find(x => x.party_id === b.dataset.edit)));
  };
  m.innerHTML = '<div class=card><h3>Clients</h3><p class=k>One record per client: PAN, TAN, constitution, the services you handle, how they file GST, your fee and who looks after them. The services you tick here decide which due dates the <a href="compliance.html">Compliance tracker</a> creates.</p>' +
    '<div class=f2 style="align-items:end;flex-wrap:wrap"><label style="flex:1;min-width:200px">Search<input id=cq placeholder="Name, PAN, GSTIN, TAN, contact" value="' + h(CF.q) + '"></label>' +
    '<label>Status' + SEL('cs', [['', 'All'], ['active', 'Active'], ['on_hold', 'On hold'], ['closed', 'Closed']], CF.status, 'id=cs') + '</label>' +
    '<label>Service' + SEL('cv', [['', 'Any']].concat(PC.SERVICES.map(s => [s.code, s.short])), CF.svc, 'id=cv') + '</label>' +
    '<button type=button id=cnew>+ Add client</button><button type=button class=g id=cexp>Export list</button></div></div><div class=card id=clist></div>';
  m.querySelector('#cq').oninput = e => { CF.q = e.target.value; view(); };
  m.querySelector('#cs').onchange = e => { CF.status = e.target.value; view(); };
  m.querySelector('#cv').onchange = e => { CF.svc = e.target.value; view(); };
  m.querySelector('#cnew').onclick = () => addClient();
  m.querySelector('#cexp').onclick = () => csvDl('clients-' + today_ + '.csv', [['Client', 'PAN', 'TAN', 'GSTIN', 'Constitution', 'Services', 'GST filing', 'Fee', 'Fee cycle', 'Assigned to', 'Status', 'Contact', 'Phone', 'Email']].concat(rows.map(c => [c.name, PC.effectivePan(c), c.tan || '', c.gstin, c.constitution || '', c.services.join(' '), c.gst_frequency || '', c.fee_amount || '', c.fee_cycle || '', c.assignee || '', c.status, c.contact_person || '', c.contact_phone || c.party.phone || '', c.contact_email || c.party.email || ''])));
  view();
}
function addClient() {
  const m = modal('<h3>Add client</h3><form id=f class=g2><label class=full>Client name<input name=name required maxlength=120></label><label>GSTIN (if registered)<input name=gstin maxlength=15 style="text-transform:uppercase"></label>' +
    '<label>State / UT<select name=state>' + GF.stateOpts('').map(o => '<option value="' + h(o[0]) + '">' + h(o[1]) + '</option>').join('') + '</select></label><label>Registration type<select name=gst_type>' + GF.GST_TYPES.map(o => '<option value="' + o[0] + '">' + h(o[1]) + '</option>').join('') + '</select></label>' +
    '<label>Email<input name=email type=email></label><label>Phone<input name=phone></label><p class="full k" id=err role=alert style="color:#b42318;margin:0"></p><div class="full f2"><button>Add and set up</button><button type=button class=g id=cx>Cancel</button></div></form>');
  const f = m.o.querySelector('#f'), err = m.o.querySelector('#err'); m.o.querySelector('#cx').onclick = m.close;
  f.onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); v.name = v.name.trim(); v.gstin = v.gstin.trim().toUpperCase();
    const pr = PC.gstinProblem(v.gstin); if (pr) { err.textContent = pr; return; }
    if (!v.name) { err.textContent = 'Enter the client name.'; return; }
    const dup = (await load()).p.find(p => p.kind === 'client' && String(p.name).trim().toLowerCase() === v.name.toLowerCase()); if (dup) { err.textContent = 'A customer with this name already exists. Use "Set up" on it in the list.'; return; }
    const st = v.state || (v.gstin && GF.stateName ? GF.stateName(v.gstin.slice(0, 2)) : '');
    const row = {name: v.name, kind: 'client', gstin: v.gstin || null, state: st || null, email: v.email || null, phone: v.phone || null, gst_type: v.gstin ? v.gst_type : (v.gst_type === 'regular' ? 'unregistered' : v.gst_type)};
    const r = await GF.saveCompat(rw => db.from('parties').insert(rw).select().single(), row, GF.PARTY_NEW);
    if (r.error) { err.textContent = r.error.message; return; } m.close(); LP = null; toast('Client added');
    const p = r.data; await editClient({party_id: p.id, party: p, name: p.name, gstin: p.gstin || '', state_code: stCodeOf(p), pan: '', services: [], status: 'active', hasMaster: false}, true);
  };
}
async function editClient(c, fresh) {
  const x = c, extra = (x.extra_gstins || []).map(e => [e.gstin, e.state || '', e.label || ''].join(', ')).join('\n');
  const m = modal('<h3>' + h(x.name) + '</h3><p class=k>' + (x.gstin ? 'GSTIN ' + h(x.gstin) + '. ' : 'No GSTIN on the customer record. ') + 'To change the name, GSTIN or address, edit the customer in <a href="party.html?id=' + h(x.party_id) + '&kind=client">Customers</a>.</p>' +
    '<form id=f class=g2><label>PAN<input name=pan maxlength=10 value="' + h(PC.effectivePan(x)) + '" style="text-transform:uppercase"></label><label>TAN<input name=tan maxlength=10 value="' + h(x.tan || '') + '" style="text-transform:uppercase"></label>' +
    '<label>Constitution' + SEL('constitution', [['', 'Select']].concat(PC.CONSTITUTIONS), x.constitution) + '</label><label>Date of birth / incorporation<input name=dob_incorp type=date value="' + h(x.dob_incorp || '') + '"></label>' +
    '<label>CIN / LLPIN<input name=cin_llpin maxlength=21 value="' + h(x.cin_llpin || '') + '"></label><label>Assigned to<input name=assignee maxlength=60 value="' + h(x.assignee || '') + '"></label>' +
    '<label>Contact person<input name=contact_person maxlength=80 value="' + h(x.contact_person || '') + '"></label><label>Contact phone<input name=contact_phone maxlength=20 value="' + h(x.contact_phone || x.party.phone || '') + '"></label>' +
    '<label class=full>Contact email<input name=contact_email type=email value="' + h(x.contact_email || x.party.email || '') + '"></label>' +
    '<fieldset class=full style="border:1px solid #d9e0f0;border-radius:8px;padding:8px 12px"><legend class=k>Services you handle for this client</legend><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:4px">' + PC.SERVICES.map(s => '<label style="display:flex;gap:6px;align-items:center;color:inherit;font-size:13px"><input type=checkbox name=svc value="' + s.code + '"' + (x.services.includes(s.code) ? ' checked' : '') + '>' + h(s.label) + '</label>').join('') + '</div></fieldset>' +
    '<label>GST return filing' + SEL('gst_frequency', [['monthly', 'Monthly'], ['qrmp', 'Quarterly (QRMP scheme)']], x.gst_frequency || 'monthly') + '</label><label>Status' + SEL('status', [['active', 'Active'], ['on_hold', 'On hold'], ['closed', 'Closed']], x.status) + '</label>' +
    '<label>Professional fee (₹, before GST)<input name=fee_amount type=number min=0 step=0.01 value="' + h(x.fee_amount == null ? '' : x.fee_amount) + '"></label><label>Fee is billed' + SEL('fee_cycle', [['', 'Select'], ['monthly', 'Every month'], ['quarterly', 'Every quarter'], ['yearly', 'Every year'], ['one_time', 'One time']], x.fee_cycle) + '</label>' +
    '<label class=full>Other GSTINs of this client (one per line: GSTIN, state, label)<textarea name=extra rows=2>' + h(extra) + '</textarea></label><label class=full>Notes<textarea name=notes rows=2>' + h(x.notes || '') + '</textarea></label>' +
    '<p class="full k" id=err role=alert style="color:#b42318;margin:0"></p><div class="full f2"><button>Save</button><button type=button class=g id=cx>Cancel</button>' + (x.hasMaster ? '<button type=button class=g id=mk title="Create the standing monthly invoice for this fee">Set up recurring invoice</button>' : '') + '</div></form>', 720);
  const f = m.o.querySelector('#f'), err = m.o.querySelector('#err'); m.o.querySelector('#cx').onclick = m.close;
  const mk = m.o.querySelector('#mk'); if (mk) mk.onclick = () => { location.href = 'recurring.html?client=' + encodeURIComponent(x.party_id); };
  f.pan.addEventListener('blur', () => { const k = PC.kindFromPan(f.pan.value); if (k && !f.constitution.value) f.constitution.value = k; });
  f.onsubmit = async e => { e.preventDefault(); err.textContent = '';
    const fd = new FormData(f), v = Object.fromEntries(fd), services = fd.getAll('svc');
    const rec = {...v, services, gstin: x.gstin, fee_amount: v.fee_amount === '' ? null : +v.fee_amount};
    const iss = PC.clientIssues(rec); if (iss.length) { err.textContent = iss[0].message + (iss.length > 1 ? ' (+' + (iss.length - 1) + ' more)' : ''); return; }
    const extraG = []; for (const line of String(v.extra || '').split('\n').map(s => s.trim()).filter(Boolean)) { const [g, st, lb] = line.split(',').map(s => s.trim()); const pr = PC.gstinProblem(g); if (pr) { err.textContent = 'Other GSTIN "' + g + '": ' + pr; return; } extraG.push({gstin: g.toUpperCase(), state: st || '', label: lb || ''}); }
    const row = {party_id: x.party_id, pan: (v.pan || '').trim().toUpperCase() || null, tan: (v.tan || '').trim().toUpperCase() || null, cin_llpin: (v.cin_llpin || '').trim() || null, constitution: v.constitution || null, dob_incorp: v.dob_incorp || null,
      contact_person: v.contact_person.trim() || null, contact_phone: v.contact_phone.trim() || null, contact_email: v.contact_email.trim() || null, services, gst_frequency: v.gst_frequency, fee_amount: rec.fee_amount, fee_cycle: v.fee_cycle || null,
      assignee: v.assignee.trim() || null, status: v.status, extra_gstins: extraG, notes: v.notes.trim() || null};
    const q = x.hasMaster ? db.from('client_master').update(row).eq('party_id', x.party_id) : db.from('client_master').insert(row);
    const r = await q; if (r.error) { err.textContent = /duplicate|unique/i.test(r.error.message) ? 'This client already has a profile. Reload the page.' : r.error.message; return; }
    if (row.pan && row.pan !== x.party.pan) { try { await db.from('parties').update({pan: row.pan}).eq('id', x.party_id); } catch (_) {} }
    m.close(); LP = null; toast('Client saved'); if (window.refresh) window.refresh();
  };
}

/* ================================================================== COMPLIANCE ================================================================== */
const TF = {tab: 'open', client: '', svc: '', who: '', month: '', q: ''};
async function mountCompliance(m) {
  const L = await load(), ct = await table('compliance_tasks');
  if (ct.missing) { m.innerHTML = needMig('The compliance tracker'); return; }
  const cm = await table('client_master'), T = ct.rows, today_ = today(), pname = new Map(L.p.map(p => [p.id, p.name]));
  const masters = cm.rows || [], tasks = T.map(t => ({...t, client: t.party_id ? (pname.get(t.party_id) || '(deleted client)') : 'Firm'}));
  const sm = PC.summarize(tasks, today_), whos = [...new Set(tasks.map(t => t.assignee).filter(Boolean))].sort();
  const filt = () => { const q = TF.q.toLowerCase(); return tasks.filter(t => {
    const u = PC.urgency(t, today_);
    if (TF.tab === 'open' && !PC.isOpen(t)) return false; if (TF.tab === 'overdue' && u !== 'overdue') return false; if (TF.tab === 'soon' && u !== 'due_soon') return false; if (TF.tab === 'filed' && t.status !== 'filed') return false;
    if (TF.client && t.party_id !== TF.client) return false; if (TF.svc && t.service !== TF.svc) return false; if (TF.who && (t.assignee || '') !== TF.who) return false; if (TF.month && String(t.due_date).slice(0, 7) !== TF.month) return false;
    return !q || (t.title + ' ' + t.client + ' ' + (t.ack_no || '')).toLowerCase().includes(q); }).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.client.localeCompare(b.client)); };
  const paint = () => {
    const list = filt();
    const badge = t => { const u = PC.urgency(t, today_); return u === 'overdue' ? '<span class="bd od">Overdue ' + PC.daysBetween(t.due_date, today_) + 'd</span>' : u === 'due_soon' ? '<span class="bd du">' + (t.due_date === today_ ? 'Due today' : 'Due in ' + PC.daysBetween(today_, t.due_date) + 'd') + '</span>' : ''; };
    m.querySelector('#tlist').innerHTML = list.length ? '<div class=tablewrap><table><tr><th>Due<th>Task<th>Client<th>Assigned<th>Status<th>Filing details<th></tr>' + list.map(t => '<tr><td style="white-space:nowrap">' + h(t.due_date) + '<div>' + badge(t) + '</div><td>' + h(t.title) + '<td>' + h(t.client) + '<td>' + h(t.assignee || '') +
      '<td><select data-st="' + h(t.id) + '" aria-label="Status of ' + h(t.title) + '">' + PC.STATUSES.map(s => '<option value="' + s[0] + '"' + (t.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>').join('') + '</select>' +
      '<td>' + (t.status === 'filed' ? h(t.filed_on || '') + (t.ack_no ? '<div class=k>ARN/Ack ' + h(t.ack_no) + '</div>' : '') + (t.filed_on && t.filed_on > t.due_date ? '<div class=k style="color:#b42318">filed late</div>' : '') : '<span class=k>' + h(t.remarks || '') + '</span>') +
      '<td><button type=button class=g data-te="' + h(t.id) + '">Edit</button></tr>').join('') + '</table></div><p class=k>' + list.length + ' task(s)</p>' : '<p class=k>Nothing here. ' + (T.length ? 'Change the filters above.' : 'Press "Create tasks" to build the due dates for your clients.') + '</p>';
    m.querySelectorAll('.tabs [data-tab], [data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === TF.tab); });
    m.querySelectorAll('[data-te]').forEach(b => b.onclick = () => editTask(tasks.find(t => t.id === b.dataset.te)));
    m.querySelectorAll('[data-st]').forEach(s => s.onchange = async () => { const t = tasks.find(x => x.id === s.dataset.st); if (s.value === 'filed') { s.value = t.status; return editTask(t, 'filed'); }
      const r = await db.from('compliance_tasks').update({status: s.value, ...(t.status === 'filed' ? {filed_on: null, ack_no: null} : {})}).eq('id', t.id); if (r.error) { alert(r.error.message); s.value = t.status; return; } toast('Status updated'); if (window.refresh) window.refresh(); });
  };
  m.innerHTML = '<div class=card><h3>Compliance tracker</h3><p class=k>Every filing and deadline for every client in one list. Due dates are the usual statutory dates. Governments extend dates by notification during the year, so confirm the current date and change it on the task if it differs.</p></div>' +
    cardGrid + stat('Overdue', sm.overdue, sm.overdue ? 'dn' : '', 'overdue') + stat('Due in 7 days', sm.due_soon, '', 'soon') + stat('Open, due this month', sm.thisMonth, '', 'open') + stat('Filed', sm.filed, 'up', 'filed') + stat('Filed late', sm.filedLate, sm.filedLate ? 'dn' : '') + '</div>' +
    '<div class=card><div class=f2 style="align-items:end;flex-wrap:wrap"><label>Show' + SEL('tab', [['open', 'All open'], ['overdue', 'Overdue'], ['soon', 'Due in 7 days'], ['filed', 'Filed'], ['all', 'Everything']], TF.tab, 'id=ftab') + '</label>' +
    '<label>Client' + SEL('client', [['', 'All clients']].concat([...new Set(tasks.map(t => t.party_id).filter(Boolean))].map(id => [id, pname.get(id) || '(deleted)']).sort((a, b) => a[1].localeCompare(b[1]))), TF.client, 'id=fcl') + '</label>' +
    '<label>Filing' + SEL('svc', [['', 'All']].concat(PC.SERVICES.map(s => [s.code, s.short])), TF.svc, 'id=fsv') + '</label><label>Assigned to' + SEL('who', [['', 'Anyone']].concat(whos), TF.who, 'id=fwh') + '</label>' +
    '<label>Due month<input type=month id=fmo value="' + h(TF.month) + '"></label><label style="flex:1 1 160px">Search<input id=fq value="' + h(TF.q) + '"></label></div>' +
    '<div class=f2 style="margin-top:10px"><button type=button id=gen>Create tasks…</button><button type=button class=g id=add>+ Add task</button><button type=button class=g id=exp>Export</button></div></div><div class=card id=tlist></div>';
  const bind = (id, k, ev) => { m.querySelector(id)[ev || 'onchange'] = e => { TF[k] = e.target.value; paint(); }; };
  bind('#ftab', 'tab'); bind('#fcl', 'client'); bind('#fsv', 'svc'); bind('#fwh', 'who'); bind('#fmo', 'month'); bind('#fq', 'q', 'oninput');
  m.querySelectorAll('.card[data-tab]').forEach(c => { const go = () => { TF.tab = c.dataset.tab; m.querySelector('#ftab').value = TF.tab; paint(); }; c.onclick = go; c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }; });
  m.querySelector('#gen').onclick = () => genTasks(masters, L, T);
  m.querySelector('#add').onclick = () => editTask(null);
  m.querySelector('#exp').onclick = () => csvDl('compliance-' + today_ + '.csv', [['Due date', 'Task', 'Client', 'Assigned to', 'Status', 'Filed on', 'Ack / ARN', 'Remarks']].concat(filt().map(t => [t.due_date, t.title, t.client, t.assignee || '', PC.STATUS_LABEL[t.status], t.filed_on || '', t.ack_no || '', t.remarks || ''])));
  paint();
}
function genTasks(masters, L, existing) {
  const d = new Date(), t0 = today(), from = t0.slice(0, 8) + '01', to = PC.addDays(PC.addMonths(from, 3, 1), -1);
  const m = modal('<h3>Create tasks from client services</h3><p class=k>Creates the filings that fall due in the period below for every <b>active</b> client, based on the services ticked in the client master. Tasks that already exist are skipped, so you can run this again safely.</p>' +
    '<form id=f class=g2><label>Due from<input type=date name=from required value="' + from + '"></label><label>Due to<input type=date name=to required value="' + to + '"></label></form><div id=pv class=k style="margin:10px 0"></div><p class=k id=err role=alert style="color:#b42318"></p><div class=f2><button type=button id=go>Create tasks</button><button type=button class=g id=cx>Cancel</button></div>');
  const f = m.o.querySelector('#f'), pv = m.o.querySelector('#pv'), go = m.o.querySelector('#go'), err = m.o.querySelector('#err'); let plan = [];
  const clients = masters.map(x => { const p = L.p.find(y => y.id === x.party_id); return p ? {...x, state_code: stCodeOf(p)} : null; }).filter(Boolean);
  const calc = () => { err.textContent = ''; if (!f.from.value || !f.to.value || f.to.value < f.from.value) { pv.textContent = 'Choose a valid period.'; go.disabled = true; return; }
    if (PC.daysBetween(f.from.value, f.to.value) > 400) { pv.textContent = 'Choose a period of at most about 13 months.'; go.disabled = true; return; }
    plan = PC.generate(clients, f.from.value, f.to.value, existing); const by = {}; plan.forEach(t => by[t.service] = (by[t.service] || 0) + 1);
    pv.innerHTML = plan.length ? '<b>' + plan.length + ' task(s)</b> for ' + new Set(plan.map(x => x.party_id)).size + ' client(s): ' + Object.entries(by).map(([s, n]) => h((PC.SVC[s] || {short: s}).short) + ' ' + n).join(', ') : (clients.some(c => (c.services || []).length) ? 'Nothing new falls due in this period (they may already exist).' : 'No client has services ticked yet. Open <a href="clients.html">Clients</a> and tick the services you handle.'); go.disabled = !plan.length; };
  f.oninput = calc; calc(); m.o.querySelector('#cx').onclick = m.close;
  go.onclick = async () => { go.disabled = true; go.textContent = 'Creating…'; let made = 0;
    for (let i = 0; i < plan.length; i += 200) { const chunk = plan.slice(i, i + 200), r = await db.from('compliance_tasks').insert(chunk);
      if (!r.error) { made += chunk.length; continue; }
      for (const row of chunk) { const r2 = await db.from('compliance_tasks').insert(row); if (!r2.error) made++; else if (!/duplicate|unique/i.test(r2.error.message)) { err.textContent = r2.error.message; go.disabled = false; go.textContent = 'Create tasks'; return; } } }
    m.close(); toast(made + ' task(s) created'); if (window.refresh) window.refresh(); };
}
function editTask(t, forceStatus) {
  const L = LP || null, isNew = !t; t = t || {title: '', due_date: today(), status: 'pending', service: 'manual', party_id: '', assignee: '', ack_no: '', remarks: ''};
  const st = forceStatus || t.status;
  const clientsP = (root.__clients || []);
  const m = modal('<h3>' + (isNew ? 'Add task' : 'Task') + '</h3><form id=f class=g2>' + (isNew ? '<label class=full>Client<select name=party_id><option value="">Firm (no client)</option></select></label>' : '') +
    '<label class=full>Task<input name=title required maxlength=160 value="' + h(t.title) + '"></label><label>Due date<input type=date name=due_date required value="' + h(t.due_date) + '"></label><label>Status' + SEL('status', PC.STATUSES, st) + '</label>' +
    '<label>Assigned to<input name=assignee maxlength=60 value="' + h(t.assignee || '') + '"></label><label>Filed on<input type=date name=filed_on value="' + h(t.filed_on || (forceStatus === 'filed' ? today() : '')) + '"></label>' +
    '<label class=full>Acknowledgement / ARN number<input name=ack_no maxlength=60 value="' + h(t.ack_no || '') + '"></label><label class=full>Remarks<textarea name=remarks rows=2>' + h(t.remarks || '') + '</textarea></label>' +
    '<p class="full k" id=err role=alert style="color:#b42318;margin:0"></p><div class="full f2"><button>Save</button><button type=button class=g id=cx>Cancel</button>' + (isNew ? '' : '<button type=button class=x id=del>Delete</button>') + '</div></form>');
  const f = m.o.querySelector('#f'), err = m.o.querySelector('#err'); m.o.querySelector('#cx').onclick = m.close;
  if (isNew) load().then(l => { const s = f.party_id; l.p.filter(p => p.kind === 'client').sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; s.appendChild(o); }); });
  const del = m.o.querySelector('#del'); if (del) del.onclick = async () => { if (!confirm('Delete this task?')) return; const r = await db.from('compliance_tasks').delete().eq('id', t.id); if (r.error) { err.textContent = r.error.message; return; } m.close(); toast('Task deleted'); if (window.refresh) window.refresh(); };
  f.onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f));
    if (v.status === 'filed' && !v.filed_on) { err.textContent = 'Enter the date it was filed.'; return; }
    const row = {title: v.title.trim(), due_date: v.due_date, status: v.status, assignee: v.assignee.trim() || null, filed_on: v.status === 'filed' ? v.filed_on : null, ack_no: v.status === 'filed' ? (v.ack_no.trim() || null) : (v.ack_no.trim() || null), remarks: v.remarks.trim() || null};
    let r; if (isNew) { row.party_id = v.party_id || null; row.service = 'manual'; row.period = 'x-' + Date.now().toString(36); r = await db.from('compliance_tasks').insert(row); } else r = await db.from('compliance_tasks').update(row).eq('id', t.id);
    if (r.error) { err.textContent = r.error.message; return; } m.close(); toast('Saved'); if (window.refresh) window.refresh(); };
}

/* ================================================================== RECURRING ================================================================== */
let RBUSY = false;
async function mountRecurring(m) {
  if (RBUSY) return;
  const L = await load(), rt = await table('recurring_invoices');
  if (rt.missing) { m.innerHTML = needMig('Recurring invoices'); return; }
  const cmq = await table('client_master'), masters = new Map((cmq.rows || []).map(x => [x.party_id, x])), pname = new Map(L.p.map(p => [p.id, p])), today_ = today(), R = rt.rows.sort((a, b) => String(a.next_date).localeCompare(String(b.next_date)));
  const dueNow = R.filter(r => PC.dueRuns(r, today_).length), invCount = dueNow.reduce((s, r) => s + PC.dueRuns(r, today_).length, 0);
  const total = r => { const p = pname.get(r.party_id), g = gst(+r.amount, +r.gst_rate, L.S, p); return rup(paise(r.amount) + paise(g.cgst) + paise(g.sgst) + paise(g.igst)); };
  const state = r => !r.active ? '<span class=bd>Paused</span>' : (r.end_date && PC.nextRunDate(r.last_date || r.next_date, r.frequency) > r.end_date && r.next_date > r.end_date) ? '<span class=bd>Ended</span>' : PC.dueRuns(r, today_).length ? '<span class="bd du">Due now</span>' : '<span class="bd ok">Active</span>';
  m.innerHTML = '<div class=card><h3>Recurring fee invoices</h3><p class=k>A standing fee for a client, for example a monthly retainer. Nothing is created automatically in the background: when invoices are due this page shows them and you press <b>Create due invoices</b>, check the list, and confirm. Each invoice gets the next number from your sales series and is posted exactly like an invoice you type in.</p>' +
    '<div class=f2><button type=button id=run' + (invCount ? '' : ' disabled') + '>Create due invoices' + (invCount ? ' (' + invCount + ')' : '') + '…</button><button type=button class=g id=new>+ New recurring invoice</button></div></div>' +
    '<div class=card>' + (R.length ? '<div class=tablewrap><table><tr><th>Client<th>Service<th class=r>Fee<th class=r>Invoice total<th>Repeats<th>Next invoice<th>Last<th>Status<th></tr>' + R.map(r => '<tr><td>' + h((pname.get(r.party_id) || {}).name || '(deleted)') + '<td>' + h(PC.renderText(r.description, r.next_date, r.frequency)) + '<td class=r>' + inr2(r.amount) + '<div class=k>GST ' + (+r.gst_rate) + '%</div><td class=r>' + inr2(total(r)) + '<td>' + h(PC.FREQ_LABEL[r.frequency]) + '<td>' + h(r.next_date) + (r.end_date ? '<div class=k>until ' + h(r.end_date) + '</div>' : '') + '<td>' + (r.last_number ? h(r.last_number) + '<div class=k>' + h(r.last_date || '') + ' · ' + (r.run_count || 0) + ' raised</div>' : '<span class=k>none yet</span>') + '<td>' + state(r) +
      '<td style="white-space:nowrap"><button type=button class=g data-e="' + h(r.id) + '">Edit</button> <button type=button class=g data-p="' + h(r.id) + '">' + (r.active ? 'Pause' : 'Resume') + '</button> <button type=button class=x data-d="' + h(r.id) + '">Delete</button></tr>').join('') + '</table></div>' : '<p class=k>No recurring invoices yet. Add one with the button above. Tip: in <a href="clients.html">Clients</a> you can record each client\'s fee and then create the standing invoice from there.</p>') + '</div>';
  m.querySelector('#new').onclick = () => editRec(null, L, masters);
  m.querySelector('#run').onclick = () => runDue(R, L);
  m.querySelectorAll('[data-e]').forEach(b => b.onclick = () => editRec(R.find(r => r.id === b.dataset.e), L, masters));
  m.querySelectorAll('[data-p]').forEach(b => b.onclick = async () => { const r = R.find(x => x.id === b.dataset.p), q = await db.from('recurring_invoices').update({active: !r.active}).eq('id', r.id); if (q.error) return alert(q.error.message); toast(r.active ? 'Paused' : 'Resumed'); if (window.refresh) window.refresh(); });
  m.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { if (!confirm('Delete this recurring invoice? Invoices already created stay as they are.')) return; const q = await db.from('recurring_invoices').delete().eq('id', b.dataset.d); if (q.error) return alert(q.error.message); toast('Deleted'); if (window.refresh) window.refresh(); });
  const pre = new URLSearchParams(location.search).get('client'); if (pre && !mountRecurring.done) { mountRecurring.done = true; editRec(null, L, masters, pre); }
}
function editRec(r, L, masters, preClient) {
  const isNew = !r, x = r || {party_id: preClient || '', description: 'Professional fee for {MONTH}', hsn_sac: '998231', amount: '', gst_rate: L.S.default_gst != null ? L.S.default_gst : 18, frequency: 'monthly', next_date: today(), end_date: '', due_days: 15, active: true};
  const clients = L.p.filter(p => p.kind === 'client').sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const m = modal('<h3>' + (isNew ? 'New recurring invoice' : 'Edit recurring invoice') + '</h3><form id=f class=g2><label class=full>Client<select name=party_id required><option value="">Select client</option>' + clients.map(p => '<option value="' + h(p.id) + '"' + (p.id === x.party_id ? ' selected' : '') + '>' + h(p.name) + '</option>').join('') + '</select></label>' +
    '<label class=full>Description on the invoice<input name=description required maxlength=300 value="' + h(x.description) + '"><span class=k>{MONTH} becomes the month (September 2026), {PERIOD} the period covered, {FY} the financial year.</span></label>' +
    '<label>HSN / SAC<input name=hsn_sac maxlength=8 value="' + h(x.hsn_sac || '') + '"></label><label>Fee before GST (₹)<input name=amount type=number min=0.01 step=0.01 required value="' + h(x.amount) + '"></label>' +
    '<label>GST rate %' + SEL('gst_rate', RATES.map(v => [v, v + '%']), +x.gst_rate) + '</label><label>Repeats' + SEL('frequency', Object.entries(PC.FREQ_LABEL), x.frequency) + '</label>' +
    '<label>First / next invoice date<input type=date name=next_date required value="' + h(x.next_date) + '"></label><label>Stop after (optional)<input type=date name=end_date value="' + h(x.end_date || '') + '"></label>' +
    '<label>Payment due after (days)<input type=number name=due_days min=0 max=365 value="' + h(x.due_days) + '"></label><label>&nbsp;<span id=tot class=k style="font-size:14px"></span></label>' +
    '<p class="full k" id=err role=alert style="color:#b42318;margin:0"></p><div class="full f2"><button>Save</button><button type=button class=g id=cx>Cancel</button></div></form>');
  const f = m.o.querySelector('#f'), err = m.o.querySelector('#err'), tot = m.o.querySelector('#tot'); m.o.querySelector('#cx').onclick = m.close;
  const upd = () => { const a = +f.amount.value; if (!(a > 0)) { tot.textContent = ''; return; } const p = L.p.find(y => y.id === f.party_id.value), g = gst(a, +f.gst_rate.value, L.S, p); tot.textContent = 'Invoice total ' + inr2(rup(paise(a) + paise(g.cgst) + paise(g.sgst) + paise(g.igst))) + (p ? '' : ' (choose the client for exact tax)'); };
  f.oninput = upd; f.party_id.onchange = () => { const mm = masters.get(f.party_id.value); if (mm && isNew && mm.fee_amount > 0 && !f.amount.value) { f.amount.value = mm.fee_amount; const fq = {monthly: 'monthly', quarterly: 'quarterly', yearly: 'yearly'}[mm.fee_cycle]; if (fq) f.frequency.value = fq; } upd(); }; upd();
  if (isNew && x.party_id) f.party_id.onchange();
  f.onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f));
    const row = {party_id: v.party_id, description: v.description.trim(), hsn_sac: v.hsn_sac.trim() || null, amount: +v.amount, gst_rate: +v.gst_rate, frequency: v.frequency, next_date: v.next_date, end_date: v.end_date || null, due_days: +v.due_days || 0};
    const iss = PC.recurringIssues(row); if (iss.length) { err.textContent = iss[0]; return; }
    if (isNew || v.next_date !== r.next_date) row.anchor_day = PC.parse(v.next_date).d;
    const q = isNew ? await db.from('recurring_invoices').insert({...row, active: true}) : await db.from('recurring_invoices').update(row).eq('id', r.id);
    if (q.error) { err.textContent = q.error.message; return; } m.close(); toast('Saved'); if (window.refresh) window.refresh(); };
}
async function runDue(R, L) {
  const upto0 = today(), pname = new Map(L.p.map(p => [p.id, p]));
  const m = modal('<h3>Create due invoices</h3><div class=f2 style="align-items:end"><label>Create invoices dated up to<input type=date id=upto value="' + upto0 + '"></label></div><div id=pv style="margin:10px 0"><p class=k>Working out the numbers…</p></div><p class=k id=err role=alert style="color:#b42318"></p><div class=f2><button type=button id=go disabled>Create invoices</button><button type=button class=g id=cx>Cancel</button></div>', 820);
  const pv = m.o.querySelector('#pv'), go = m.o.querySelector('#go'), err = m.o.querySelector('#err'), up = m.o.querySelector('#upto'); m.o.querySelector('#cx').onclick = m.close;
  let plan = [], seq = 0;
  const build = async () => { const mine = ++seq; go.disabled = true; pv.innerHTML = '<p class=k>Working out the numbers…</p>'; plan = []; const reserved = []; const inv = (await load()).i;
    const jobs = []; R.forEach(r => PC.dueRuns(r, up.value).forEach((d, ix) => jobs.push({r, d, ix}))); jobs.sort((a, b) => a.d.localeCompare(b.d) || String(a.r.id).localeCompare(String(b.r.id)));
    for (const j of jobs) { const p = pname.get(j.r.party_id); if (!p) continue;
      const no = await nextDoc('sale', L.S, inv, j.d, reserved); reserved.push(no);
      const line = {description: PC.renderText(j.r.description, j.d, j.r.frequency), hsn_sac: j.r.hsn_sac || '', quantity: 1, unit: '', rate: +j.r.amount, discount: 0, gst_rate: +j.r.gst_rate};
      const calc = GF.calcLines([line], (t, rt) => gst(t, rt, L.S, p));
      plan.push({rec: j.r, party: p, number: no, date: j.d, due: PC.addDays(j.d, +j.r.due_days || 0), calc, line}); }
    if (mine !== seq) return;
    pv.innerHTML = plan.length ? '<div class=tablewrap><table><tr><th>Invoice no<th>Date<th>Client<th>Description<th class=r>Taxable<th class=r>GST<th class=r>Total</tr>' + plan.map(x => '<tr><td>' + h(x.number) + '<td>' + h(x.date) + '<td>' + h(x.party.name) + '<td>' + h(x.line.description) + '<td class=r>' + inr2(x.calc.taxable) + '<td class=r>' + inr2(x.calc.tax) + '<td class=r>' + inr2(x.calc.amount) + '</tr>').join('') + '</table></div><p><b>' + plan.length + ' invoice(s)</b>, total ' + inr2(plan.reduce((s, x) => s + x.calc.amount, 0)) + '. Nothing is created until you press the button.</p>' : '<p class=k>No invoices are due up to this date.</p>';
    go.disabled = !plan.length; };
  up.onchange = build; build();
  go.onclick = async () => { if (RBUSY) return; RBUSY = true; go.disabled = true; go.textContent = 'Creating…'; err.textContent = '';
    try {
      const docs = plan.map((x, i) => ({n: i, rows: [i], party_id: x.party.id, number: x.number, date: x.date, due_date: x.due, place_of_supply: null, reverse_charge: false, calc: x.calc}));
      const res = await IM.postSales(docs, {db, GF, noFn, rup, paise});
      const byRec = new Map(); let ok_ = 0; const fails = [];
      res.forEach((rr, i) => { const x = plan[i]; if (rr.status === 'posted') { ok_++; const o = byRec.get(x.rec.id) || {rec: x.rec, done: [], broke: false}; if (!o.broke) o.done.push(x); byRec.set(x.rec.id, o); } else { fails.push(x.number + ' for ' + x.party.name + ': ' + rr.message); const o = byRec.get(x.rec.id) || {rec: x.rec, done: [], broke: false}; o.broke = true; byRec.set(x.rec.id, o); } });
      for (const o of byRec.values()) { if (!o.done.length) continue; const last = o.done[o.done.length - 1], anchor = o.rec.anchor_day || PC.parse(o.rec.next_date).d;
        const u = await db.from('recurring_invoices').update({next_date: PC.nextRunDate(last.date, o.rec.frequency, anchor), last_date: last.date, last_number: last.number, run_count: (o.rec.run_count || 0) + o.done.length}).eq('id', o.rec.id);
        if (u.error) fails.push('Invoices were created but the schedule could not be advanced for ' + (pname.get(o.rec.party_id) || {}).name + ': ' + u.error.message + '. Edit its next date by hand so it is not created twice.'); }
      LP = null;
      if (fails.length) { pv.innerHTML = '<p><b>' + ok_ + ' invoice(s) created.</b></p><p style="color:#b42318"><b>' + fails.length + ' problem(s):</b></p><ul>' + fails.map(f => '<li>' + h(f) + '</li>').join('') + '</ul>'; go.remove(); m.o.querySelector('#cx').textContent = 'Close'; RBUSY = false; if (window.refresh) window.refresh(); }
      else { m.close(); toast(ok_ + ' invoice(s) created'); RBUSY = false; if (window.refresh) window.refresh(); }
    } catch (e) { err.textContent = e.message || String(e); go.disabled = false; go.textContent = 'Create invoices'; }
    finally { RBUSY = false; }
  };
}

root.PUI = {mountClients, mountCompliance, mountRecurring};
})(typeof window !== 'undefined' ? window : globalThis);
