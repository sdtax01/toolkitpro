const T=require('../assets/reports-lib.js');let n=0,f=0;
const eq=(k,a,b)=>{n++;if(JSON.stringify(a)!==JSON.stringify(b)){f++;console.log('FAIL',k,JSON.stringify(a),'!=',JSON.stringify(b))}};
const A=[{id:'bank',code:'1010',name:'Bank',type:'asset'},{id:'rec',code:'1100',name:'Debtors',type:'asset'},{id:'pay',code:'2000',name:'Creditors',type:'liability'},{id:'gst',code:'2100',name:'GST payable',type:'liability'},{id:'cap',code:'3000',name:'Capital',type:'equity'},{id:'sal',code:'4000',name:'Sales',type:'income'},{id:'rent',code:'5000',name:'Rent',type:'expense'}];
const L=(d,a,dr,cr)=>({entry_date:d,gl_account_id:a,debit:dr,credit:cr});
const lines=[L('2025-03-10','bank',1000,0),L('2025-03-10','cap',0,1000), // prior year
 L('2025-03-20','rec',500,0),L('2025-03-20','sal',0,500),   // prior-year profit 500
 L('2025-05-01','rec',1180,0),L('2025-05-01','sal',0,1000),L('2025-05-01','gst',0,180),
 L('2025-06-01','rent',300,0),L('2025-06-01','bank',0,300)];
const tb=T.trialBalance(A,lines);eq('tb balanced',tb.balanced,true);
const pl=T.profitAndLoss(A,lines,'2025-04-01','2026-03-31');
eq('income',pl.totalIncome,1000);eq('expense',pl.totalExpense,300);eq('net',pl.netProfit,700);eq('not loss',pl.isLoss,false);
eq('pl excludes prior yr',T.profitAndLoss(A,lines,'2025-04-01','2025-04-30').totalIncome,0);
const bs=T.balanceSheet(A,lines,'2026-03-31');
eq('bs balances',bs.balanced,true);eq('prior profit',bs.priorProfit,500);eq('cur profit',bs.currentProfit,700);
eq('assets',bs.totalAssets,2380);eq('liab+eq',bs.totalLiabEquity,2380);
const bs2=T.balanceSheet(A,lines,'2025-03-31');eq('bs mid-history balances',bs2.balanced,true);eq('bs2 current',bs2.currentProfit,500);
eq('loss',T.profitAndLoss(A,[L('2025-05-01','rent',50,0),L('2025-05-01','bank',0,50)],'2025-04-01','2026-03-31').isLoss,true);
eq('paise exact',T.profitAndLoss(A,[L('2025-05-01','sal',0,0.1),L('2025-05-01','sal',0,0.2),L('2025-05-01','bank',0.3,0)],null,null).totalIncome,0.3);
// parse
let r=T.parseStatement('Date,Description,Debit,Credit\n03/05/2026,NEFT client,,"1,500.00"\n04-May-2026,ATM,100,\n2026-05-05,Bad,x,\nnotadate,Z,1,\n03/05/2026,NEFT client,,"1,500.00"');
eq('parsed 3',r.lines.length,3);eq('deposit +',r.lines[0].amount,1500);eq('withdrawal -',r.lines[1].amount,-100);eq('date formats',[r.lines[0].stmt_date,r.lines[1].stmt_date],['2026-05-03','2026-05-04']);
eq('errors reported',r.errors.length,2);eq('identical rows get distinct keys',r.lines[0].dedupe_key!==r.lines[2].dedupe_key,true);
eq('reimport same keys',T.parseStatement('Date,Description,Debit,Credit\n03/05/2026,NEFT client,,"1,500.00"').lines[0].dedupe_key,r.lines[0].dedupe_key);
r=T.parseStatement('Date,Narration,Amount\n01/04/26,A,-250.50\n02/04/26,B,(10)');eq('amount col',r.lines.map(x=>x.amount),[-250.5,-10]);
eq('missing cols',T.parseStatement('Foo,Bar\n1,2').errors.length,1);eq('empty',T.parseStatement('').errors.length,1);
eq('bad date 31 Feb',T.parseStatement('Date,Debit,Credit\n31/02/2026,1,').lines.length,0);
// match
const tx=[{id:'t1',type:'income',amount:500,date:'2026-05-02',account_id:'b'},{id:'t2',type:'expense',amount:100,date:'2026-05-04',account_id:'b'},{id:'t3',type:'income',amount:500,date:'2026-05-20',account_id:'b'}];
const sl=[{id:'s1',stmt_date:'2026-05-03',amount:500,account_id:'b'},{id:'s2',stmt_date:'2026-05-04',amount:-100,account_id:'b'},{id:'s3',stmt_date:'2026-05-05',amount:-77,account_id:'b'}];
const m=T.autoMatch(sl,tx);eq('2 pairs',m.pairs.map(p=>p.lineId+p.txnId).sort(),['s1t1','s2t2']);eq('unmatched line',m.unmatchedLines.map(x=>x.id),['s3']);eq('unmatched txn',m.unmatchedTxns.map(x=>x.id),['t3']);
eq('direction respected',T.autoMatch([{id:'x',stmt_date:'2026-05-02',amount:-500}],tx).pairs.length,0);
eq('window respected',T.autoMatch([{id:'x',stmt_date:'2026-05-02',amount:500}],[{id:'q',type:'income',amount:500,date:'2026-06-30'}]).pairs.length,0);
eq('txn used once',T.autoMatch([{id:'a',stmt_date:'2026-05-02',amount:500},{id:'b',stmt_date:'2026-05-02',amount:500}],[tx[0]]).pairs.length,1);
// bank rec: opening 1000; txns +500 (cleared), -300 (cheque not cleared), +200 (deposit in transit). bank has +500, ATM fee -10 not in books
const acct={id:'b',opening:1000},T2=[{id:'a',type:'income',amount:500,date:'2026-05-02',account_id:'b'},{id:'c',type:'expense',amount:300,date:'2026-05-03',account_id:'b'},{id:'d',type:'income',amount:200,date:'2026-05-30',account_id:'b'}];
const S2=[{id:'1',account_id:'b',stmt_date:'2026-05-03',amount:500,matched_txn_id:'a'},{id:'2',account_id:'b',stmt_date:'2026-05-10',amount:-10,matched_txn_id:null}];
let br=T.bankRec(acct,T2,S2,1490,'2026-05-31');
eq('book',br.bookBalance,1400);eq('adjusted=book',br.adjustedBalance,1400);eq('reconciled',br.reconciled,true);eq('lists',[br.depositsNotInBank.length,br.paymentsNotInBank.length,br.linesNotInBooks.length],[1,1,1]);
const T3=[{id:'x',type:'expense',amount:50,date:'2026-06-02',account_id:'b'}],S3=[{id:'9',account_id:'b',stmt_date:'2026-05-31',amount:-50,matched_txn_id:'x'}];
eq('match straddling the cutoff still reconciles',T.bankRec({id:'b',opening:100},T3,S3,50,'2026-05-31').reconciled,true);
eq('Dr suffix is money out',T.parseStatement('Date,Description,Amount\n01/04/26,A,500.00 Dr\n02/04/26,B,10 Cr').lines.map(x=>x.amount),[-500,10]);
eq('wrong stmt balance flagged',T.bankRec(acct,T2,S2,1500,'2026-05-31').reconciled,false);eq('diff',T.bankRec(acct,T2,S2,1500,'2026-05-31').difference,10);

// real-database cross-check (optional): node tests/phase3.test.js ledger_dump.json
if(process.argv[2]){const D=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8')),lines=D.lines.map(l=>({...l,debit:+l.debit,credit:+l.credit})),dates=lines.map(l=>l.entry_date).sort(),last=dates[dates.length-1];
 const bs=T.balanceSheet(D.accts,lines,last),tb=T.trialBalance(D.accts,lines,last),pl=T.profitAndLoss(D.accts,lines,null,last);
 eq('REAL: balance sheet balances',bs.balanced,true);eq('REAL: trial balance balances',tb.balanced,true);
 const inc=tb.rows.filter(r=>r.type==='income').reduce((x,r)=>x+r.credit-r.debit,0),exp=tb.rows.filter(r=>r.type==='expense').reduce((x,r)=>x+r.debit-r.credit,0);
 eq('REAL: P&L net = income - expense per trial balance',pl.netProfit,Math.round((inc-exp)*100)/100);
 eq('REAL: prior+current profit = all-time profit',Math.round((bs.priorProfit+bs.currentProfit)*100)/100,pl.netProfit);
 console.log('real-database cross-check done on '+lines.length+' lines, up to '+last);}
console.log(f?f+' FAILED of '+n:'phase3: all '+n+' tests passed');process.exit(f?1:0);
