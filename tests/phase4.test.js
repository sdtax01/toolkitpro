const T=require('../assets/reports-lib.js');let n=0,f=0;
const eq=(k,a,b)=>{n++;if(JSON.stringify(a)!==JSON.stringify(b)){f++;console.log('FAIL',k,JSON.stringify(a),'!=',JSON.stringify(b))}};
const A=[{id:'bank',code:'1020',name:'HDFC',type:'asset',bank_account_id:'b1'},{id:'rec',code:'1100',name:'Debtors',type:'asset',system_key:'receivables'},
 {id:'ig',code:'1230',name:'Input IGST',type:'asset',system_key:'input_igst'},{id:'inv',code:'1300',name:'Inventory',type:'asset',system_key:'inventory'},
 {id:'fa',code:'1500',name:'Fixed assets',type:'asset',system_key:'fixed_assets'},{id:'ad',code:'1590',name:'Acc dep',type:'asset',system_key:'acc_dep'},
 {id:'pay',code:'2100',name:'Creditors',type:'liability',system_key:'payables'},{id:'og',code:'2230',name:'Output IGST',type:'liability',system_key:'output_igst'},
 {id:'loan',code:'2600',name:'Bank loan',type:'liability'},{id:'cap',code:'3000',name:'Capital',type:'equity',system_key:'capital'},{id:'drw',code:'3200',name:'Drawings',type:'equity',system_key:'drawings'},
 {id:'sal',code:'4100',name:'Sales',type:'income',system_key:'sales'},{id:'sw',code:'4101',name:'Software sales',type:'income',parent_id:'sal'},{id:'oi',code:'4900',name:'Other income',type:'income',system_key:'other_income'},
 {id:'pur',code:'5100',name:'Purchases',type:'expense',system_key:'purchases'},{id:'adj',code:'5150',name:'Change in inventories',type:'expense',system_key:'stock_adjust'},
 {id:'dep',code:'5190',name:'Depreciation',type:'expense',system_key:'depreciation'},{id:'rent',code:'5200',name:'Rent',type:'expense'}];
const L=(d,a,dr,cr)=>({entry_date:d,gl_account_id:a,debit:dr,credit:cr});
const lines=[
 // prior year: capital 100000 in bank, a machine bought for 40000, bought stock 10000 on credit, closing stock 10000
 L('2025-04-05','bank',100000,0),L('2025-04-05','cap',0,100000),
 L('2025-05-01','fa',40000,0),L('2025-05-01','bank',0,40000),
 L('2025-06-01','pur',10000,0),L('2025-06-01','pay',0,10000),
 L('2026-03-31','inv',10000,0),L('2026-03-31','adj',0,10000),
 L('2026-03-31','dep',4000,0),L('2026-03-31','ad',0,4000),
 // this year: sales on credit with IGST, purchase, rent, loan, owner drawings, new machine, stock change
 L('2026-04-10','rec',11800,0),L('2026-04-10','sw',0,10000),L('2026-04-10','og',0,1800),
 L('2026-05-01','bank',5000,0),L('2026-05-01','rec',0,5000),
 L('2026-05-10','pur',3000,0),L('2026-05-10','ig',540,0),L('2026-05-10','pay',0,3540),
 L('2026-06-01','rent',1000,0),L('2026-06-01','bank',0,1000),
 L('2026-06-15','bank',20000,0),L('2026-06-15','loan',0,20000),
 L('2026-07-01','drw',2000,0),L('2026-07-01','bank',0,2000),
 L('2026-08-01','fa',15000,0),L('2026-08-01','bank',0,15000),
 L('2026-09-30','inv',2000,0),L('2026-09-30','adj',0,2000),
 L('2026-10-01','pay',3540,0),L('2026-10-01','bank',0,3540)];
const R=T.finStatements(A,lines,'2026-04-01','2026-10-31'),b=R.balanceSheet,pl=R.profitAndLoss,cf=R.cashFlow;
eq('trial balance balances',T.trialBalance(A,lines).balanced,true);
eq('balance sheet balances',b.balanced,true);
eq('PPE net = 40000-4000+15000',b.assets.nonCurrent[0].total,51000);
eq('inventory 12000',b.assets.current[0].total,12000);
eq('receivables 6800',b.assets.current[1].total,6800);
eq('cash = 100000-40000-1000+5000-... ',b.assets.current[2].total,100000-40000+5000-1000+20000-2000-15000-3540);
eq('other current assets (input IGST)',b.assets.current[3].total,540);
eq('non-current liability (loan 2600+)',b.equityAndLiabilities.nonCurrentLiabilities.total,20000);
eq('current liabilities: creditors 10000 + GST 1800',b.equityAndLiabilities.totalCurrent,11800);
eq('equity = capital - drawings + profits',b.equityAndLiabilities.equity.total,100000-2000+b.priorProfit+b.currentProfit);
eq('revenue is Sales incl. sub-account',pl.revenue.total,10000);
eq('materials = purchases',pl.materials.total,3000);
eq('inventory change is a credit to expenses',pl.inventoryChange.total,-2000);
eq('depreciation line zero this period',pl.depreciation.total,0);
eq('PBT = 10000-3000+2000-1000',pl.profitBeforeTax,8000);
eq('prior-year PBT = -10000+10000-4000',R.profitAndLossPrior.profitBeforeTax,-4000);
eq('cash flow agrees with change in cash',cf.agrees,true);
eq('operating = profit 8000 less working capital 7540',cf.operating,460);
eq('investing = new machine',cf.investing,-15000);
eq('financing = loan 20000 less drawings 2000',cf.financing,18000);
eq('net change',cf.netChange,3460);eq('opening cash',cf.openingCash,60000);eq('closing cash',cf.closingCash,63460);
// depreciation add-back and the investing split in a year that charges depreciation
const R2=T.finStatements(A,lines,'2025-04-01','2026-03-31');
eq('FY1: cash flow agrees',R2.cashFlow.agrees,true);eq('FY1: depreciation added back',R2.cashFlow.depreciationAddBack,4000);
eq('FY1: investing = machine purchase only',R2.cashFlow.investing,-40000);eq('FY1: balance sheet balances',R2.balanceSheet.balanced,true);
eq('FY1: profit before tax',R2.profitAndLoss.profitBeforeTax,-4000);
// every period balances, even odd ones
for(const [a,z] of [['2026-04-01','2026-04-30'],['2026-06-01','2026-06-30'],['2025-04-01','2026-10-31']]){const r=T.finStatements(A,lines,a,z);eq('agrees '+a+'..'+z,r.cashFlow.agrees,true);eq('bs '+z,r.balanceSheet.balanced,true)}
// real-database cross-check (optional): node tests/phase4.test.js ledger_dump.json
if(process.argv[2]){const D=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8')),ls=D.lines.map(l=>({...l,debit:+l.debit,credit:+l.credit})),ds=ls.map(l=>l.entry_date).sort(),first=ds[0],last=ds[ds.length-1];
 const r=T.finStatements(D.accts,ls,first,last);
 eq('REAL: balance sheet balances',r.balanceSheet.balanced,true);eq('REAL: cash flow agrees with change in cash',r.cashFlow.agrees,true);
 eq('REAL: P&L profit equals classic P&L',r.profitAndLoss.profitBeforeTax,T.profitAndLoss(D.accts,ls,first,last).netProfit);
 eq('REAL: total assets equal classic balance sheet',r.balanceSheet.assets.total,T.balanceSheet(D.accts,ls,last).totalAssets);
 console.log('real-database cross-check done on '+ls.length+' lines');}
console.log(f?f+' FAILED of '+n:'phase4: all '+n+' tests passed');process.exit(f?1:0);
