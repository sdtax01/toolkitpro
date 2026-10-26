// Run: node tests/phase2.test.js [ledger_dump.json]   (the dump is produced by tests/sql/phase2_test.sql with -v dump=/path)
const assert=require('assert'),fs=require('fs');
const TP=require('../assets/reports-lib.js');let n=0;const t=(name,fn)=>{fn();n++;console.log('PASS',name)};
const A=(id,code,name,type,extra={})=>({id,code,name,type,is_active:true,...extra});
const accts=[A('bank','1020','HDFC','asset',{bank_account_id:'b1'}),A('rec','1100','Receivable','asset',{system_key:'receivables'}),A('pay','2100','Payable','liability',{system_key:'payables'}),A('cash','1010','Cash','asset',{system_key:'cash'}),A('sales','4100','Sales','income',{system_key:'sales'}),A('rent','5200','Rent','expense'),A('eq','3100','Equity','equity',{system_key:'opening_equity'})];
let k=0;const L=(jn,date,acc,dr,cr,party)=>({id:'l'+(k++),journal_id:'j'+jn,journal_no:jn,entry_date:date,gl_account_id:acc,debit:dr,credit:cr,party_id:party||null,narration:'n'+jn});
const lines=[L(1,'2026-04-01','bank',10000,0),L(1,'2026-04-01','eq',0,10000),L(2,'2026-04-10','rec',1180,0,'p1'),L(2,'2026-04-10','sales',0,1000),L(2,'2026-04-10','eq',0,180),
 L(3,'2026-05-01','bank',500,0),L(3,'2026-05-01','rec',0,500,'p1'),L(4,'2026-05-03','rent',300,0),L(4,'2026-05-03','bank',0,300)];
t('trial balance: balances, sides and totals',()=>{const tb=TP.trialBalance(accts,lines);assert(tb.balanced);assert.strictEqual(tb.totalDebit,11180);
 const row=c=>tb.rows.find(r=>r.code===c);assert.strictEqual(row('1020').debit,10200);assert.strictEqual(row('4100').credit,1000);assert.strictEqual(row('1100').debit,680);assert.deepStrictEqual(tb.rows.map(r=>r.code),['1010','1020','1100','2100','3100','4100','5200'])});
t('trial balance as-on date excludes later entries',()=>{const tb=TP.trialBalance(accts,lines,'2026-04-30');assert.strictEqual(tb.rows.find(r=>r.code==='1020').debit,10000);assert(tb.balanced)});
t('trial balance flags an unbalanced set',()=>{const tb=TP.trialBalance(accts,lines.slice(0,1));assert(!tb.balanced);assert.strictEqual(tb.difference,10000)});
t('general ledger: opening carry-forward, running balance, sides',()=>{const g=TP.generalLedger(accts[0],lines,'2026-05-01','2026-05-31');
 assert.strictEqual(g.opening,10000);assert.strictEqual(g.rows.length,2);assert.strictEqual(g.closing,10200);assert.strictEqual(g.closingSide,'Dr');assert.strictEqual(g.opening+g.totalDebit-g.totalCredit,g.closing);
 const s=TP.generalLedger(accts[4],lines);assert.strictEqual(s.closing,1000);assert.strictEqual(s.closingSide,'Cr')});
t('day book groups lines per journal, in date order',()=>{const jr=[{id:'j2',journal_no:2,entry_date:'2026-04-10'},{id:'j1',journal_no:1,entry_date:'2026-04-01'}],d=TP.dayBook(jr,lines,accts,'2026-04-01','2026-04-30');
 assert.deepStrictEqual(d.map(x=>x.label),['JV-000001','JV-000002']);assert.strictEqual(d[1].lines.length,3);assert.strictEqual(d[1].total,1180);assert.strictEqual(TP.dayBook(jr,lines,accts,'2026-05-01').length,0)});
t('validateJournal catches every mistake',()=>{
 assert(TP.validateJournal([{account_id:'a',debit:10},{account_id:'b',credit:10}]).ok);
 assert(!TP.validateJournal([{account_id:'a',debit:10},{account_id:'b',credit:9.99}]).ok);
 assert(TP.validateJournal([{account_id:'a',debit:10}]).errors.some(e=>/two lines/.test(e)));
 assert(TP.validateJournal([{account_id:'a',debit:5,credit:5},{account_id:'b',credit:1}]).errors.some(e=>/not both/.test(e)));
 assert(TP.validateJournal([{debit:5},{account_id:'b',credit:5}]).errors.some(e=>/choose an account/.test(e)));
 assert(TP.validateJournal([{account_id:'a',debit:0.1},{account_id:'a',debit:0.2},{account_id:'b',credit:0.3}]).ok)});
t('reconcile: agrees when books and sub-ledgers match',()=>{
 const r=TP.reconcile({lines,accts,invoices:[{kind:'sale',party_id:'p1',amount:1180,paid:500}],txns:[{account_id:'b1',type:'expense',amount:300},{account_id:'b1',type:'income',amount:500}],bankAccounts:[{id:'b1',name:'HDFC',opening:10000}]});
 assert(r.allOk,JSON.stringify(r))});
t('reconcile: reports differences per control account and per party',()=>{
 const r=TP.reconcile({lines,accts,invoices:[{kind:'sale',party_id:'p1',amount:1180,paid:0}],txns:[],bankAccounts:[{id:'b1',name:'HDFC',opening:10000}]});
 assert(!r.allOk);assert.strictEqual(r.checks[0].diff,-500);assert.strictEqual(r.partyDifferences[0].party_id,'p1');assert(!r.checks.find(c=>/Bank/.test(c.name)).ok)});
if(process.argv[2]&&fs.existsSync(process.argv[2])){
 const D=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 t('REAL DATABASE DUMP: trial balance balances and equals the lines',()=>{const tb=TP.trialBalance(D.accts,D.lines);assert(tb.balanced,JSON.stringify(tb.difference));assert(D.lines.length>10);
  assert.strictEqual(TP.rup(tb.rows.reduce((s,r)=>s+TP.paise(r.movementDr),0)),TP.rup(D.lines.reduce((s,l)=>s+TP.paise(l.debit),0)));assert.strictEqual(tb.totalDebit,tb.totalCredit)});
 t('REAL DATABASE DUMP: ledger agrees with invoices, cash and parties',()=>{const r=TP.reconcile({lines:D.lines,accts:D.accts,invoices:D.invoices,txns:D.txns,bankAccounts:D.bankAccounts});assert(r.allOk,JSON.stringify(r,null,1))});
 t('REAL DATABASE DUMP: every general ledger closes to the trial balance',()=>{const tb=TP.trialBalance(D.accts,D.lines);for(const a of D.accts){const g=TP.generalLedger(a,D.lines),row=tb.rows.find(r=>r.id===a.id),signed=(a.type==='asset'||a.type==='expense'?g.closing:-g.closing)+0;assert.strictEqual(TP.rup(TP.paise(row.debit)-TP.paise(row.credit)),signed,a.code)}});
 t('REAL DATABASE DUMP: day book totals match line totals',()=>{const d=TP.dayBook(D.journals,D.lines,D.accts);assert.strictEqual(d.length,D.journals.length);d.forEach(j=>assert.strictEqual(j.total,TP.rup(j.lines.reduce((s,l)=>s+TP.paise(l.credit),0)),j.label))});
}else console.log('(skipped real-database cross-check: no dump file given)');
console.log('\n'+n+' tests passed');
