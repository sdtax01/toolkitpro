// Run: node tests/phase1.test.js   (no dependencies)
const assert=require('assert'),fs=require('fs'),path=require('path');
const TP=require('../assets/reports-lib.js');
let n=0;const t=(name,fn)=>{fn();n++;console.log('PASS',name)};

// ---- helpers lifted from assets/app.js (so the real code is tested, not a copy) ----
const src=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const pick=re=>{const m=src.match(re);assert(m,'missing '+re);return m[0]};
new Function(pick(/const paise=[^\n]*/)+';'+pick(/const stCode=[^\n]*/)+';'+pick(/const isInter=[^\n]*/)+';'+pick(/const gst=[^\n]*/)+';this.paise=paise;this.gst=gst;this.rup=rup;').call(global=this);
const {paise,gst,rup}=this;

t('paise rounds half-up and survives float noise',()=>{assert.strictEqual(paise(1.005),101);assert.strictEqual(paise(0.1+0.2),30);assert.strictEqual(paise(-2.5),-250);assert.strictEqual(paise('10.10'),1010);assert.strictEqual(paise(null),0)});
t('GST: CGST always equals SGST (each half rounded to the paisa) and the total is within 1 paisa of rate x value',()=>{for(const rate of [3,5,12,18,28,40])for(let c=1;c<=2000;c++){const tv=c/100,g=gst(tv,rate,{state:'MH'},{state:'MH'});assert.strictEqual(paise(g.cgst),paise(g.sgst),tv+'@'+rate);assert.strictEqual(paise(g.cgst),Math.round(paise(tv)*rate/200+1e-9),tv+'@'+rate);assert(Math.abs(paise(g.cgst)+paise(g.sgst)-paise(tv)*rate/100)<=1.0001,tv+'@'+rate)}});
t('GST: inter-state gives IGST only',()=>{const g=gst(1000,18,{state:'MH'},{state:'KA'});assert.deepStrictEqual(g,{cgst:0,sgst:0,igst:180})});

const D=(n,d)=>TP.addDays(d,n);
const parties=[{id:'p1',name:'Alpha',kind:'client',email:'a@x.in'},{id:'p2',name:'Beta',kind:'client'},{id:'s1',name:'Supp',kind:'supplier'}];
const inv=(id,party,kind,number,date,due,amount,paid)=>({id,party_id:party,kind,number,date,due_date:due,amount,paid});
const today='2026-10-24';
const invoices=[
 inv('i1','p1','sale','INV-1','2026-05-01',D(-100,today),1000,0),      // 100 days overdue
 inv('i2','p1','sale','INV-2','2026-09-01',D(-10,today),500,200),      // 10 overdue, balance 300
 inv('i3','p1','sale','INV-3','2026-10-20',D(15,today),700,0),         // not yet due
 inv('i4','p2','sale','INV-4','2026-08-01',null,100,0),                // no due date -> uses invoice date (84 days)
 inv('i5','p2','sale','INV-5','2026-08-01',D(-1,today),250,250),       // fully paid -> excluded
 inv('i6','s1','purchase','BILL-1','2026-09-01',D(-35,today),900,0)];
t('ageing buckets, totals and exclusions',()=>{const A=TP.ageing(invoices,parties,'sale',today);
 assert.strictEqual(A.totals.total,2100);assert.strictEqual(A.totals.cur,700);assert.strictEqual(A.totals.b1,300);assert.strictEqual(A.totals.b3,100);assert.strictEqual(A.totals.b4,1000);
 assert.strictEqual(A.overdue,1400);assert.strictEqual(A.count,4);assert.strictEqual(A.noDue,1);
 assert.deepStrictEqual(A.rows.map(r=>r.name),['Alpha','Beta']);assert.strictEqual(A.rows[0].oldest,100);
 assert.strictEqual(A.rows.reduce((s,r)=>s+r.b.total,0),A.totals.total)});
t('ageing: creditors are separate and bucketed',()=>{const A=TP.ageing(invoices,parties,'purchase',today);assert.strictEqual(A.totals.b2,900);assert.strictEqual(A.rows.length,1)});
t('ageing: deleted contact does not crash',()=>{const A=TP.ageing(invoices,[],'sale',today);assert.strictEqual(A.rows[0].name,'(deleted contact)')});
t('ageing: paid more than total is ignored, not negative',()=>{const A=TP.ageing([inv('x','p1','sale','X','2026-01-01',null,100,100.004)],parties,'sale',today);assert.strictEqual(A.rows.length,0)});
t('ageing: decimal money sums exactly',()=>{const l=[];for(let k=0;k<10;k++)l.push(inv('d'+k,'p1','sale','D'+k,today,today,0.1,0));assert.strictEqual(TP.ageing(l,parties,'sale',today).totals.total,1)});

const txns=[{date:'2026-09-15',description:'Receipt INV-2',invoice_id:'i2',amount:200},{date:'2026-10-01',description:'Receipt INV-5',invoice_id:'i5',amount:250},{date:'2026-09-16',description:'unlinked',invoice_id:null,amount:99}];
t('statement: running balance, opening carry-forward and closing',()=>{
 const all=TP.statement(parties[0],invoices,txns);
 assert.deepStrictEqual(all.rows.map(r=>r.type),['Invoice','Invoice','Payment','Invoice']);
 assert.strictEqual(all.billed,2200);assert.strictEqual(all.paid,200);assert.strictEqual(all.closing,2000);assert.strictEqual(all.rows.at(-1).balance,2000);
 const per=TP.statement(parties[0],invoices,txns,'2026-09-01','2026-09-30');
 assert.strictEqual(per.opening,1000);assert.strictEqual(per.closing,1300);assert.strictEqual(per.rows.length,2);
 assert.strictEqual(per.opening+per.billed-per.paid,per.closing)});
t('statement: unlinked receipts excluded; consistent data has no mismatches',()=>{const s=TP.statement(parties[0],invoices,txns);assert.strictEqual(s.mismatches.length,0);assert.strictEqual(s.closing,s.outstandingNow+0)});
t('statement: flags paid that differs from linked payments',()=>{const bad=invoices.map(x=>x.id==='i1'?{...x,paid:50}:x);const s=TP.statement(parties[0],bad,txns);assert.strictEqual(s.mismatches.length,1);assert.strictEqual(s.mismatches[0].number,'INV-1')});
t('statement: supplier uses bills',()=>{const s=TP.statement(parties[2],invoices,[]);assert.strictEqual(s.closing,900)});

const accounts=[{id:'a1',name:'HDFC',opening:1000}];
const tx=[{date:'2026-10-24',type:'income',amount:500,account_id:'a1'},{date:'2026-10-24',type:'expense',amount:120.5,account_id:'a1'},{date:'2026-10-02',type:'income',amount:100,account_id:null},{date:'2026-10-25',type:'income',amount:9999,account_id:'a1'}];
t('daily summary: day, month-to-date, balances as of date',()=>{const d=TP.daily(today,tx,accounts,invoices,parties,[{title:'GST',due_date:'2026-10-26',done:false},{title:'old',due_date:'2026-10-01',done:true}]);
 assert.strictEqual(d.income,500);assert.strictEqual(d.expense,120.5);assert.strictEqual(d.net,379.5);assert.strictEqual(d.mtdIncome,600);
 assert.strictEqual(d.accounts[0].balance,1379.5);assert.strictEqual(d.unassigned,100);assert.strictEqual(d.cash,1479.5);
 assert.strictEqual(d.receivables.overdue,1400);assert.strictEqual(d.payables.overdue,900);assert.strictEqual(d.topDebtors[0].name,'Alpha');assert.strictEqual(d.reminders.length,1)});
t('daily: invoices dated after the chosen day are ignored',()=>{const d=TP.daily('2026-08-01',[],[],invoices,parties,[]);assert.strictEqual(d.receivables.overdue,1000)});

t('csv escapes quotes/commas/newlines and blocks formula injection',()=>{
 assert.strictEqual(TP.csv([['a,b','he said "hi"','x\ny',12.5,null]]),'"a,b","he said ""hi""","x\ny",12.5,');
 assert.strictEqual(TP.csv([['=HYPERLINK("x")','+1','@a','-5',-5]]),`"'=HYPERLINK(""x"")",'+1,'@a,'-5,-5`)});
t('fyStart picks the Indian financial year',()=>{assert.strictEqual(TP.fyStart('2026-10-24'),'2026-04-01');assert.strictEqual(TP.fyStart('2027-02-10'),'2026-04-01');assert.strictEqual(TP.fyStart('2026-03-31'),'2025-04-01')});
console.log('\n'+n+' tests passed');
