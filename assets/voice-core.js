/* Toolkit Pro - voice assistant brain (pure functions: no DOM, no database, no speech API).
   step(state, utterance, data) -> {state, say, view, act, listen}
   Used by assets/voice.js in the browser and by tests/voice.test.js in Node. English (en-IN) only. */
(function (root) {
'use strict';
const lc = s => String(s == null ? '' : s).toLowerCase();
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONRE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthNo = s => MONTHS.findIndex(m => m.startsWith(lc(s).slice(0, 3))) + 1;
const U = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19};
const T = {twenty:20,thirty:30,forty:40,fourty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const MUL = {hundred:100,thousand:1e3,lakh:1e5,lakhs:1e5,lac:1e5,lacs:1e5,crore:1e7,crores:1e7};
const ORD = {first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10,eleventh:11,twelfth:12,thirteenth:13,fourteenth:14,fifteenth:15,sixteenth:16,seventeenth:17,eighteenth:18,nineteenth:19,twentieth:20,thirtieth:30};
const isNumWord = w => w in U || w in T || w in MUL;

/* ---------- text normalising ---------- */
function digitize(s) {
  s = lc(s).replace(/₹/g, ' rs ').replace(/[^\w\s.\/\-#,&]/g, ' ');
  s = s.replace(/(?<=\d),(?=\d{2,3}(?:\D|$))/g, '');               /* 1,23,456 -> 123456 */
  s = s.replace(/,/g, ' ');
  /* spoken ordinal dates: "twenty fifth october", "fifth of october", "october fifth" */
  const ordAfter = new RegExp('\\b(?:(twenty|thirty)[\\s-])?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)(?=\\s+(?:of\\s+)?' + MONRE + '\\b)', 'g');
  s = s.replace(ordAfter, (m, t, o) => String((t ? T[t] : 0) + ORD[o]));
  const ordBefore = new RegExp('\\b' + MONRE + '(\\s+)(?:(twenty|thirty)[\\s-])?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\\b', 'g');
  s = s.replace(ordBefore, (m, mo, sp, t, o) => mo + sp + String((t ? T[t] : 0) + ORD[o]));
  s = s.replace(/(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|thousand|k)\b/g, (m, n, u) => {
    const f = /^(lakh|lac)/.test(u) ? 1e5 : /^crore/.test(u) ? 1e7 : 1e3; return String(Math.round(+n * f * 100) / 100);
  });
  const tk = s.replace(/([a-z])-(?=[a-z])/g, '$1 ').split(/\s+/).filter(Boolean), out = [];
  for (let i = 0; i < tk.length;) {
    if (!isNumWord(tk[i])) { out.push(tk[i]); i++; continue; }
    let j = i; const run = [];
    while (j < tk.length) {
      if (isNumWord(tk[j])) { run.push(tk[j]); j++; }
      else if (tk[j] === 'and' && run.length && j + 1 < tk.length && isNumWord(tk[j + 1]) && (lc(run[run.length - 1]) in MUL)) j++;
      else break;
    }
    if (run.length > 1 && run.every(w => w in U && U[w] < 10)) out.push(run.map(w => U[w]).join(''));
    else { let cur = 0, tot = 0; for (const w of run) { if (w in U) cur += U[w]; else if (w in T) cur += T[w]; else if (w === 'hundred') cur = (cur || 1) * 100; else { tot += (cur || 1) * MUL[w]; cur = 0; } } out.push(String(tot + cur)); }
    i = j;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
const norm = s => digitize(s);
const alnum = s => lc(s).replace(/[^a-z0-9]/g, '');

/* ---------- fuzzy matching ---------- */
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let p = Array.from({length: n + 1}, (_, i) => i);
  for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[n];
}
const skel = s => { s = lc(s).replace(/ph/g, 'f').replace(/[ck]+/g, 'k').replace(/w/g, 'v').replace(/z/g, 'j').replace(/(.)\1+/g, '$1'); return s[0] + s.slice(1).replace(/[aeiouyh]/g, ''); };
function tokSim(a, b) {
  if (a === b) return 1; if (!a || !b) return 0;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return 0;
  if (a.length > 2 && b.length > 2 && (a.startsWith(b) || b.startsWith(a))) return .85;
  const s = 1 - lev(a, b) / Math.max(a.length, b.length); let best = s >= .62 ? s : 0;
  if (a.length > 2 && b.length > 2 && skel(a) === skel(b)) best = Math.max(best, .8);
  return best;
}
const GENERIC = new Set(['and', 'pvt', 'ltd', 'private', 'limited', 'the', 'ms', 'm/s', 'co', 'company', '&', 'llp', 'inc', 'corp', 'traders', 'enterprises', 'enterprise', 'agency', 'agencies', 'services', 'solutions', 'stores', 'store', 'industries']);
const FILLER = new Set(['record', 'payment', 'receipt', 'against', 'bill', 'number', 'no', 'invoice', 'inv', 'amount', 'rupees', 'rupee', 'rs', 'date', 'dated', 'on', 'of', 'to', 'for', 'from', 'vendor', 'supplier', 'customer', 'client', 'name', 'the', 'a', 'is', 'paid', 'pay', 'received', 'party', 'statement', 'ledger', 'share', 'send', 'whatsapp', 'full', 'today', 'yesterday', 'please', 'with', 'by', 'in', 'my', 'me']);
function partyScore(name, utter) {
  const nt = norm(name).split(/[\s\/,.]+/).filter(Boolean), ut = utter.split(/[\s\/,.]+/).filter(t => t && !FILLER.has(t));
  if (!nt.length || !ut.length) return 0;
  let w = 0, got = 0;
  for (const n of nt) { const wt = GENERIC.has(n) ? .35 : 1; w += wt; let b = 0; for (const u of ut) b = Math.max(b, tokSim(n, u)); got += wt * b; }
  return got / w;
}
const ACCT_GENERIC = new Set(['current', 'saving', 'savings', 'account', 'bank', 'ac', 'a/c', 'in', 'hand', 'od', 'cc', 'of', 'the', 'and']);
function acctScore(name, utter) {
  let nt = norm(name).split(/[\s\/,.]+/).filter(Boolean); const key = nt.filter(w => !ACCT_GENERIC.has(w)); if (key.length) nt = key;
  const ut = utter.split(/[\s\/,.]+/).filter(t => t && !FILLER.has(t) && !ACCT_GENERIC.has(t));
  let best = 0; for (const n of nt) for (const u of ut) best = Math.max(best, tokSim(n, u)); return best;
}
function findParties(parties, utter, favour) {
  return parties.map(p => ({p, s: partyScore(p.name, utter) + (favour && favour.has(p.id) ? .04 : 0)})).filter(x => x.s >= .6).sort((a, b) => b.s - a.s);
}

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
const validDay = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate();
const addDays = (isoD, n) => { const d = new Date(isoD + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fyStart = d => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return (m >= 4 ? y : y - 1) + '-04-01'; };
function resolveYear(y, m, d, today) {
  if (y != null) return y < 100 ? 2000 + y : y;
  const ty = +today.slice(0, 4); let c = iso(ty, m, d); if (c > addDays(today, 31)) return ty - 1; return ty;
}
function parseDate(t, today) {
  let m;
  if ((m = /\bday before yesterday\b/.exec(t))) return {iso: addDays(today, -2), rest: t.replace(m[0], ' ')};
  if ((m = /\byesterday\b/.exec(t))) return {iso: addDays(today, -1), rest: t.replace(m[0], ' ')};
  if ((m = /\btoday\b/.exec(t))) return {iso: today, rest: t.replace(m[0], ' ')};
  let r = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?' + MONRE + '\\b\\.?(?:\\s*,?\\s*(\\d{4}|\\d{2})\\b)?').exec(t);
  if (r) { const d = +r[1], mo = monthNo(r[2]), y = resolveYear(r[3] ? +r[3] : null, mo, d, today); if (validDay(y, mo, d)) return {iso: iso(y, mo, d), rest: t.replace(r[0], ' ')}; }
  r = new RegExp('\\b' + MONRE + '\\b\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(\\d{4})\\b)?').exec(t);
  if (r) { const d = +r[2], mo = monthNo(r[1]), y = resolveYear(r[3] ? +r[3] : null, mo, d, today); if (validDay(y, mo, d)) return {iso: iso(y, mo, d), rest: t.replace(r[0], ' ')}; }
  r = /(?<![\d\/\-.])(\d{1,2})[\/\-](\d{1,2})(?:[\/\-.](\d{4}|\d{2}))?(?![\d\/\-])/.exec(t) || /(?<![\d\/\-.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/.exec(t);
  if (r) { const d = +r[1], mo = +r[2], y = resolveYear(r[3] ? +r[3] : null, mo, d, today); if (validDay(y, mo, d)) return {iso: iso(y, mo, d), rest: t.replace(r[0], ' ')}; }
  return {iso: null, rest: t};
}
const MONN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const niceDate = d => d ? (+d.slice(8, 10)) + ' ' + MONN[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4) : '';
const inrWords = n => Number(n).toLocaleString('en-IN', {maximumFractionDigits: 2});

/* ---------- bills, amounts ---------- */
const BILL_STOP = new Set(['amount', 'rupees', 'rupee', 'rs', 'date', 'dated', 'on', 'of', 'for', 'paid', 'dt', 'vendor', 'supplier', 'customer', 'from', 'to', 'against', 'via', 'by', 'through', 'with', 'today', 'yesterday', 'inr', 'received', 'full', 'in', 'into', 'and', 'name']);
const isMonthWord = w => new RegExp('^' + MONRE + '$').test(w);
function takeBill(t) {
  const m = /\b(?:bill|invoice|inv)\s*(?:number|no|num|#)?\.?\s*[:\-]?\s*/.exec(t); if (!m) return {bill: null, rest: t};
  const after = t.slice(m.index + m[0].length), tk = after.split(' ').filter(Boolean), take = [];
  const okTok = w => /^[a-z0-9][a-z0-9\-\/]*$/.test(w) && !BILL_STOP.has(w) && !isMonthWord(w);
  if (tk.length && okTok(tk[0])) { take.push(tk[0]); if (/^[a-z]{1,5}$/.test(tk[0]) && tk[1] && /^[0-9][a-z0-9\-\/]*$/.test(tk[1]) && !isMonthWord(tk[1])) take.push(tk[1]); }
  if (!take.length) return {bill: null, rest: t};
  const spoken = take.join(' '), cut = m[0] + take.join(' ');
  return {bill: spoken, rest: (t.slice(0, m.index) + ' ' + t.slice(m.index + cut.length)).replace(/\s+/g, ' ')};
}
const digitsOf = s => String(s).replace(/\D/g, '').replace(/^0+/, '');
function matchBills(spoken, list) {
  const sp = alnum(spoken), sd = digitsOf(spoken), hasLetters = /[a-z]/.test(sp);
  const sc = list.map(x => {
    const n = alnum(x.number), nd = digitsOf(x.number); let s = 0;
    if (sp && n === sp) s = 4;
    else if (sd && nd === sd && (!hasLetters || n.includes(sp.replace(/\d/g, '')))) s = 3;
    else if (sd && nd === sd) s = 2.5;
    else if (sp.length >= 2 && (n.endsWith(sp) || (sd.length >= 2 && nd.endsWith(sd)))) s = 1;
    return {x, s};
  }).filter(o => o.s > 0);
  if (!sc.length) return [];
  const top = Math.max(...sc.map(o => o.s)); return sc.filter(o => o.s === top).map(o => o.x);
}
const NUMRE = '(\\d+(?:\\.\\d{1,2})?)';
function takeAmount(t) {
  let m;
  if ((m = new RegExp('\\b(?:amount\\s*(?:is|of|was|to|as)?|(?:paid|pay|received|receive|payment|receipt)\\s*(?:is|of|was)?)\\s*(?:rs\\.?|rupees?)?\\s*' + NUMRE + '\\b').exec(t))) return {amount: +m[1], rest: t.replace(m[0], ' ')};
  if ((m = new RegExp('\\b' + NUMRE + '\\s*(?:rupees?|rs\\b\\.?|inr)').exec(t))) return {amount: +m[1], rest: t.replace(m[0], ' ')};
  if ((m = new RegExp('\\b(?:rupees?|rs\\.?|inr)\\s*' + NUMRE + '\\b').exec(t))) return {amount: +m[1], rest: t.replace(m[0], ' ')};
  return {amount: null, rest: t};
}
const numsIn = t => (t.match(/(?<![\w\-\/])\d+(?:\.\d{1,2})?(?![\w\-\/])/g) || []).map(Number);

/* ---------- yes / no ---------- */
const NEG = /\b(no|nope|nah|cancel|stop|don'?t|do not|wrong|incorrect|nahi|never ?mind|abort|exit)\b/;
const POS = /\b(yes|yeah|yep|yup|confirm|confirmed|correct|right|ok|okay|proceed|post|post it|go ahead|do it|haan|ha|sure|done|save|submit)\b/;
const isNo = t => NEG.test(t);
const isYes = t => POS.test(t) && !NEG.test(t);
const isDone = t => /\b(nothing|that'?s all|that is all|no thanks|no thank you|thank you|thanks|goodbye|bye|close|stop listening|nothing else|no more|i am done|all done)\b/.test(t) || /^(no|nope|nahi)$/.test(t);

/* ---------- pending-bill helpers ---------- */
const pnd = x => Math.round((+x.amount || 0) * 100) - Math.round((+x.paid || 0) * 100) - Math.round((+x.adjusted || 0) * 100);
const pending = (D, kind) => D.invoices.filter(x => x.kind === kind && pnd(x) > 0).map(x => ({...x, pend: pnd(x) / 100}));
const pname = (D, id) => (D.parties.find(p => p.id === id) || {}).name || '';
function listView(D, kind, party) {
  const rows = pending(D, kind).filter(x => !party || x.party_id === party).map(x => ({id: x.id, party: pname(D, x.party_id), number: x.number, date: x.date, due: x.due_date || '', pend: x.pend}));
  rows.sort((a, b) => a.party.localeCompare(b.party) || (a.date < b.date ? -1 : 1));
  return {t: 'list', rows, kind};
}

const FLOW = {
  pay: {kind: 'purchase', pk: 'supplier', who: 'vendor', Who: 'Vendor', verb: 'Payment', sale: false},
  receipt: {kind: 'sale', pk: 'client', who: 'customer', Who: 'Customer', verb: 'Receipt', sale: true}
};
const NAVMAP = [
  [/\b(dash ?board|home|main screen)\b/, 'index.html', 'dashboard'],
  [/\btrial balance\b/, 'trial-balance.html', 'trial balance'],
  [/\b(profit and loss|profit & loss|p ?(and|&) ?l)\b/, 'profit-loss.html', 'profit and loss'],
  [/\bbalance sheet\b/, 'balance-sheet.html', 'balance sheet'],
  [/\b(day ?book)\b/, 'daybook.html', 'day book'],
  [/\bcash book\b/, 'ledger.html?book=cash', 'cash book'],
  [/\b(general ledger|ledger)\b/, 'ledger.html', 'general ledger'],
  [/\b(debtors|receivables|customer ageing|sales ageing)\b/, 'ageing.html?kind=sale', 'debtors ageing'],
  [/\b(creditors|payables|supplier ageing|purchase ageing)\b/, 'ageing.html?kind=purchase', 'creditors ageing'],
  [/\b(sales invoices?|sales)\b/, 'invoices.html?kind=sale', 'sales invoices'],
  [/\b(purchase bills?|purchases|bills)\b/, 'invoices.html?kind=purchase', 'purchase bills'],
  [/\b(customers|clients)\b/, 'customers.html?kind=client', 'customers'],
  [/\b(suppliers|vendors)\b/, 'customers.html?kind=supplier', 'suppliers'],
  [/\b(banking|bank accounts?)\b/, 'banking.html', 'banking'],
  [/\b(transactions)\b/, 'transactions.html', 'transactions'],
  [/\b(gst|taxes|tax)\b/, 'taxes.html', 'GST and taxes'],
  [/\b(tds)\b/, 'tds.html', 'TDS'],
  [/\b(daily summary|today'?s summary)\b/, 'daily.html', 'daily summary'],
  [/\b(reports?)\b/, 'reports.html', 'reports'],
  [/\b(settings|voice settings)\b/, 'settings.html#voice', 'settings'],
  [/\b(reminders?)\b/, 'reminders.html', 'reminders'],
  [/\b(calendar)\b/, 'calendar.html', 'compliance calendar']
];
const HELP = 'You can say: record payment, record receipt, show dashboard, share ledger statement to customer, or share ledger statement to supplier. You can also say open ledger, day book, trial balance, profit and loss, or outstanding of a party.';

/* ---------- reply helpers ---------- */
const R = (st, say, view, extra) => Object.assign({state: st, say, view: view || null, act: null, listen: true}, extra || {});
const idle = (extra) => Object.assign({flow: null, awaiting: null, slots: {}}, extra || {});

/* ---------- wake phrase ("hey buddy") ---------- */
const GREET = new Set(['hey', 'hay', 'hi', 'hello', 'ok', 'okay', 'a', 'he', 'hei', 'hai', 'heyy']);
function wake(text, phrase) {
  const tk = norm(text).split(/[\s,.!?]+/).filter(Boolean), tg = norm(phrase || 'hey buddy').split(/\s+/).filter(Boolean);
  if (!tg.length) return {hit: false, rest: ''};
  for (let i = 0; i + tg.length <= tk.length; i++) {
    let ok = true;
    for (let j = 0; j < tg.length; j++) { const a = tg[j], b = tk[i + j]; if (!(tokSim(a, b) >= .7 || (j === 0 && GREET.has(a) && GREET.has(b)))) { ok = false; break; } }
    if (ok) return {hit: true, rest: tk.slice(i + tg.length).join(' ')};
  }
  return {hit: false, rest: ''};
}

/* ---------- main entry ---------- */
function step(state, text, D) {
  const st = state ? JSON.parse(JSON.stringify(state)) : idle();
  st.slots = st.slots || {};
  const t = norm(text);
  if (!t) return R(st, 'Sorry, I did not catch that. Please say it again.');
  if (st.flow && isNo(t) && !((st.awaiting === 'confirm' || st.awaiting === 'choose') && /\d/.test(t))) return R(idle({awaiting: 'more'}), 'Cancelled. Anything else required?', {t: 'info', text: 'Cancelled'});
  if (st.flow === 'pay' || st.flow === 'receipt') return payStep(st, t, D);
  if (st.flow === 'stmt') return stmtStep(st, t, D);
  return commandStep(st, t, D);
}

function commandStep(st, t, D) {
  if (st.awaiting === 'more' && isDone(t)) return R(idle(), 'Okay. Call me when you need me.', {t: 'info', text: 'Closed'}, {listen: false, close: true});
  if (/\b(help|what can you do|commands)\b/.test(t)) return R(idle({awaiting: 'more'}), HELP, {t: 'info', text: HELP});
  if (isDone(t) && !/\b(statement|payment|receipt)\b/.test(t)) return R(idle(), 'Okay. Call me when you need me.', {t: 'info', text: 'Closed'}, {listen: false, close: true});
  /* statements first: "share ledger statement to customer X" */
  if (/\b(statement|ledger statement|account statement)\b/.test(t) && /\b(share|send|whatsapp|give|get|show)\b|statement (to|of|for)\b/.test(t)) {
    const s = {kind: /\b(supplier|vendor)\b/.test(t) ? 'supplier' : /\b(customer|client)\b/.test(t) ? 'client' : null};
    return stmtStep({flow: 'stmt', awaiting: null, slots: s}, t, D, true);
  }
  if (/\b(receipt|receive|received)\b/.test(t) && /\b(record|enter|post|make|add|new|create|book)\b|record receipt|payment received/.test(t) || /\breceipt entry\b/.test(t)) return startPay('receipt', t, D);
  if (/\b(record|enter|post|make|add|new|create|book)\b.*\bpayment\b|\bpayment entry\b|\bpay (to|the)\b|\bmake payment\b/.test(t)) return startPay('pay', t, D);
  if (/\bpayment received\b/.test(t)) return startPay('receipt', t, D);
  const o = /\b(outstanding|balance|owe|owes|pending)\b/.test(t) && !/\b(sheet|trial)\b/.test(t);
  if (o) {
    const hits = findParties(D.parties, t);
    if (hits.length) {
      const p = hits[0].p, sale = p.kind === 'client', tot = D.invoices.filter(x => x.party_id === p.id).reduce((s, x) => s + Math.max(0, pnd(x)), 0) / 100;
      const say = sale ? p.name + ' owes you ' + inrWords(tot) + ' rupees.' : 'You owe ' + p.name + ' ' + inrWords(tot) + ' rupees.';
      return R(idle({awaiting: 'more'}), say + ' Anything else required?', {t: 'info', text: say});
    }
  }
  if (/\b(open|show|go to|take me to|display|view)\b|^\w+( \w+)?$/.test(t)) {
    for (const [re, href, label] of NAVMAP) if (re.test(t)) return R(idle({awaiting: 'more'}), 'Opening ' + label + '.', {t: 'info', text: 'Opening ' + label}, {act: {type: 'nav', href, label}});
  }
  return R(idle({awaiting: st.awaiting === 'more' ? 'more' : null}), "Sorry, I did not understand that. " + HELP, {t: 'info', text: HELP});
}

function startPay(flow, t, D) {
  const F = FLOW[flow], st = {flow, awaiting: 'party', slots: {}};
  const r = payStep(st, t, D, true);
  return r;
}

/* extract everything we can find from one utterance into slots; returns notes */
function extractPay(t, st, D, F) {
  const s = st.slots, notes = {};
  const pend = pending(D, F.kind), pool = D.parties.filter(p => p.kind === F.pk), favour = new Set(pend.map(x => x.party_id));
  let rest = t;
  const b = takeBill(rest); rest = b.rest;
  if (b.bill) { s.billSpoken = b.bill; delete s.invoice; notes.bill = true; }
  const d = parseDate(rest, D.today); rest = d.rest; if (d.iso) { s.date = d.iso; notes.date = true; }
  const a = takeAmount(rest); rest = a.rest; if (a.amount != null) { s.amount = a.amount; delete s.full; notes.amount = true; }
  if (/\b(full|whole|entire|complete|balance|pending|outstanding|all)\b/.test(rest) && (st.awaiting === 'amount' || /\b(full|whole|entire)\b/.test(rest))) { s.full = true; delete s.amount; notes.amount = true; }
  /* bare numbers */
  const nums = numsIn(rest);
  if (nums.length) {
    if (st.awaiting === 'amount' && s.amount == null && !s.full) { s.amount = nums[nums.length - 1]; notes.amount = true; }
    else if (st.awaiting === 'bill' && !s.billSpoken) { s.billSpoken = String(nums[0]); notes.bill = true; }
    else if (nums.length === 2 && s.amount == null && !s.billSpoken) {
      const scope = s.party ? pend.filter(x => x.party_id === s.party) : pend;
      const i = nums.findIndex(n => matchBills(String(n), scope).length === 1);
      if (i >= 0) { s.billSpoken = String(nums[i]); s.amount = nums[1 - i]; notes.bill = notes.amount = true; }
    } else if (nums.length === 1 && s.amount == null && s.billSpoken && !st.awaiting) { s.amount = nums[0]; notes.amount = true; }
    else if (nums.length === 1 && s.amount == null && !s.billSpoken) {
      const scope = s.party ? pend.filter(x => x.party_id === s.party) : pend;
      if (matchBills(String(nums[0]), scope).length === 1 && st.awaiting !== 'confirm') { s.billSpoken = String(nums[0]); notes.bill = true; }
      else if (st.awaiting === 'confirm' || st.awaiting === 'date') { s.amount = nums[0]; notes.amount = true; }
    }
  }
  if (st.awaiting === 'date' && !d.iso && nums.length === 1 && nums[0] >= 1 && nums[0] <= 31 && !notes.amount) {
    const dd = nums[0], y = +D.today.slice(0, 4), mo = +D.today.slice(5, 7); if (validDay(y, mo, dd)) { s.date = iso(y, mo, dd); notes.date = true; }
  }
  /* account (match by words in the utterance) */
  if (D.accounts && D.accounts.length > 1) {
    const hs = D.accounts.map(x => ({x, sc: acctScore(x.name, rest)})).filter(o => o.sc >= .8).sort((p, q) => q.sc - p.sc);
    if (hs.length && (hs.length === 1 || hs[0].sc - hs[1].sc >= .1)) { s.account = hs[0].x.id; notes.account = true; }
  }
  /* party */
  const wantParty = !s.party || st.awaiting === 'party' || st.awaiting === 'choose_party' || /\b(vendor|supplier|customer|client|party)\b/.test(rest) || st.awaiting === 'confirm';
  if (wantParty) {
    const hits = findParties(pool, rest, favour).filter(h => !notes.account || partyScore(h.p.name, rest) >= .75);
    if (hits.length) {
      const top = hits[0], close = hits.filter(h => top.s - h.s < .1 && h.p.id !== top.p.id);
      if (close.length && top.s < .98) { st.options = [top, ...close].slice(0, 4).map(h => ({id: h.p.id, name: h.p.name})); notes.ambiguous = true; }
      else if (top.p.id !== s.party) { s.party = top.p.id; delete s.invoice; if (!notes.bill) delete s.billSpoken; notes.party = true; }
    } else if (st.awaiting !== 'confirm' && !s.party) {
      const meaningful = rest.split(/[\s\/,.]+/).filter(w => /^[a-z]{3,}$/.test(w) && !FILLER.has(w) && !isMonthWord(w) && !BILL_STOP.has(w) && !/^(yes|please|okay|and|the|full|whole|entire|against|then|also)$/.test(w));
      if (meaningful.length) notes.noParty = true;
    }
  }
  return notes;
}

function payStep(st, t, D, first) {
  const F = FLOW[st.flow], s = st.slots, pend = pending(D, F.kind);
  if (st.awaiting === 'confirm') {
    if (isYes(t)) return R(st, 'Posting.', null, {act: postAct(st, D, F), listen: false});
  }
  if (st.awaiting === 'choose') {
    const opts = st.options || [], ordWord = {first: 1, one: 1, second: 2, two: 2, third: 3, three: 3, fourth: 4, four: 4};
    let pick = null; const m = /\b(\d)\b/.exec(t) || /\b(first|second|third|fourth|one|two|three|four)\b/.exec(t);
    if (m) pick = opts[(isNaN(m[1]) ? ordWord[m[1]] : +m[1]) - 1];
    if (!pick) { const h = opts.map(o => ({o, sc: partyScore(o.name, t)})).sort((a, b) => b.sc - a.sc)[0]; if (h && h.sc >= .75) pick = h.o; }
    if (!pick) return R(st, 'Please say one of: ' + opts.map((o, i) => (i + 1) + ', ' + o.name).join('; ') + '.', {t: 'choose', options: opts});
    if (st.chooseKind === 'party') { s.party = pick.id; delete s.invoice; delete s.billSpoken; }
    else { s.invoice = pick.id; }
    st.options = null; st.chooseKind = null; st.awaiting = null;
  } else {
    const notes = extractPay(t, st, D, F);
    if (notes.ambiguous) {
      st.awaiting = 'choose'; st.chooseKind = 'party';
      return R(st, 'I found more than one match. Which ' + F.who + ' did you mean? ' + st.options.map((o, i) => (i + 1) + ', ' + o.name).join('; ') + '.', {t: 'choose', options: st.options});
    }
    if (notes.noParty && !s.party) {
      return R(st, "I could not find that " + F.who + ". Please say the " + F.who + " name again.", listView(D, F.kind));
    }
    if (st.awaiting === 'confirm' && Object.keys(notes).length) { st.awaiting = null; st.corrected = true; }
  }
  return advance(st, D, F, first);
}

function postAct(st, D, F) {
  const s = st.slots, inv = D.invoices.find(x => x.id === s.invoice);
  const party = pname(D, inv.party_id);
  return {type: 'post', sale: F.sale, invoice: inv.id, number: inv.number, party, amount: s.amount, date: s.date, account: s.account || null,
    description: (F.sale ? 'Receipt ' : 'Payment ') + inv.number + ' - ' + party};
}

function advance(st, D, F, first) {
  const s = st.slots, pend = pending(D, F.kind);
  /* 1. party / bill */
  if (!s.party && s.billSpoken) {
    const hits = matchBills(s.billSpoken, pend);
    if (hits.length === 1) { s.party = hits[0].party_id; s.invoice = hits[0].id; }
    else if (hits.length > 1) { delete s.billSpoken; st.awaiting = 'party'; return R(st, 'That bill number exists for more than one ' + F.who + '. Please say the ' + F.who + ' name.', listView(D, F.kind)); }
    else { const bad = s.billSpoken; delete s.billSpoken; st.awaiting = 'party'; return R(st, 'I could not find a pending bill ' + bad + '. Please say the ' + F.who + ' name and bill number.', listView(D, F.kind)); }
  }
  if (!s.party) {
    st.awaiting = 'party';
    const v = listView(D, F.kind);
    if (!v.rows.length) return R(idle({awaiting: 'more'}), 'There are no pending ' + (F.sale ? 'sales invoices' : 'purchase bills') + '. Anything else required?', {t: 'info', text: 'No pending bills'});
    return R(st, (F.sale ? 'Receipt against which customer and invoice?' : 'Payment against which bill of which vendor?') + ' Please say the ' + F.who + ' name, bill number, amount and date of ' + (F.sale ? 'receipt' : 'payment') + '.', v);
  }
  const mine = pend.filter(x => x.party_id === s.party), pn = pname(D, s.party);
  if (!mine.length) { const v = listView(D, F.kind); delete s.party; delete s.billSpoken; delete s.invoice; st.awaiting = 'party'; return R(st, pn + ' has no pending ' + (F.sale ? 'invoices' : 'bills') + '. Please say another ' + F.who + '.', v); }
  if (!s.invoice) {
    if (s.billSpoken) {
      const hits = matchBills(s.billSpoken, mine);
      if (hits.length === 1) s.invoice = hits[0].id;
      else if (hits.length > 1) { st.awaiting = 'choose'; st.chooseKind = 'bill'; st.options = hits.slice(0, 4).map(x => ({id: x.id, name: x.number + ' dated ' + niceDate(x.date) + ', pending ' + inrWords(x.pend)})); return R(st, 'More than one bill matches. Which one? ' + st.options.map((o, i) => (i + 1) + ', ' + o.name).join('; ') + '.', {t: 'choose', options: st.options}); }
      else { const bad = s.billSpoken; delete s.billSpoken; st.awaiting = 'bill'; return R(st, 'I could not find bill ' + bad + ' for ' + pn + '. Pending ' + (F.sale ? 'invoices' : 'bills') + ' are ' + readBills(mine) + '. Which one?', listView(D, F.kind, s.party)); }
    } else if (mine.length === 1) { s.invoice = mine[0].id; st.autoBill = true; }
    else { st.awaiting = 'bill'; return R(st, 'Pending ' + (F.sale ? 'invoices' : 'bills') + ' of ' + pn + ' are ' + readBills(mine) + '. Against which bill number?', listView(D, F.kind, s.party)); }
  }
  const inv = mine.find(x => x.id === s.invoice) || pend.find(x => x.id === s.invoice);
  if (!inv) { delete s.invoice; delete s.billSpoken; return advance(st, D, F); }
  /* 2. amount */
  if (s.full) { s.amount = inv.pend; delete s.full; }
  if (s.amount == null) { st.awaiting = 'amount'; return R(st, 'Bill ' + inv.number + ' has ' + inrWords(inv.pend) + ' rupees pending. What amount? You can say full.', listView(D, F.kind, s.party)); }
  if (!(s.amount > 0)) { delete s.amount; st.awaiting = 'amount'; return R(st, 'The amount must be more than zero. What amount?'); }
  if (Math.round(s.amount * 100) > Math.round(inv.pend * 100)) { const a = s.amount; delete s.amount; st.awaiting = 'amount'; return R(st, inrWords(a) + ' is more than the pending ' + inrWords(inv.pend) + ' rupees on bill ' + inv.number + '. Please say the amount again.', listView(D, F.kind, s.party)); }
  /* 3. date */
  if (!s.date) { st.awaiting = 'date'; return R(st, 'On which date was it ' + (F.sale ? 'received' : 'paid') + '? Say today, or a date.'); }
  /* 4. account */
  const accts = D.accounts || [];
  if (!s.account) {
    if (accts.length === 1) s.account = accts[0].id;
    else if (accts.length > 1 && D.defaultAccount && accts.some(a => a.id === D.defaultAccount)) s.account = D.defaultAccount;
    else if (accts.length > 1) { st.awaiting = 'account'; return R(st, (F.sale ? 'Deposit into which account? ' : 'Pay from which account? ') + accts.slice(0, 5).map(a => a.name).join(', ') + '.', {t: 'accounts', rows: accts.map(a => a.name)}); }
  }
  if (st.awaiting === 'account' && !accts.some(a => a.id === s.account)) return R(st, 'Sorry, which account? ' + accts.slice(0, 5).map(a => a.name).join(', ') + '.');
  /* 5. confirm */
  st.awaiting = 'confirm';
  const an = (accts.find(a => a.id === s.account) || {}).name;
  const lines = [[F.Who, pn], ['Bill', inv.number + ' (dated ' + niceDate(inv.date) + ')'], ['Amount', '₹' + inrWords(s.amount)], ['Date', niceDate(s.date)]];
  if (an) lines.push([F.sale ? 'Deposit into' : 'Pay from', an]);
  lines.push(['Pending after', '₹' + inrWords(Math.round((inv.pend - s.amount) * 100) / 100)]);
  const say = 'Please confirm. ' + F.verb + ' of ' + inrWords(s.amount) + ' rupees ' + (F.sale ? 'from ' : 'to ') + pn + ', against bill ' + inv.number + ', on ' + niceDate(s.date) + (an ? (F.sale ? ', into ' : ', from ') + an : '') + '. Say yes to post, or no to cancel.';
  return R(st, say, {t: 'confirm', lines, title: 'Confirm ' + F.verb.toLowerCase()});
}
const readBills = list => list.slice(0, 4).map(x => 'bill ' + x.number + ' for ' + inrWords(x.pend) + ' rupees').join(', ') + (list.length > 4 ? ', and ' + (list.length - 4) + ' more' : '');

function afterPost(st, a) {
  const say = 'Done. ' + (a.sale ? 'Receipt' : 'Payment') + ' of ' + inrWords(a.amount) + ' rupees ' + (a.sale ? 'from ' : 'to ') + a.party + ' posted. Anything else required?';
  return R(idle({awaiting: 'more'}), say, {t: 'done', text: (a.sale ? 'Receipt' : 'Payment') + ' of ₹' + inrWords(a.amount) + ' ' + (a.sale ? 'from ' : 'to ') + a.party + ' posted against bill ' + a.number});
}

/* ---------- statements ---------- */
function period(t, today) {
  let m;
  const ds = []; let rest = t, d;
  while ((d = parseDate(rest, today)).iso && ds.length < 2) { ds.push(d.iso); rest = d.rest; }
  if (ds.length === 2 && /\bfrom\b|\bto\b|\btill\b/.test(t)) { ds.sort(); return {from: ds[0], to: ds[1], label: niceDate(ds[0]) + ' to ' + niceDate(ds[1])}; }
  if (/\b(last month|previous month)\b/.test(t)) { const y = +today.slice(0, 4), mo = +today.slice(5, 7), py = mo === 1 ? y - 1 : y, pm = mo === 1 ? 12 : mo - 1; return {from: iso(py, pm, 1), to: iso(py, pm, new Date(py, pm, 0).getDate()), label: 'last month'}; }
  if (/\bthis month\b/.test(t)) return {from: today.slice(0, 8) + '01', to: today, label: 'this month'};
  if (/\b(last financial year|last year|previous year)\b/.test(t)) { const fs = fyStart(today), y = +fs.slice(0, 4) - 1; return {from: y + '-04-01', to: (y + 1) + '-03-31', label: 'last financial year'}; }
  if (/\b(all|full|complete|till date|till now|from beginning|entire|since start)\b/.test(t)) return {from: '', to: today, label: 'all dates till today'};
  if (/\b(this financial year|this year|current year|financial year)\b/.test(t)) return {from: fyStart(today), to: today, label: 'this financial year'};
  return null;
}
const phoneOf = p => {
  let d = String(p || '').replace(/\D/g, ''); if (!d) return '';
  d = d.replace(/^00/, '');
  if (d.length === 10 && /^[6-9]/.test(d)) return '91' + d;
  if (d.length === 11 && /^0[6-9]/.test(d)) return '91' + d.slice(1);
  if (d.length === 12 && /^91[6-9]/.test(d)) return d;
  return d.length >= 11 && !/^0/.test(d) && !/^91/.test(d) ? d : '';   /* landlines and unknown shapes cannot take WhatsApp */
};
function stmtStep(st, t, D, first) {
  const s = st.slots;
  if (st.awaiting === 'choose') {
    const opts = st.options || [], m = /\b(\d)\b/.exec(t) || /\b(first|second|third|one|two|three)\b/.exec(t), ow = {first: 1, one: 1, second: 2, two: 2, third: 3, three: 3};
    let pick = m ? opts[(isNaN(m[1]) ? ow[m[1]] : +m[1]) - 1] : null;
    if (!pick) { const h = opts.map(o => ({o, sc: partyScore(o.name, t)})).sort((a, b) => b.sc - a.sc)[0]; if (h && h.sc >= .75) pick = h.o; }
    if (!pick) return R(st, 'Please say one of: ' + opts.map((o, i) => (i + 1) + ', ' + o.name).join('; ') + '.', {t: 'choose', options: opts});
    s.party = pick.id; st.options = null; st.awaiting = null;
  } else if (st.awaiting === 'confirm' && isYes(t)) {
    const p = D.parties.find(x => x.id === s.party), ph = phoneOf(p.phone);
    return R(st, 'Opening WhatsApp.', null, {act: {type: 'whatsapp', party: p.id, name: p.name, phone: ph, from: s.from, to: s.to, label: s.label}, listen: false});
  } else {
    const pr = period(t, D.today); if (pr) { s.from = pr.from; s.to = pr.to; s.label = pr.label; if (st.awaiting === 'confirm') st.awaiting = null; }
    const pool = D.parties.filter(p => !s.kind || p.kind === s.kind);
    if (!s.party || st.awaiting === 'party' || st.awaiting === 'confirm') {
      const hits = findParties(pool, t.replace(/\b(statement|ledger|share|send|whatsapp|customer|client|supplier|vendor|to|of|for)\b/g, ' '));
      if (hits.length) {
        const top = hits[0], close = hits.filter(h => top.s - h.s < .1 && h.p.id !== top.p.id);
        if (close.length && top.s < .98) { st.options = [top, ...close].slice(0, 4).map(h => ({id: h.p.id, name: h.p.name})); st.awaiting = 'choose'; return R(st, 'More than one match. Which one? ' + st.options.map((o, i) => (i + 1) + ', ' + o.name).join('; ') + '.', {t: 'choose', options: st.options}); }
        if (top.p.id !== s.party) { s.party = top.p.id; if (st.awaiting === 'confirm') st.awaiting = null; }
      } else if (st.awaiting === 'party') return R(st, 'I could not find that ' + (s.kind === 'supplier' ? 'supplier' : s.kind === 'client' ? 'customer' : 'party') + '. Please say the name again.');
    }
  }
  if (!s.party) { st.awaiting = 'party'; return R(st, 'Statement of which ' + (s.kind === 'supplier' ? 'supplier' : s.kind === 'client' ? 'customer' : 'customer or supplier') + '? Please say the name.', {t: 'info', text: 'Say the ' + (s.kind === 'supplier' ? 'supplier' : 'customer') + ' name'}); }
  if (s.from === undefined) { s.from = fyStart(D.today); s.to = D.today; s.label = 'this financial year'; }
  const p = D.parties.find(x => x.id === s.party), ph = phoneOf(p.phone);
  if (!ph) return R(idle({awaiting: 'more'}), 'There is no WhatsApp number saved for ' + p.name + '. Please add the phone number on the ' + (p.kind === 'client' ? 'customer' : 'supplier') + ' page. Anything else required?', {t: 'info', text: 'No phone number saved for ' + p.name});
  const info = D.stmtInfo ? D.stmtInfo(p, s.from, s.to) : {closing: 0};
  st.awaiting = 'confirm';
  const lines = [[p.kind === 'client' ? 'Customer' : 'Supplier', p.name], ['WhatsApp', '+' + ph], ['Period', s.label], ['Closing balance', '₹' + inrWords(info.closing)]];
  return R(st, 'Send ledger statement of ' + p.name + ' for ' + s.label + ', closing balance ' + inrWords(info.closing) + ' rupees, on WhatsApp? Say yes to send, or say a different period.', {t: 'confirm', lines, title: 'Confirm WhatsApp statement'});
}

const api = {wake, tokSim, step, afterPost, norm, digitize, parseDate, takeBill, takeAmount, matchBills, partyScore, findParties, phoneOf, period, niceDate, inrWords, isYes, isNo, pending, fyStart, addDays, FLOW, HELP};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VoiceCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
