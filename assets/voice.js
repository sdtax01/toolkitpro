/* Toolkit Pro - voice assistant (browser part). Needs assets/voice-core.js (the dialogue brain), app.js (db, load0, toast...) and a browser with speech recognition (Chrome / Edge).
   Listening = SpeechRecognition (en-IN). Speaking = speechSynthesis with a voice, pitch and speed you choose in Settings > Voice assistant.
   Nothing is posted until you say "yes" (or press Confirm). Posting uses the same record_payment database function as the Record payment form on a bill. */
(function () {
'use strict';
if (window.VoiceUI || typeof db === 'undefined') return;
const Core = window.VoiceCore, SR = window.SpeechRecognition || window.webkitSpeechRecognition, TTS = window.speechSynthesis;
const KEY = 'tp.voice.cfg', RESUME = 'tp.voice.resume';
const DEF = {voiceURI: '', pitch: 0.8, rate: 1, volume: 1, male: true, defaultAccount: '', wake: false, wakePhrase: 'hey buddy'};
const getCfg = () => { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) { return Object.assign({}, DEF); } };
const setCfg = o => { try { localStorage.setItem(KEY, JSON.stringify(Object.assign(getCfg(), o))); } catch (_) {} };
const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

/* ---------- voices ---------- */
const MALE = /\b(male|ravi|prabhat|rishi|hemant|david|mark|james|george|guy|daniel|alex|fred|ryan|aaron|arthur|oliver|thomas|eric|brian|liam|davis|jason|tony|andrew|roger|christopher|ethan|neil|rocko|reed|eddy|grandpa)\b/i;
const FEMALE = /\b(female|heera|neerja|zira|hazel|susan|samantha|karen|moira|tessa|veena|fiona|victoria|catherine|linda|jenny|aria|sara|emma|michelle|ana|libby|sonia|natasha|clara|ashley|joanna|kimberly|salli|kendra|amy|nicole|olivia|lekha|kalpana|shelley|sandy|flo|grandma|rocko)\b/i;
const gender = v => FEMALE.test(v.name) ? 'female' : MALE.test(v.name) ? 'male' : '';
const enVoices = () => (TTS ? TTS.getVoices() : []).filter(v => /^en/i.test(v.lang));
function pickVoice(c) {
  const all = enVoices(); if (!all.length) return null;
  if (c.voiceURI) { const v = all.find(x => x.voiceURI === c.voiceURI); if (v) return v; }
  const rank = v => (/en[-_]IN/i.test(v.lang) ? 4 : 0) + (c.male ? (gender(v) === 'male' ? 6 : gender(v) === 'female' ? -3 : 0) : 0) + (v.localService ? 1 : 0);
  return all.slice().sort((a, b) => rank(b) - rank(a))[0];
}
let speaking = null, needTap = false;
function speak(text) {
  return new Promise(res => {
    if (!TTS || !text) return res();
    try { TTS.cancel(); } catch (_) {}
    const c = getCfg(), u = new SpeechSynthesisUtterance(text), v = pickVoice(c);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-IN';
    u.pitch = Math.min(2, Math.max(0, +c.pitch || 1)); u.rate = Math.min(2, Math.max(.5, +c.rate || 1)); u.volume = Math.min(1, Math.max(0, +c.volume));
    let done = false; const fin = () => { if (!done) { done = true; clearTimeout(tm); speaking = null; setStatus(''); res(); } };
    const tm = setTimeout(fin, 4000 + text.length * 110);
    u.onend = fin; u.onerror = e => { if (e && e.error === 'not-allowed' && !needTap) { needTap = true; if (el.say) el.say.textContent += '  (Click anywhere on the page once to switch on the assistant voice.)'; } fin(); };
    speaking = u; setStatus('Speaking…'); try { TTS.speak(u); } catch (_) { fin(); }
  });
}

/* ---------- data ---------- */
let DATA = null, EXTRA = null;
async function fresh() { const d = await load0(); DATA = d; return d; }
async function ensureStatement() {
  if (typeof TP === 'undefined') await new Promise(r => { const s = document.createElement('script'); s.src = 'assets/reports-lib.js?v=20261102'; s.onload = s.onerror = r; document.head.appendChild(s); });
  if (!EXTRA) {
    const [nq, dq] = await Promise.all([db.from('gst_notes').select('*'), db.from('tds_entries').select('*')]);
    EXTRA = [...(nq.error ? [] : nq.data || []).map(n => ({invoice_id: n.invoice_id, date: n.date, amount: n.amount, label: n.kind === 'credit' ? 'Credit note' : 'Debit note', ref: n.number})),
             ...(dq.error ? [] : dq.data || []).map(d => ({invoice_id: d.invoice_id, date: d.date, amount: d.amount, label: 'TDS', ref: d.section || ''}))];
  }
}
function coreData() {
  const d = DATA;
  return {parties: d.p, invoices: d.i, accounts: d.a, today: today(), defaultAccount: getCfg().defaultAccount || null,
    stmtInfo: (p, from, to) => { try { const st = TP.statement(p, d.i, d.t, from || null, to || null, EXTRA || []); return {closing: st.closing}; } catch (_) { return {closing: 0}; } }};
}

/* ---------- posting ---------- */
async function postEntry(a) {
  try {
    const ls = await db.from('ledger_settings').select('locked_through,posting_enabled').limit(1), l = ls.error ? null : (ls.data || [])[0];
    if (l && l.posting_enabled && l.locked_through && a.date <= l.locked_through) return {err: 'The date ' + Core.niceDate(a.date) + ' is in a locked period, up to ' + Core.niceDate(l.locked_through) + '. Please use a later date or unlock the period in Ledger Setup.'};
    const rp = await db.rpc('record_payment', {p_invoice: a.invoice, p_amount: a.amount, p_date: a.date, p_account: a.account || null, p_description: a.description});
    if (!rp.error) return {ok: true};
    if (!noFn(rp.error)) return {err: rp.error.message};
    const inv = (DATA.i || []).find(x => x.id === a.invoice);                    /* older database without the function: same two-step save as the bill page */
    const ins = await db.from('transactions').insert({date: a.date, description: a.description, category: a.sale ? 'Sales' : 'Purchases', type: a.sale ? 'income' : 'expense', amount: a.amount, account_id: a.account || null, invoice_id: a.invoice}).select().single();
    if (ins.error) return {err: ins.error.message};
    const up = await db.from('invoices').update({paid: rup(paise(inv.paid) + paise(a.amount))}).eq('id', a.invoice);
    if (up.error) { await db.from('transactions').delete().eq('id', ins.data.id); return {err: up.error.message}; }
    return {ok: true};
  } catch (e) { return {err: e.message || String(e)}; }
}

/* ---------- WhatsApp statement ---------- */
function stmtText(a) {
  const d = DATA, p = d.p.find(x => x.id === a.party), cust = p.kind === 'client', st = TP.statement(p, d.i, d.t, a.from || null, a.to || null, EXTRA || []);
  const biz = (d.S && d.S.business_name) || 'Shree Digitax Solutions', f = Core.niceDate, m = n => '₹' + Core.inrWords(n);
  const L = ['Dear ' + p.name + ',', '', 'Ledger statement from ' + biz, 'Period: ' + (a.from ? f(a.from) : 'beginning') + ' to ' + f(a.to), '',
    'Opening balance: ' + m(st.opening), (cust ? 'Invoiced: ' : 'Billed: ') + m(st.billed), (cust ? 'Received: ' : 'Paid: ') + m(st.paid), '*Closing balance: ' + m(st.closing) + '*', ''];
  const pend = d.i.filter(x => x.party_id === p.id && Math.round((x.amount - x.paid - (x.adjusted || 0)) * 100) > 0).sort((x, y) => x.date < y.date ? -1 : 1);
  if (pend.length) { L.push('Pending ' + (cust ? 'invoices' : 'bills') + ':'); pend.slice(0, 10).forEach(x => L.push('• ' + x.number + ' (' + f(x.date) + '): ' + m(x.amount - x.paid - (x.adjusted || 0)))); if (pend.length > 10) L.push('… and ' + (pend.length - 10) + ' more'); L.push(''); }
  L.push('Please reconcile with your records and let us know of any difference.', '', 'Regards,', biz); if (d.S && d.S.phone) L.push(d.S.phone);
  return L.join('\n');
}

/* ---------- UI ---------- */
const css = `
#vx-fab{position:fixed;right:18px;bottom:18px;z-index:70;width:56px;height:56px;border-radius:50%;border:0;background:linear-gradient(180deg,#3d8cf5,#1f4fd8);color:#fff;box-shadow:0 8px 22px -6px #1f4fd8aa;cursor:pointer;display:grid;place-items:center}
#vx-fab svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#vx-fab.on{background:linear-gradient(180deg,#e5484d,#b42318)}
#vx-fab.wake::after{content:'';position:absolute;top:5px;right:5px;width:11px;height:11px;border-radius:50%;background:#22c55e;border:2px solid #fff}
#vx{position:fixed;right:18px;bottom:86px;z-index:71;width:min(420px,calc(100vw - 24px));max-height:min(78vh,640px);display:flex;flex-direction:column;background:#fff;color:#14213d;border:1px solid #d5dbec;border-radius:14px;box-shadow:0 18px 50px -10px #11246b66;overflow:hidden}
#vx[hidden]{display:none}
#vx header{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#11246b;color:#fff}
#vx header b{flex:1;font-size:15px}#vx header button{background:#ffffff22;border:0;color:#fff;border-radius:8px;width:30px;height:30px;font-size:16px;cursor:pointer}
#vx .vs{font-size:12px;opacity:.9;min-width:80px;text-align:right}
#vx .vb{padding:12px;overflow:auto;flex:1;display:flex;flex-direction:column;gap:10px}
#vx .say{background:#eef3ff;border-radius:12px;padding:9px 12px;font-size:14px;line-height:1.4}
#vx .you{align-self:flex-end;background:#e7f6ec;border-radius:12px;padding:7px 12px;font-size:14px;max-width:90%;color:#0f5132}
#vx .you:empty{display:none}
#vx table{width:100%;border-collapse:collapse;font-size:12.5px}#vx th,#vx td{padding:5px 6px;border-bottom:1px solid #e6eaf5;text-align:left}#vx .r{text-align:right}
#vx .lst{max-height:200px;overflow:auto;border:1px solid #e6eaf5;border-radius:10px}
#vx .cf{border:1px solid #1f4fd8;border-radius:12px;padding:10px 12px;background:#f7faff}#vx .cf h4{margin:0 0 6px;font-size:14px}
#vx .cf div{display:flex;justify-content:space-between;gap:10px;font-size:13.5px;padding:2px 0}#vx .cf div span:first-child{color:#4f5c7c}
#vx .acts{display:flex;gap:8px;margin-top:10px}#vx .acts button{flex:1;height:38px;border-radius:9px;border:1px solid #d5dbec;background:#fff;font-weight:600;cursor:pointer}
#vx .acts .go{background:#166534;border-color:#166534;color:#fff}#vx .acts .no{color:#b42318;border-color:#f1c0bb}
#vx .dn{text-align:center;padding:8px 4px}#vx .dn p{margin:8px 0 0;font-size:14px;color:#166534;font-weight:600}
#vx .tick{width:76px;height:76px}#vx .tick circle{fill:#e7f6ec;stroke:#16a34a;stroke-width:3;stroke-dasharray:190;stroke-dashoffset:190;animation:vxc .5s ease forwards}
#vx .tick path{fill:none;stroke:#16a34a;stroke-width:6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:50;stroke-dashoffset:50;animation:vxc .4s .4s ease forwards}
@keyframes vxc{to{stroke-dashoffset:0}}
#vx .er{background:#fdecea;color:#b42318;border-radius:10px;padding:8px 10px;font-size:13px}
#vx .ch button{display:block;width:100%;text-align:left;margin:4px 0;padding:8px 10px;border:1px solid #d5dbec;border-radius:9px;background:#fff;cursor:pointer;font-size:13.5px}
#vx footer{display:flex;gap:6px;padding:8px 10px;border-top:1px solid #e6eaf5}#vx footer input{flex:1;min-width:0;height:38px;border:1px solid #d5dbec;border-radius:9px;padding:0 10px;font-size:14px}
#vx footer button{height:38px;border-radius:9px;border:0;background:#1f4fd8;color:#fff;padding:0 12px;font-weight:600;cursor:pointer}#vx footer .mic{background:#166534;width:44px;padding:0}#vx footer .mic.on{background:#b42318}
#vx footer svg{fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#vx .set{padding:10px 12px;border-top:1px solid #e6eaf5;background:#f7f9fe;overflow:auto;max-height:46vh}
.vxs label{display:block;font-size:13px;margin:8px 0 2px;color:#14213d;font-weight:600}.vxs select,.vxs input[type=range]{width:100%}.vxs small{color:#4f5c7c;display:block;margin-top:2px}.vxs .chk{display:flex;gap:8px;align-items:center;font-weight:500}.vxs .chk input{width:auto}
.vxs .row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
@media(max-width:520px){#vx{right:8px;left:8px;width:auto;bottom:80px}}
@media print{#vx,#vx-fab{display:none!important}}
@media(prefers-reduced-motion:reduce){#vx .tick circle,#vx .tick path{animation:none;stroke-dashoffset:0}}`;
const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
let el = {}, state = null, active = false, rec = null, posting = false, gen = 0;

function build() {
  if (document.getElementById('vx')) return;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const fab = document.createElement('button'); fab.id = 'vx-fab'; fab.type = 'button'; fab.className = 'noprint'; fab.title = 'Voice assistant'; fab.setAttribute('aria-label', 'Open voice assistant'); fab.innerHTML = MIC;
  const box = document.createElement('section'); box.id = 'vx'; box.hidden = true; box.className = 'noprint'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Voice assistant');
  box.innerHTML = `<header><b>Voice assistant</b><span class=vs id=vx-st></span><button type=button id=vx-gear title="Voice settings" aria-label="Voice settings">⚙</button><button type=button id=vx-x title="Close" aria-label="Close voice assistant">✕</button></header>
  <div class=vb><div class=say id=vx-say aria-live=polite>Tap the mic and say a command, for example “Record payment”.</div><div class=you id=vx-you></div><div id=vx-view></div></div>
  <div class="set vxs" id=vx-set hidden></div>
  <footer><input id=vx-in placeholder="Or type a command" aria-label="Type a command" autocomplete=off><button type=button id=vx-send>Send</button><button type=button class=mic id=vx-mic aria-label="Start listening" title="Speak">${MIC.replace('<svg', '<svg width=22 height=22 style="stroke:#fff"')}</button></footer>`;
  document.body.append(box, fab);
  el = {fab, box, st: box.querySelector('#vx-st'), say: box.querySelector('#vx-say'), you: box.querySelector('#vx-you'), view: box.querySelector('#vx-view'), in: box.querySelector('#vx-in'), mic: box.querySelector('#vx-mic'), set: box.querySelector('#vx-set')};
  fab.onclick = () => (el.box.hidden ? open(true) : close());
  box.querySelector('#vx-x').onclick = close;
  box.querySelector('#vx-gear').onclick = () => { el.set.hidden = !el.set.hidden; if (!el.set.hidden) mountSettings(el.set); };
  el.mic.onclick = () => { if (active) stopAll(); else start(); };
  const send = () => { const v = el.in.value.trim(); if (!v) return; el.in.value = ''; say2(v); };
  box.querySelector('#vx-send').onclick = send; el.in.onkeydown = e => { if (e.key === 'Enter') send(); };
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
function setStatus(t) { if (el.st) el.st.textContent = t || ''; }
function open(autoStart) { build(); el.box.hidden = false; if (!SR) showSay('Voice input is not supported in this browser. Please use Chrome or Edge; you can still type commands below.'); if (autoStart && SR) start(); else el.in.focus(); }
function close() { stopAll(); if (el.box) el.box.hidden = true; el.fab && el.fab.focus(); setTimeout(startWake, 600); }
function stopListening() { try { rec && rec.abort(); } catch (_) {} rec = null; }
function stopAll() { active = false; stopListening(); try { TTS && TTS.cancel(); } catch (_) {} el.mic && (el.mic.classList.remove('on'), el.fab.classList.remove('on')); setStatus(''); }
function showSay(t) { el.say.textContent = t; }
function showYou(t) { el.you.textContent = t ? '“' + t + '”' : ''; }

function listenOnce() {
  return new Promise(res => {
    let final = '', err = '', r;
    try { r = new SR(); } catch (e) { return res({text: '', err: 'unsupported'}); }
    rec = r; r.lang = 'en-IN'; r.interimResults = true; r.maxAlternatives = 1; r.continuous = false;
    r.onresult = e => { let it = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) final += x[0].transcript + ' '; else it += x[0].transcript; } showYou((final + it).trim()); };
    r.onerror = e => { err = e.error || 'error'; };
    r.onend = () => { if (rec === r) rec = null; res({text: final.trim(), err}); };
    try { setStatus('Listening…'); el.mic.classList.add('on'); el.fab.classList.add('on'); r.start(); } catch (e) { res({text: '', err: 'start'}); }
  });
}
async function start() {
  stopWake();
  if (!SR) return showSay('Voice input is not supported in this browser. Please use Chrome or Edge, or type below.');
  if (active) return; active = true; needTap = false; converse(null);
}
async function converse(first) {
  let text = first, misses = 0; const my = ++gen;
  while (active && my === gen) {
    if (text == null) {
      const r = await listenOnce(); if (my !== gen) return; el.mic.classList.remove('on'); el.fab.classList.remove('on'); if (!active) break;
      if (r.err === 'not-allowed' || r.err === 'service-not-allowed') { showSay('Microphone permission is blocked. Allow the microphone for this site in the browser address bar, then tap the mic again.'); break; }
      if (r.err === 'network') { showSay('Speech recognition needs an internet connection. You can type the command below.'); break; }
      if (!r.text) { if (++misses >= 2) { showSay('I did not hear anything. Tap the mic to try again.'); setStatus(''); break; } await speak('I am listening. Please say it again.'); continue; }
      misses = 0; text = r.text;
    }
    const out = await turn(text); text = null;
    if (my !== gen) return;
    if (!out || !out.listen) break;
  }
  if (my !== gen) return;
  active = false; el.mic && el.mic.classList.remove('on'); el.fab && el.fab.classList.remove('on'); if (!speaking) setStatus('');
  setTimeout(startWake, 600);
}

async function turn(text) {
  if (posting) return {listen: true};
  {
    showYou(text); setStatus('Thinking…');
    try { await fresh(); if (/statement/i.test(text) || (state && state.flow === 'stmt')) await ensureStatement(); }
    catch (e) { const m = 'Sorry, I could not load your data: ' + e.message; showSay(m); el.view.innerHTML = '<div class=er>' + E(m) + '</div>'; await speak('Sorry, I could not load your data.'); return {listen: false}; }
    const r = Core.step(state, text, coreData()); state = r.state;
    if (r.act && r.act.type === 'post') return await doPost(r.act);
    if (r.act && r.act.type === 'whatsapp') return await doWhatsApp(r.act);
    show(r);
    if (r.act && r.act.type === 'nav') { await speak(r.say); try { sessionStorage.setItem(RESUME, JSON.stringify({label: r.act.label})); } catch (_) {} location.href = r.act.href; return {listen: false}; }
    await speak(r.say);
    if (r.close) { close(); return {listen: false}; }
    return r;
  }
}
function show(r) {
  showSay(r.say); const v = r.view; el.view.innerHTML = ''; if (!v) return;
  if (v.t === 'list') {
    el.view.innerHTML = v.rows.length ? `<div class=lst><table><thead><tr><th>${v.kind === 'sale' ? 'Customer' : 'Vendor'}<th>Bill<th>Date<th class=r>Pending</tr></thead><tbody>${v.rows.map(x => `<tr><td>${E(x.party)}<td>${E(x.number)}<td>${E(x.date)}<td class=r>${E(inr2(x.pend))}</tr>`).join('')}</tbody></table></div>` : '<div class=er>No pending bills.</div>';
  } else if (v.t === 'confirm') {
    el.view.innerHTML = `<div class=cf><h4>${E(v.title)}</h4>${v.lines.map(l => `<div><span>${E(l[0])}</span><b>${E(l[1])}</b></div>`).join('')}<div class=acts><button type=button class=no>Cancel</button><button type=button class=go>Confirm &amp; post</button></div></div>`;
    el.view.querySelector('.go').onclick = () => say2('yes'); el.view.querySelector('.no').onclick = () => say2('cancel');
  } else if (v.t === 'choose') {
    el.view.innerHTML = `<div class=ch>${v.options.map((o, i) => `<button type=button data-i="${i + 1}">${i + 1}. ${E(o.name)}</button>`).join('')}</div>`;
    el.view.querySelectorAll('button').forEach(b => b.onclick = () => say2(b.dataset.i));
  } else if (v.t === 'accounts') {
    el.view.innerHTML = `<div class=ch>${v.rows.map(n => `<button type=button>${E(n)}</button>`).join('')}</div>`; el.view.querySelectorAll('button').forEach(b => b.onclick = () => say2(b.textContent));
  } else if (v.t === 'done') {
    el.view.innerHTML = `<div class=dn><svg class=tick viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="30"/><path d="M24 39l10 10 19-21"/></svg><p>${E(v.text)}</p></div>`;
  } else if (v.t === 'info') el.view.innerHTML = v.text && v.text !== r.say ? `<div class=say>${E(v.text)}</div>` : '';
}
function say2(t) { stopListening(); try { TTS && TTS.cancel(); } catch (_) {} active = true; converse(t); }

async function doPost(a) {
  if (posting) return {listen: true};
  posting = true; state = {flow: null, awaiting: 'more', slots: {}};        /* a second "yes" can never post twice */
  try { return await doPost2(a); } finally { posting = false; }
}
async function doPost2(a) {
  setStatus('Posting…'); el.view.innerHTML = '<div class=say>Posting the entry…</div>';
  const res = await postEntry(a);
  if (!res.ok) {
    const m = 'Sorry, I could not post it. ' + res.err;
    showSay(m + ' Nothing was saved.'); el.view.innerHTML = '<div class=er>' + E(res.err) + '<br>Nothing was saved.</div>'; await speak('Sorry, I could not post it. ' + res.err + ' Nothing was saved. Anything else required?'); return {listen: true};
  }
  const r = Core.afterPost(state, a); state = r.state; show(r);
  try { if (typeof toast === 'function') toast((a.sale ? 'Receipt' : 'Payment') + ' posted'); LP = null; if (window.refresh) window.refresh(); } catch (_) {}
  await speak(r.say); return r;
}
/* "Share ledger statement": builds the A4 statement PDF (assets/pdf.js), saves it, and offers Share PDF (device share sheet, needs a tap) and an Open WhatsApp chat with the message. */
async function ensurePdf() {
  const add = src => new Promise(r => { const e = document.createElement('script'); e.src = src; e.onload = e.onerror = r; document.head.appendChild(e); });
  if (!window.GF) await add('assets/gst-fields.js?v=20261102');
  if (!window.TPPdf) await add('assets/pdf.js?v=20261102');
  if (!window.GF || !window.TPPdf) throw new Error('PDF files are missing on the site (assets/gst-fields.js, assets/pdf.js)');
}
async function doWhatsApp(a) {
  let res, text;
  try {
    await fresh(); await ensureStatement(); await ensurePdf();
    const d = DATA, p = d.p.find(x => x.id === a.party), st = TP.statement(p, d.i, d.t, a.from || null, a.to || null, EXTRA || []), biz = (d.S && d.S.business_name) || 'Shree Digitax Solutions';
    res = await TPPdf.statement({S: d.S || {}, P: p, st, from: a.from || '', to: a.to, today: today()});
    text = 'Dear ' + p.name + ',\n\nPlease find attached the statement of account (' + (a.from ? Core.niceDate(a.from) : 'from the beginning') + ' to ' + Core.niceDate(a.to) + '). Closing balance: ₹' + Core.inrWords(st.closing) + '.\n\nRegards,\n' + biz;
  } catch (e) { showSay('Could not build the statement PDF: ' + e.message); await speak('Sorry, I could not build the statement PDF.'); return {listen: true}; }
  try { TPPdf.download(res); } catch (_) {}
  const url = a.phone ? 'https://wa.me/' + a.phone + '?text=' + encodeURIComponent(text) : '';
  state = {flow: null, awaiting: 'more', slots: {}};
  const say = 'The PDF statement for ' + a.name + ' is ready and saved. Tap Share PDF to send it on WhatsApp. Anything else required?';
  showSay(say);
  el.view.innerHTML = `<div class=dn><svg class=tick viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="30"/><path d="M24 39l10 10 19-21"/></svg><p>Statement PDF ready for ${E(a.name)}</p><div class=acts><button type=button class=go id=vx-sh>Share PDF</button>${url ? '<button type=button id=vx-wa>WhatsApp message</button>' : ''}<button type=button id=vx-dl>Download again</button></div></div>`;
  el.view.querySelector('#vx-sh').onclick = async () => { const r = await TPPdf.share(res, text, a.phone); if (r === 'downloaded' && typeof toast === 'function') toast('PDF saved. Attach it in WhatsApp.'); };
  const wa = el.view.querySelector('#vx-wa'); if (wa) wa.onclick = () => window.open(url, '_blank', 'noopener');
  el.view.querySelector('#vx-dl').onclick = () => TPPdf.download(res);
  await speak(say); return {listen: true};
}

/* ---------- hands-free wake word ("Hey Buddy") ----------
   While the ERP page is open and this is switched on, the browser listens continuously for the wake phrase only.
   On a match it opens the panel, says "Yes, how may I help you?" and listens for the command. */
let wrec = null, wFail = 0, wTimer = null;
function wakeUi(on) { if (!el.fab) return; el.fab.classList.toggle('wake', !!on); el.fab.title = on ? 'Voice assistant - say “' + getCfg().wakePhrase + '”' : 'Voice assistant'; }
function startWake() {
  clearTimeout(wTimer); if (!SR || !getCfg().wake || active || wrec || posting) return;
  let r; try { r = new SR(); } catch (_) { return; }
  wrec = r; r.lang = 'en-IN'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  let hit = false, pend = null;
  const fire = rest => { if (hit) return; hit = true; wFail = 0; clearTimeout(pend); wrec = null; try { r.abort(); } catch (_) {} wakeUi(false); onWake(rest); };
  r.onresult = e => {
    if (hit) return;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const x = e.results[i], w = Core.wake(x[0].transcript, getCfg().wakePhrase);
      if (!w.hit) continue;
      if (x.isFinal) return fire(w.rest);
      clearTimeout(pend); pend = setTimeout(() => fire(''), 900);              /* phrase heard but no pause yet: wait briefly for the rest of the sentence */
    }
  };
  r.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wFail = 99; setCfg({wake: false}); wakeUi(false); if (el.say) showSay('Hands-free is off because microphone permission is blocked. Allow the microphone for this site, then switch it on again in Settings.'); }
    else if (e.error !== 'no-speech' && e.error !== 'aborted') wFail++;
  };
  r.onend = () => { if (wrec === r) wrec = null; clearTimeout(pend); if (hit) return; wakeUi(false); if (getCfg().wake && !active && wFail < 99) wTimer = setTimeout(startWake, Math.min(6000, 250 + wFail * 600)); };
  try { r.start(); wakeUi(true); } catch (_) { wrec = null; wTimer = setTimeout(startWake, 1500); }
}
function stopWake() { clearTimeout(wTimer); const r = wrec; wrec = null; try { r && r.abort(); } catch (_) {} wakeUi(false); }
async function onWake(rest) {
  build(); open(false); needTap = false; active = true;
  if (rest) { converse(rest); return; }
  const g = 'Yes, how may I help you?'; showSay(g); showYou(''); el.view.innerHTML = '';
  await speak(g); if (active) converse(null);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(startWake, 400); });

/* ---------- settings card (also shown on Settings > Voice assistant) ---------- */
function mountSettings(host) {
  if (!host) return; const c = getCfg(), vs = enVoices(), accts = (DATA && DATA.a) || [];
  const render = () => {
    const c = getCfg(), cur = pickVoice(c);
    host.classList.add('vxs');
    host.innerHTML = `<h3>Voice assistant</h3><p class=k>Speak commands such as “Record payment”, “Record receipt”, “Show me dashboard” or “Share ledger statement to customer …”. Settings are saved on this device, because each device has its own voices.</p>
    ${TTS ? '' : '<div class=er>This browser cannot speak. Use Chrome or Edge.</div>'}${SR ? '' : '<div class=er>This browser cannot listen. Use Chrome or Edge.</div>'}
    <label for=vxv>Assistant voice</label><select id=vxv><option value="">Automatic (${E(cur ? cur.name : 'none found')})</option>${vs.map(v => `<option value="${E(v.voiceURI)}" ${c.voiceURI === v.voiceURI ? 'selected' : ''}>${E(v.name)} (${E(v.lang)})${gender(v) ? ' - ' + gender(v) : ''}</option>`).join('')}</select>
    <small>${vs.length ? vs.length + ' English voices on this device.' : 'No voices loaded yet. On some devices they appear after a moment; reopen this panel.'} Install more voices in your device language settings.</small>
    <label class=chk><input type=checkbox id=vxm ${c.male ? 'checked' : ''}> Prefer a male voice when set to Automatic</label>
    <label class=chk><input type=checkbox id=vxw ${c.wake ? 'checked' : ''}> Hands-free: wake the assistant by voice</label>
    <label for=vxwp>Wake phrase</label><input id=vxwp value="${E(c.wakePhrase)}" maxlength=30 style="width:100%;height:36px;padding:0 8px">
    <small>Say the phrase (for example “Hey Buddy”) and the assistant answers “Yes, how may I help you?”. Works only while the ERP page is open in Chrome or Edge on this device. The microphone stays on while this is enabled and your browser's speech service hears what is said near it, so switch it off in shared or noisy places.</small>
    <label for=vxp>Pitch: <span id=vxpv>${(+c.pitch).toFixed(2)}</span></label><input type=range id=vxp min=0.5 max=1.5 step=0.05 value="${c.pitch}"><small>Lower = deeper voice. If your device has no male voice, a pitch around 0.7 to 0.8 makes the voice sound deeper.</small>
    <label for=vxr>Speed: <span id=vxrv>${(+c.rate).toFixed(2)}</span></label><input type=range id=vxr min=0.7 max=1.4 step=0.05 value="${c.rate}">
    <label for=vxl>Volume: <span id=vxlv>${Math.round(c.volume * 100)}%</span></label><input type=range id=vxl min=0.2 max=1 step=0.1 value="${c.volume}">
    ${accts.length > 1 ? `<label for=vxa>Default bank / cash account for voice entries</label><select id=vxa><option value="">Ask me each time</option>${accts.map(a => `<option value="${E(a.id)}" ${c.defaultAccount === a.id ? 'selected' : ''}>${E(a.name)}</option>`).join('')}</select>` : ''}
    <div class=row><button type=button class=g id=vxt>Test voice</button><button type=button class=g id=vxo>Open assistant</button></div>`;
    const bind = (id, fn) => { const n = host.querySelector(id); if (n) n.oninput = n.onchange = fn; };
    bind('#vxv', e => { setCfg({voiceURI: e.target.value}); });
    bind('#vxw', e => { setCfg({wake: e.target.checked}); if (e.target.checked) { wFail = 0; startWake(); } else stopWake(); });
    bind('#vxwp', e => { const v = e.target.value.trim(); if (v.split(/\s+/).length >= 2) { setCfg({wakePhrase: v}); if (getCfg().wake) { stopWake(); startWake(); } } });
    bind('#vxm', e => { setCfg({male: e.target.checked}); render(); });
    bind('#vxp', e => { setCfg({pitch: +e.target.value}); host.querySelector('#vxpv').textContent = (+e.target.value).toFixed(2); });
    bind('#vxr', e => { setCfg({rate: +e.target.value}); host.querySelector('#vxrv').textContent = (+e.target.value).toFixed(2); });
    bind('#vxl', e => { setCfg({volume: +e.target.value}); host.querySelector('#vxlv').textContent = Math.round(e.target.value * 100) + '%'; });
    bind('#vxa', e => { setCfg({defaultAccount: e.target.value}); });
    host.querySelector('#vxt').onclick = () => speak('Hello, I am your Toolkit Pro voice assistant. Payment against which bill of which vendor?');
    host.querySelector('#vxo').onclick = () => { build(); open(false); };
  };
  render(); if (TTS && !vs.length) { const h = () => { TTS.removeEventListener('voiceschanged', h); render(); }; TTS.addEventListener('voiceschanged', h); }
  if (!DATA) fresh().then(() => { if (DATA.a.length > 1) render(); }).catch(() => {});
}

/* ---------- start ---------- */
window.VoiceUI = {startWake, stopWake, mountSettings, open: () => { build(); open(false); }, getCfg, setCfg, speak};
build();
try {
  const rs = sessionStorage.getItem(RESUME);
  if (!rs && getCfg().wake) setTimeout(startWake, 800);
  if (rs) {
    sessionStorage.removeItem(RESUME); const lab = (JSON.parse(rs) || {}).label || 'the page';
    state = {flow: null, awaiting: 'more', slots: {}}; open(false);
    const say = 'Here is ' + lab + '. Anything else required?'; showSay(say);
    speak(say).then(() => { if (needTap) showSay(say + ' Tap the mic to continue.'); else if (SR) start(); });
  }
} catch (_) {}
})();
