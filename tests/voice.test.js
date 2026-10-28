// Voice assistant brain tests (no install needed): node tests/voice.test.js
const V = require('../assets/voice-core.js');
let bad = 0; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); if (!c) bad++; };
const TODAY = '2026-10-28';
const parties = [
  {id: 's1', name: 'Sharma Traders', kind: 'supplier', phone: '98220 12345'},
  {id: 's2', name: 'Sharda Enterprises', kind: 'supplier', phone: ''},
  {id: 's3', name: 'Five Star Logistics Pvt Ltd', kind: 'supplier', phone: '+91 9811122233'},
  {id: 'c1', name: 'Patil Computers', kind: 'client', phone: '9890011223'},
  {id: 'c2', name: 'Gupta & Sons', kind: 'client', phone: '020-2567890'},
  {id: 'c3', name: 'Patel Computers', kind: 'client', phone: '9000000000'}
];
const invoices = [
  {id: 'i1', party_id: 's1', kind: 'purchase', number: 'PB-0245', date: '2026-09-10', amount: 50000, paid: 10000, adjusted: 0},
  {id: 'i2', party_id: 's1', kind: 'purchase', number: 'PB-0251', date: '2026-10-01', amount: 20000, paid: 0, adjusted: 0},
  {id: 'i3', party_id: 's2', kind: 'purchase', number: 'PB-0245', date: '2026-10-02', amount: 7000, paid: 0, adjusted: 0},
  {id: 'i4', party_id: 's3', kind: 'purchase', number: 'FS/77', date: '2026-10-05', amount: 90000, paid: 0, adjusted: 0},
  {id: 'i5', party_id: 's3', kind: 'purchase', number: 'FS/60', date: '2026-08-05', amount: 5000, paid: 5000, adjusted: 0},
  {id: 'i6', party_id: 'c1', kind: 'sale', number: 'INV-101', date: '2026-10-03', amount: 118000, paid: 0, adjusted: 0}
];
const accounts = [{id: 'a1', name: 'HDFC Current'}, {id: 'a2', name: 'Cash in Hand'}];
const D = (o) => Object.assign({parties, invoices, accounts, today: TODAY, defaultAccount: null, stmtInfo: () => ({closing: 98765.5})}, o || {});

// ---- number words, dates, bill parsing
ok(V.digitize('twelve thousand five hundred') === '12500', 'words to number: 12500', V.digitize('twelve thousand five hundred'));
ok(V.digitize('one lakh twenty five thousand') === '125000', 'lakh words: 125000');
ok(V.digitize('1.5 lakh') === '150000', '1.5 lakh');
ok(V.digitize('rupees 12,000') === 'rs 12000' || V.digitize('rupees 12,000') === 'rupees 12000', 'commas removed', V.digitize('rupees 12,000'));
ok(V.digitize('two four five') === '245', 'digit by digit: two four five = 245', V.digitize('two four five'));
ok(V.digitize('1,23,456') === '123456', 'indian commas');
const dp = s => V.parseDate(V.norm(s), TODAY).iso;
ok(dp('25 october 2026') === '2026-10-25', 'date 25 october 2026', dp('25 october 2026'));
ok(dp('twenty fifth october') === '2026-10-25', 'date twenty fifth october', dp('twenty fifth october'));
ok(dp('october 5th') === '2026-10-05', 'date october 5th');
ok(dp('25/10/2026') === '2026-10-25', 'date 25/10/2026');
ok(dp('5-10') === '2026-10-05', 'date 5-10 (dd-mm)');
ok(dp('yesterday') === '2026-10-27' && dp('today') === TODAY, 'yesterday/today');
ok(dp('15 december') === '2025-12-15', 'future month without year goes to last year', dp('15 december'));
ok(dp('31 february 2026') === null, 'invalid date rejected');
ok(V.takeBill(V.norm('bill number inv 245 amount 12000')).bill === 'inv 245', 'bill "inv 245"', V.takeBill(V.norm('bill number inv 245 amount 12000')));
ok(V.takeBill(V.norm('invoice two four five on 25 october')).bill === '245', 'bill spoken digits', V.takeBill(V.norm('invoice two four five on 25 october')));
ok(V.matchBills('245', invoices.filter(x => x.party_id === 's1')).length === 1, 'bill 245 matches PB-0245 only');
ok(V.matchBills('pb 245', invoices).length === 2, 'same bill number at two vendors is ambiguous');
ok(V.matchBills('fs 77', invoices)[0].id === 'i4', 'FS/77 matched from "fs 77"');
ok(V.phoneOf('98220 12345') === '919822012345' && V.phoneOf('+91 9811122233') === '919811122233' && V.phoneOf('') === '' && V.phoneOf('020-2567890') === '' , 'phone normalising', [V.phoneOf('98220 12345'), V.phoneOf('020-2567890')]);

// ---- fuzzy party names
const sup = parties.filter(p => p.kind === 'supplier');
ok(V.findParties(sup, 'sarma traders')[0].p.id === 's1', 'mis-heard "sarma traders" -> Sharma Traders');
ok(V.findParties(sup, '5 star logistics')[0].p.id === 's3', '"5 star logistics" -> Five Star Logistics');
ok(V.findParties(sup, 'banana shop').length === 0, 'unknown name matches nothing');

// ---- full record payment conversation
let st = null, r;
r = V.step(st, 'record payment', D()); st = r.state;
ok(r.view.t === 'list' && r.view.rows.length === 4 && /which bill of which vendor/i.test(r.say), 'record payment shows pending bills list (4 rows) and asks', r.view && r.view.rows.length);
ok(!r.view.rows.some(x => x.number === 'FS/60'), 'fully paid bill is not listed');
r = V.step(st, 'Vendor Sharma Traders, bill number 245, amount 12,000, date 25 October 2026', D()); st = r.state;
ok(st.awaiting === 'account' && st.slots.invoice === 'i1' && st.slots.amount === 12000 && st.slots.date === '2026-10-25', 'full sentence fills vendor, bill, amount, date; then asks account', [st.awaiting, st.slots]);
r = V.step(st, 'from HDFC', D()); st = r.state;
ok(st.awaiting === 'confirm' && r.view.t === 'confirm' && /Please confirm/.test(r.say) && /yes to post/.test(r.say), 'then asks to confirm', r.say);
ok(r.view.lines.some(l => l[0] === 'Pending after' && l[1] === '₹28,000'), 'shows pending after = 28,000', r.view.lines);
let before = JSON.stringify(st);
r = V.step(st, 'yes', D());
ok(r.act && r.act.type === 'post' && r.act.invoice === 'i1' && r.act.amount === 12000 && r.act.date === '2026-10-25' && r.act.account === 'a1' && r.act.sale === false, 'yes -> post action with right values', r.act);
ok(r.act.description === 'Payment PB-0245 - Sharma Traders', 'description matches the manual screen format', r.act.description);
const dn = V.afterPost(r.state, r.act);
ok(/^Done\./.test(dn.say) && /Anything else required\?$/.test(dn.say) && dn.view.t === 'done', 'after post: Done + Anything else required?', dn.say);
r = V.step(dn.state, 'no that is all', D());
ok(r.close === true, 'no / that is all closes the assistant');

// confirm -> no cancels, nothing posted
st = V.step(null, 'record payment to sharma traders bill 251 amount 20000 date today from cash', D()).state;
ok(st.awaiting === 'confirm' && st.slots.invoice === 'i2' && st.slots.account === 'a2', 'one-shot: vendor+bill+amount+date+account all in one sentence', st);
r = V.step(st, 'no', D());
ok(!r.act && r.state.flow === null, 'no at confirm cancels, no post');
// correction at confirm
st = V.step(null, 'record payment to sharma traders bill 251 amount 20000 date today from cash', D()).state;
r = V.step(st, 'change amount to 15000', D());
ok(r.state.awaiting === 'confirm' && r.state.slots.amount === 15000 && /15,000/.test(r.say), 'correct amount at confirm re-confirms with new amount', r.say);
r = V.step(r.state, 'change date to 20 october', D());
ok(r.state.slots.date === '2026-10-20', 'correct date at confirm', r.state.slots.date);

// slot filling one item at a time
st = V.step(null, 'record payment', D()).state;
let rr = V.step(st, 'sharma traders', D()); st = rr.state;
ok(st.awaiting === 'bill' && /Against which bill number/.test(rr.say) && rr.view.rows.length === 2, 'vendor only -> lists vendor bills, asks bill', rr.say);
rr = V.step(st, 'invoice two five one', D()); st = rr.state;
ok(st.slots.invoice === 'i2' && st.awaiting === 'amount', 'spoken digits pick bill 251 -> asks amount', [st.slots, st.awaiting]);
rr = V.step(st, 'full amount', D()); st = rr.state;
ok(st.slots.amount === 20000 && st.awaiting === 'date', '"full amount" = pending 20,000 -> asks date', st.slots);
rr = V.step(st, 'twenty fifth october', D()); st = rr.state;
ok(st.slots.date === '2026-10-25' && st.awaiting === 'account', 'date by words, then account');
rr = V.step(st, 'cash', D()); st = rr.state;
ok(st.awaiting === 'confirm' && st.slots.account === 'a2', 'account by name');

// overpayment refused
st = V.step(null, 'record payment sharma traders bill 251 amount 25000', D()).state;
ok(st.awaiting === 'amount' && !st.slots.amount, 'amount above pending is refused and re-asked', st);

// default account skips the question; single pending bill auto-picked
r = V.step(null, 'record payment to five star logistics amount 90000 date today', D({defaultAccount: 'a1'}));
ok(r.state.awaiting === 'confirm' && r.state.slots.invoice === 'i4' && r.state.slots.account === 'a1', 'single pending bill auto-picked, default account used', r.state);
// one account only
r = V.step(null, 'record payment to five star logistics amount 90000 date today', D({accounts: [accounts[0]]}));
ok(r.state.awaiting === 'confirm' && r.state.slots.account === 'a1', 'only one bank account -> used without asking');

// vendor mis-heard
r = V.step(null, 'record payment to sarma traders bill 245 amount 5000 date today', D({defaultAccount: 'a1'}));
ok(r.state.slots.party === 's1' && r.state.awaiting === 'confirm', 'mis-heard vendor still found', r.state);
// ambiguous bill number across vendors, resolved by asking vendor
r = V.step(null, 'record payment bill 245', D());
ok(r.state.awaiting === 'party' && /more than one vendor/.test(r.say), 'bill 245 exists for 2 vendors -> asks vendor', r.say);
// unknown vendor
r = V.step(null, 'record payment to banana traders', D());
ok(/could not find/.test(r.say) && !r.state.slots.party, 'unknown vendor -> says so', r.say);
// ambiguous vendor names
r = V.step(null, 'record payment to shar', D());
ok(r.state.awaiting === 'choose' || r.state.slots.party, 'short ambiguous name does not crash', r.state.awaiting);
// unknown bill for vendor
r = V.step(null, 'record payment sharma traders bill 999', D());
ok(r.state.awaiting === 'bill' && /could not find bill 999/.test(r.say), 'unknown bill number -> says so', r.say);

// receipt flow
r = V.step(null, 'record receipt', D()); 
ok(r.state.flow === 'receipt' && r.view.rows.length === 1 && r.view.rows[0].number === 'INV-101', 'record receipt lists customer invoices');
r = V.step(r.state, 'patil computers amount full date today', D({defaultAccount: 'a1'}));
ok(r.state.awaiting === 'confirm' && r.state.slots.amount === 118000 && r.state.slots.invoice === 'i6', 'receipt: customer + full + date -> confirm', r.state);
r = V.step(r.state, 'yes confirm', D());
ok(r.act && r.act.sale === true && r.act.description === 'Receipt INV-101 - Patil Computers', 'receipt posts with Receipt description', r.act);
ok(/Receipt of 1,18,000 rupees from Patil Computers posted/.test(V.afterPost(r.state, r.act).say), 'receipt done message (Indian grouping)', V.afterPost(r.state, r.act).say);

// cancel mid-flow
st = V.step(null, 'record payment', D()).state;
r = V.step(st, 'cancel', D());
ok(r.state.flow === null && /Cancelled/.test(r.say), 'cancel mid-flow');

// navigation & misc
const nav = s => (V.step(null, s, D()).act || {}).href;
ok(nav('show me dashboard') === 'index.html', 'show me dashboard', nav('show me dashboard'));
ok(nav('open day book') === 'daybook.html', 'open day book');
ok(nav('show trial balance') === 'trial-balance.html', 'trial balance');
ok(nav('open profit and loss') === 'profit-loss.html', 'profit and loss');
ok(nav('show purchase bills') === 'invoices.html?kind=purchase', 'purchase bills', nav('show purchase bills'));
ok(nav('open settings') === 'settings.html#voice', 'settings');
r = V.step(null, 'how much does sharma traders outstanding', D());
ok(/You owe Sharma Traders 60,000 rupees/.test(r.say), 'outstanding of supplier', r.say);
r = V.step(null, 'outstanding of patil computers', D());
ok(/Patil Computers owes you 1,18,000/.test(r.say), 'outstanding of customer', r.say);
ok(/record payment/.test(V.step(null, 'help', D()).say), 'help lists commands');
ok(V.step(null, 'blah blah', D()).view.t === 'info', 'unknown command -> help, no crash');
ok(V.step(null, '', D()).say.includes('did not catch'), 'empty speech handled');

// statements
r = V.step(null, 'share ledger statement to customer patil computers', D());
ok(r.state.flow === 'stmt' && r.state.awaiting === 'confirm' && r.view.lines.some(l => l[0] === 'WhatsApp' && l[1] === '+919890011223'), 'customer statement -> confirm with saved WhatsApp number', r.view);
ok(r.state.slots.from === '2026-04-01' && r.state.slots.to === TODAY, 'default period = this financial year', r.state.slots);
let r2 = V.step(r.state, 'for last month', D());
ok(r2.state.slots.from === '2026-09-01' && r2.state.slots.to === '2026-09-30' && r2.state.awaiting === 'confirm', 'change period to last month', r2.state.slots);
r2 = V.step(r2.state, 'yes', D());
ok(r2.act && r2.act.type === 'whatsapp' && r2.act.phone === '919890011223' && r2.act.from === '2026-09-01', 'yes -> whatsapp action', r2.act);
r = V.step(null, 'share ledger statement to supplier sharma traders', D());
ok(r.state.slots.party === 's1' && r.state.awaiting === 'confirm', 'supplier statement');
r = V.step(null, 'share ledger statement to supplier sharda enterprises', D());
ok(/no WhatsApp number saved for Sharda/i.test(r.say) && !r.act, 'no phone saved -> tells you, nothing sent', r.say);
r = V.step(null, 'share ledger statement to customer', D());
ok(r.state.awaiting === 'party', 'statement without a name asks for it');
r2 = V.step(r.state, 'gupta and sons', D());
ok(/no WhatsApp number/.test(r2.say), 'landline-only customer -> no WhatsApp number message', r2.say);
r = V.step(null, 'send statement to customer patel computers', D());
ok(r.state.slots.party === 'c3', 'Patel vs Patil picked correctly by spelling');
r = V.step(null, 'share ledger statement to customer pati computers', D());
ok(r.state.awaiting === 'choose' || r.state.slots.party, 'near-identical names ask or pick, no crash', r.state.awaiting);

// wake phrase
const wk = (t, ph) => V.wake(t, ph);
ok(wk('hey buddy').hit && wk('Hey Buddy!').hit, 'wake: "hey buddy"');
ok(wk('hey body').hit && wk('hay buddy').hit && wk('hi buddy').hit && wk('okay buddy').hit, 'wake: common mis-hearings (hey body, hay buddy, hi buddy, okay buddy)');
ok(wk('hey buddy record payment').rest === 'record payment', 'wake: command spoken in the same breath is kept', wk('hey buddy record payment'));
ok(wk('so then he said hey buddy').hit, 'wake: phrase in the middle of a sentence');
ok(!wk('hello how are you').hit && !wk('buddy').hit && !wk('hey there').hit && !wk('record payment to sharma').hit, 'wake: ordinary speech does not wake it');
ok(wk('hey erp', 'hey erp').hit && !wk('hey buddy', 'hey erp').hit, 'wake: custom phrase');

console.log(bad ? '\n' + bad + ' FAILED' : '\nAll voice tests passed');
process.exit(bad ? 1 : 0);
