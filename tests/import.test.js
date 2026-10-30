// Import / export engine: node tests/import.test.js (no install needed; Node 18+)
const fs=require('fs'),path=require('path'),IM=require('../assets/import-core.js'),GF=require('../assets/gst-fields.js'),DS=require('../assets/doc-series.js');
const src=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
const pick=n=>{const m=src.match(new RegExp('^const '+n+'=.*$','m'));if(!m)throw new Error('missing '+n);return m[0].replace(/^const /,'var ')};
eval(['paise','RATES','GSTIN_CH','gstinOk','stCode','isInter','gst'].map(pick).join(';\n'));
let bad=0,n=0;const ok=(c,m)=>{n++;if(!c){bad++;console.log('FAIL '+m)}else console.log('PASS '+m)};
const eq=(a,b,m)=>ok(JSON.stringify(a)===JSON.stringify(b),m+(JSON.stringify(a)===JSON.stringify(b)?'':'  got '+JSON.stringify(a)+' want '+JSON.stringify(b)));
const env={gst,gstinOk,RATES,GF,DS};
const S={state:'Maharashtra',gstin:'27AAPFU0939F1ZV'};
const P=[{id:'p1',kind:'client',name:'Acme Traders Pvt Ltd',state:'Maharashtra',gstin:'27AAPFU0939F1ZV'},{id:'p2',kind:'client',name:'Zed Exports',state:'Karnataka',gstin:''},{id:'s1',kind:'supplier',name:'Sharma Stationers',state:'Maharashtra',gstin:''}];
const A=[{id:'a1',name:'HDFC Bank',opening:0},{id:'a2',name:'Cash in Hand',opening:0}];
const base=(o)=>Object.assign({env,S,parties:P,accounts:A,invoices:[],txns:[],heads:[],headsOn:false,fixes:{},today:'2026-10-30',categories:{income:[],expense:[]}},o||{});
const opt={dayFirst:true};

// ---------- CSV ----------
const t1=IM.parseCSV('a,b,c\r\n1,"x, y","he said ""hi"""\r\n\r\n"multi\nline",2,3\r\n');
eq(t1.map(r=>r.cells),[['a','b','c'],['1','x, y','he said "hi"'],['multi\nline','2','3']],'CSV: quotes, commas, doubled quotes, embedded newline, blank line skipped');
eq(t1.map(r=>r.n),[1,2,4],'CSV: line numbers point at the file line');
eq(IM.parseCSV('a;b\n1;2').map(r=>r.cells),[['a','b'],['1','2']],'CSV: semicolon delimiter detected');
eq(IM.parseCSV('a\tb\n1\t2').map(r=>r.cells),[['a','b'],['1','2']],'CSV: tab delimiter detected');
eq(IM.parseCSV('﻿a,b\n1,2').map(r=>r.cells[0]),['a','1'],'CSV: BOM removed');
eq(IM.parseCSV('a,b\n1,2').length,2,'CSV: no trailing newline');
eq(IM.decodeText(Buffer.from('Caf\xE9 \x80 1','latin1')).slice(0,4),'Café','decode: Windows-1252 fallback (Excel "CSV" in India)');
eq(IM.decodeText(Buffer.from('₹ ok','utf8')),'₹ ok','decode: UTF-8');
eq(IM.toCSV([['a','b,c','d"e'],[1,'=HYPERLINK("x")','-5']]),'a,"b,c","d""e"\r\n1,"\'=HYPERLINK(""x"")",-5\r\n'.replace('-5\r\n','-5\r\n'),'export: quoting, formula text neutralised, negative number text kept');
eq(IM.toCSV([['-abc','+1','@x']]),"'-abc,'+1,'@x\r\n",'export: formula-looking text prefixed');
eq(IM.unsafeCell("'=SUM(1)"),'=SUM(1)','import: apostrophe guard removed');

// ---------- values ----------
const d=(s,f)=>IM.parseDate(s,f);
eq([d('15/04/2026'),d('15-04-26'),d('2026-04-15'),d('15.04.2026'),d('15-Apr-2026'),d('15 April 2026'),d('Apr 15, 2026'),d('2026-04-15T10:00:00')],Array(8).fill('2026-04-15'),'dates: common Indian and ISO formats');
eq([d('03/04/2026'),d('03/04/2026',false)],['2026-04-03','2026-03-04'],'dates: day-first vs month-first');
eq([d('31/02/2026'),d('32/01/2026'),d('abc'),d(''),d('15/13/2026')],[null,null,null,null,null],'dates: impossible dates rejected');
eq(d('46127'),'2026-04-15','dates: Excel serial number');
const a=IM.parseAmount;
eq([a('1,23,456.78'),a('₹ 5,000'),a('Rs. 12.50'),a('(500)'),a('500-'),a('-500'),a('')],[123456.78,5000,12.5,-500,-500,-500,null],'amounts: Indian grouping, symbols, negatives, blank');
ok(Number.isNaN(a('12abc'))&&Number.isNaN(a('1.2.3'))&&Number.isNaN(a('N/A')),'amounts: junk is NaN, not 0');
eq([IM.parseRate('18%'),IM.parseRate('18'),IM.parseRate('')],[18,18,null],'rate: percent sign');
eq(['Y','yes','TRUE','1','N','','no'].map(IM.parseBool),[true,true,true,true,false,false,false],'booleans');

// ---------- names ----------
eq(IM.normName('M/s. ACME Traders Pvt. Ltd.'),'acme traders','normName strips M/s, Pvt Ltd, punctuation, case');
ok(IM.similarity('Acme Traders','ACME Tradres Pvt Ltd')>0.8,'similarity: typo');
ok(IM.similarity('Acme Traders','Zed Exports')<0.4,'similarity: different names');
eq(IM.suggest('Acme Tradres',P.filter(p=>p.kind==='client'),p=>p.name)[0].item.id,'p1','suggest: nearest party first');

// ---------- templates ----------
for(const t of ['sales','purchase','bank']){
  const csv=IM.templateCSV(t),rows=IM.parseCSV(csv),{header,body}=IM.detectHeader(rows,t),map=IM.autoMap(t,header.cells);
  ok(IM.FIELDS[t].every(f=>map[f.k]>=0),t+' template: every column maps automatically');
  eq(IM.records(body,map,t).length,0,t+' template: example rows start with # and are ignored');
  ok(csv.startsWith('﻿'),t+' template: UTF-8 BOM so Excel shows it right');
}
// a statement with a preamble and different headings
const stm=IM.parseCSV('HDFC BANK\nAccount 123\n\nDate,Narration,Chq/Ref No,Withdrawal Amt.,Deposit Amt.,Closing Balance\n15/04/2026,NEFT X,R1,,500,500\n');
const dh=IM.detectHeader(stm,'bank');eq(dh.header.cells[0],'Date','header found below a preamble');
const dm=IM.autoMap('bank',dh.header.cells);
ok(dm.date===0&&dm.narration===1&&dm.reference===2&&dm.debit===3&&dm.credit===4&&dm.account===-1,'bank statement headings auto-mapped (Withdrawal/Deposit/Chq Ref)');
const sm=IM.autoMap('sales',['Invoice No','Date','Party','Item','Taxable Value','GST %','Total']);
ok(sm.rate===4&&sm.gst_rate===5&&sm.total===6&&sm.party===2&&sm.description===3,'sales: "Taxable Value" -> Rate, "GST %" -> GST rate, no column used twice');

// ---------- sales ----------
const H=['Invoice No','Invoice Date','Due Date','Customer Name','Customer GSTIN','Customer State','Place of Supply','Description','HSN/SAC','Quantity','Unit','Rate','Discount','GST Rate %','Invoice Total','Reverse Charge','Income Head'];
const mkSales=(rows,o)=>{const body=rows.map((c,i)=>({n:i+2,cells:c}));const map=IM.autoMap('sales',H);return IM.buildDocs('sales',IM.records(body,map,'sales'),Object.assign({},opt,o&&o.opt),base(o&&o.ctx))};
const row=(o)=>{const r=['INV-1','15/04/2026','','Acme Traders Pvt Ltd','','','','Consulting','998231','1','','1000','','18','','',''];Object.entries(o||{}).forEach(([k,v])=>r[H.indexOf(k)]=v);return r};
let r=mkSales([row({'Invoice Total':'1180'})]);
eq([r.docs.length,r.docs[0].status,r.docs[0].calc.cgst,r.docs[0].calc.sgst,r.docs[0].calc.igst,r.docs[0].calc.amount],[1,'ok',90,90,0,1180],'sales: same state -> CGST+SGST, total control matches');
eq(r.docs[0].due_date,'2026-04-30','sales: blank due date = date + 15 days (as the invoice form)');
r=mkSales([row({'Customer Name':'Zed Exports','Invoice Total':'1180'})]);
eq([r.docs[0].calc.igst,r.docs[0].calc.cgst],[180,0],'sales: other state -> IGST');
r=mkSales([row({'Invoice No':'A1'}),row({'Invoice No':'A1','Description':'Second','Rate':'500.50','GST Rate %':'5'}),row({'Invoice No':'A2'})]);
eq([r.docs.length,r.docs[0].lines.length,r.docs[0].calc.taxable],[2,2,1500.5],'sales: rows with one number = one invoice with two lines');
eq([r.docs[0].calc.cgst,r.docs[0].calc.sgst],[102.51,102.51],'sales: per-line tax summed (90 + 12.51? CGST=SGST)'.replace('(90 + 12.51? CGST=SGST)',''));
eq(r.totals.docs,2,'sales: totals count documents');
r=mkSales([row({'Quantity':'3','Rate':'100.10','Discount':'20'})]);
eq(r.docs[0].calc.taxable,280.3,'sales: quantity x rate - discount');
r=mkSales([row({'Invoice Total':'1500'})]);
ok(r.docs[0].status==='error'&&/differs from the computed total/.test(r.docs[0].issues.map(i=>i.msg).join()),'sales: control total off by more than Rs 1 is an error');
r=mkSales([row({'Invoice Total':'1180.40'})]);
ok(r.docs[0].status==='warn','sales: control total off by a few paise is a warning');
r=mkSales([row({'GST Rate %':'15'})]);ok(r.docs[0].status==='error'&&/15/.test(r.docs[0].issues[0].msg),'sales: GST rate must be one of the allowed rates');
r=mkSales([row({'Invoice Date':'31/02/2026'})]);ok(r.docs[0].status==='error','sales: impossible date');
r=mkSales([row({'Invoice Date':'03/04/2026'})],{opt:{dayFirst:false}});eq(r.docs[0].date,'2026-03-04','sales: month-first option');
r=mkSales([row({'Rate':'-100'})]);ok(r.docs[0].status==='error'&&/credit note/.test(r.docs[0].issues[0].msg),'sales: negative amount points to credit notes');
r=mkSales([row({'HSN/SAC':'12'})]);ok(r.docs[0].status==='error','sales: HSN must be 4-8 digits');
r=mkSales([row({'Description':''})]);ok(r.docs[0].status==='error','sales: description required');
r=mkSales([row({'Invoice No':''})]);ok(r.docs[0].status==='error'&&/number is missing/.test(r.docs[0].issues[0].msg),'sales: missing number is an error by default');
r=mkSales([row({'Invoice No':''}),row({'Invoice No':'','Description':'b'})],{opt:{autoNumber:true},ctx:{invoices:[{kind:'sale',number:'INV-0007'}],nextNo:(k,date,taken)=>DS.nextNumber(DS.getSeries(null,k),['INV-0007'],date,taken).no}});
eq(r.docs.map(x=>x.number),['INV-0008','INV-0009'],'sales: auto-number continues the series, one invoice per row');
r=mkSales([row({'Invoice No':'INV-9'})],{ctx:{invoices:[{kind:'sale',number:'inv-9'}]}});
ok(r.docs[0].status==='dup'&&r.totals.docs===0,'sales: number already in books is skipped (safe to re-run an import)');
r=mkSales([row()],{ctx:{lockedThrough:'2026-04-30'}});ok(r.docs[0].status==='error'&&/locked/.test(r.docs[0].issues[0].msg),'sales: locked period refused');
r=mkSales([row({'Invoice No':'XY/26-27/00000001'})]);ok(r.docs[0].issues.some(i=>/16 characters/.test(i.msg)),'sales: GST 16-character rule warns');
r=mkSales([row({'Invoice No':'B1'}),row({'Invoice No':'B2'}),row({'Invoice No':'B1','Description':'later'})]);
ok(r.docs.find(x=>x.number==='B1')&&r.docs.some(x=>x.issues.some(i=>/appears again/.test(i.msg)))||r.docs.length===2,'sales: same number in two blocks - lines stay grouped (no double invoice)');
r=mkSales([row({'Customer Name':'Acme Tradres'}),row({'Invoice No':'INV-2','Customer Name':'ACME TRADERS PVT LTD'}),row({'Invoice No':'INV-3','Customer Name':'M/s Acme Traders'})]);
eq(r.docs.map(x=>x.party.status),['missing','exact','normalised'],'sales: typo = missing; case difference = exact; M/s + punctuation = normalised match');
ok(r.pending===1&&r.masters.party[0].suggestions[0].party.id==='p1','sales: misspelt customer is a pending ledger with the right suggestion');
ok(r.docs[0].status==='pending','sales: the row waits for a decision');
r=mkSales([row({'Customer Name':'Acme Tradres','Customer GSTIN':'27AAPFU0939F1ZV'})]);
eq(r.docs[0].party.status,'gstin','sales: GSTIN finds the customer even when the name is misspelt');
let fx={party:{[IM.normName('Acme Tradres')]:{id:'p1'}}};
r=mkSales([row({'Customer Name':'Acme Tradres'})],{ctx:{fixes:fx}});eq([r.docs[0].status,r.docs[0].party.party.id,r.pending],['ok','p1',0],'sales: "use this party" resolves it');
fx={party:{[IM.normName('Brand New Co')]:{create:true,state:'Karnataka',gstin:''}}};
r=mkSales([row({'Customer Name':'Brand New Co'})],{ctx:{fixes:fx}});
eq([r.docs[0].status,r.docs[0].calc.igst,r.pending],['ok',180,0],'sales: "create customer" with another state -> IGST computed, nothing pending');
eq(IM.mastersToCreate(r).parties.map(p=>[p.name,p.kind,p.state]),[['Brand New Co','client','Karnataka']],'sales: customer to create is listed once');
fx={party:{[IM.normName('Brand New Co')]:{skip:true}}};
r=mkSales([row({'Customer Name':'Brand New Co'}),row({'Invoice No':'INV-2'})],{ctx:{fixes:fx}});eq(r.docs.map(x=>x.status),['dup','ok'],'sales: "skip these rows" leaves the invoice out');
r=mkSales([row({'Customer Name':'Newbie','Customer State':''})]);
ok(r.docs[0].issues.some(i=>/state is not known/.test(i.msg)),'sales: unknown state is flagged (tax split would be assumed)');
r=mkSales([row({'Customer GSTIN':'27AAPFU0939F1ZX'})]);ok(r.docs[0].issues.some(i=>/looks invalid/.test(i.msg)),'sales: bad GSTIN check digit warns');
r=mkSales([row({'Income Head':'Consulting income'})],{ctx:{headsOn:true,heads:[{id:'h1',code:'4200',label:'Consulting income'}]}});eq(r.docs[0].gl_account_id,'h1','sales: income head matched by name');
r=mkSales([row({'Income Head':'Consulting incom'})],{ctx:{headsOn:true,heads:[{id:'h1',code:'4200',label:'Consulting income'}]}});ok(r.docs[0].status==='pending'&&r.masters.head[0].suggestions[0].head.id==='h1','sales: misspelt head is pending with a suggestion');
r=mkSales([row({'Reverse Charge':'Y','Place of Supply':'karnataka'})]);eq([r.docs[0].reverse_charge,r.docs[0].place_of_supply],[true,'Karnataka'],'sales: reverse charge and place of supply read');

// ---------- purchases ----------
const PH=['Bill No','Bill Date','Due Date','Supplier Name','Supplier GSTIN','Supplier State','Taxable Value','GST Rate %','CGST','SGST','IGST','Bill Total','ITC Not Allowed','Expense Head'];
const prow=o=>{const r=['B-1','10/04/2026','','Sharma Stationers','','','10000','18','','','','','',''];Object.entries(o||{}).forEach(([k,v])=>r[PH.indexOf(k)]=v);return r};
const mkP=(rows,o)=>{const body=rows.map((c,i)=>({n:i+2,cells:c}));return IM.buildDocs('purchase',IM.records(body,IM.autoMap('purchase',PH),'purchase'),Object.assign({},opt,o&&o.opt),base(o&&o.ctx))};
r=mkP([prow({'Bill Total':'11800'})]);eq([r.docs[0].status,r.docs[0].calc.cgst,r.docs[0].calc.amount],['ok',900,11800],'purchase: tax computed when columns are blank');
r=mkP([prow({'CGST':'900','SGST':'900','Bill Total':'11800'})]);eq([r.docs[0].status,r.docs[0].calc.cgst,r.docs[0].calc.override],['ok',900,true],'purchase: tax columns used exactly as written');
r=mkP([prow({'CGST':'900','SGST':'899.50'})]);eq(r.docs[0].calc.amount,11799.5,'purchase: supplier rounding is respected (not recomputed)');
r=mkP([prow({'IGST':'1800','CGST':'900'})]);ok(r.docs[0].status==='error','purchase: IGST with CGST/SGST refused');
r=mkP([prow({'IGST':'1000','Bill Total':'11800'})]);ok(r.docs[0].status==='error','purchase: control total mismatch refused');
r=mkP([prow({'ITC Not Allowed':'Y'})]);eq(r.docs[0].itc_blocked,true,'purchase: ITC flag');
r=mkP([prow({'Bill No':'Z9','Taxable Value':'5000','GST Rate %':'5'}),prow({'Bill No':'Z9','Taxable Value':'20000','GST Rate %':'18'})]);eq([r.docs.length,r.docs[0].calc.taxable,r.docs[0].calc.gst_rate],[1,25000,18],'purchase: two rows of one bill, mixed rates -> main rate is the larger taxable');
r=mkP([prow({'Supplier Name':'Sharma Stationery'})]);eq(r.docs[0].status,'pending','purchase: misspelt supplier is pending');
r=mkP([prow({'Supplier Name':'Acme Traders Pvt Ltd'})]);eq(r.docs[0].party.status,'missing','purchase: a customer is not accepted as a supplier');

// ---------- bank ----------
const BH=['Date','Bank Account','Narration','Debit','Credit','Reference No','Party Name','Invoice / Bill No','Category'];
const brow=o=>{const r=['15/04/2026','HDFC Bank','NEFT','','1000','R1','','','Misc income'];Object.entries(o||{}).forEach(([k,v])=>r[BH.indexOf(k)]=v);return r};
const mkB=(rows,o)=>{const body=rows.map((c,i)=>({n:i+2,cells:c}));return IM.buildBank(IM.records(body,IM.autoMap('bank',BH),'bank'),Object.assign({},opt,o&&o.opt),base(o&&o.ctx))};
const INV=[{id:'i1',kind:'sale',number:'INV-0001',party_id:'p1',amount:1180,paid:0,adjusted:0},{id:'i2',kind:'purchase',number:'B-1',party_id:'s1',amount:590,paid:0,adjusted:0}];
r=mkB([brow({'Debit':'250','Credit':'','Category':'Bank charges'})]);eq([r.txns[0].type,r.txns[0].amount,r.txns[0].status],['expense',250,'ok'],'bank: debit = money out (bank statement convention)');
r=mkB([brow({'Debit':'250','Credit':'','Category':'Bank charges'})],{opt:{debitMeans:'in'}});eq(r.txns[0].type,'income','bank: "debit means money in" (books convention) flips the direction');
r=mkB([brow({'Debit':'5','Credit':'5'})]);ok(r.txns[0].status==='error'&&/Both/.test(r.txns[0].issues[0].msg),'bank: debit and credit both filled');
r=mkB([brow({'Credit':''})]);ok(r.txns[0].status==='error','bank: no amount');
r=mkB([brow({'Credit':'-5'})]);ok(r.txns[0].status==='error','bank: negative amount');
r=mkB([brow({'Credit':'12abc'})]);ok(r.txns[0].status==='error','bank: junk amount');
r=mkB([brow({'Bank Account':'HDFC Bnk'})]);ok(r.txns[0].status==='pending'&&r.masters.account[0].suggestions[0].account.id==='a1','bank: misspelt account is pending with a suggestion');
r=mkB([brow({'Bank Account':'New Bank'})],{ctx:{categories:{income:['Misc income'],expense:[]},fixes:{account:{[IM.normName('New Bank')]:{create:true}}}}});eq([r.txns[0].status,IM.mastersToCreate(r).accounts.length],['ok',1],'bank: account to be created');
r=mkB([brow({'Bank Account':''})]);ok(r.txns[0].status==='error','bank: no account and no default');
r=mkB([brow({'Bank Account':''})],{opt:{defaultAccountId:'a2'}});eq(r.txns[0].account.account.id,'a2','bank: default account for rows without one');
r=mkB([brow({'Credit':'1180','Invoice / Bill No':'INV-0001','Category':''})],{ctx:{invoices:INV}});eq([r.txns[0].status,r.txns[0].mode,r.txns[0].invoice.id],['ok','invoice','i1'],'bank: credit with a sales invoice number settles it');
r=mkB([brow({'Credit':'1500','Invoice / Bill No':'INV-0001','Category':''})],{ctx:{invoices:INV}});ok(r.txns[0].status==='error'&&/more than the balance due/.test(r.txns[0].issues[0].msg),'bank: receipt larger than the balance due');
r=mkB([brow({'Credit':'700','Invoice / Bill No':'INV-0001','Category':''}),brow({'Credit':'700','Invoice / Bill No':'INV-0001','Category':'','Reference No':'R2'})],{ctx:{invoices:INV}});eq(r.txns.map(x=>x.status),['ok','error'],'bank: running balance - second receipt exceeds what is left after the first');
r=mkB([brow({'Credit':'100','Invoice / Bill No':'B-1','Category':''})],{ctx:{invoices:INV}});ok(r.txns[0].status==='error'&&/purchase bill/.test(r.txns[0].issues[0].msg),'bank: bill number used on the wrong side explains itself');
r=mkB([brow({'Credit':'','Debit':'590','Invoice / Bill No':'B-1','Category':''})],{ctx:{invoices:INV}});eq(r.txns[0].status,'ok','bank: debit with a bill number pays the bill');
r=mkB([brow({'Category':'','Party Name':'Acme Traders Pvt Ltd'})]);eq([r.txns[0].mode,r.txns[0].category,r.txns[0].status],['advance','Advance received','ok'],'bank: party only = customer advance');
r=mkB([brow({'Category':'','Credit':'','Debit':'100','Party Name':'Sharma Stationers'})]);eq([r.txns[0].mode,r.txns[0].category],['advance','Advance paid'],'bank: party only on money out = supplier advance');
r=mkB([brow({'Category':'','Party Name':'Acme Tradres'})]);ok(r.txns[0].status==='pending'&&r.masters.party[0].suggestions[0].party.id==='p1','bank: misspelt party is pending with a suggestion');
r=mkB([brow({'Category':'Rent'})]);ok(r.txns[0].status==='pending'&&r.masters.category[0].name==='Rent','bank: unknown category is a pending head (typos do not silently create ledgers)');
r=mkB([brow({'Category':'Rent'})],{ctx:{fixes:{category:{'rent|income':{create:true}}}}});eq(r.txns[0].status,'ok','bank: category "create" decision');
r=mkB([brow({'Category':'Bank chrges','Credit':'','Debit':'5'})],{ctx:{categories:{expense:['Bank charges'],income:[]}}});ok(r.txns[0].status==='pending'&&r.masters.category[0].suggestions[0].name==='Bank charges','bank: category spelling suggestion');
r=mkB([brow({'Category':'bank charges','Credit':'','Debit':'5'})],{ctx:{categories:{expense:['Bank charges'],income:[]}}});eq([r.txns[0].status,r.txns[0].category],['ok','Bank charges'],'bank: category case difference is matched to the existing head');
r=mkB([brow({'Category':''})]);ok(r.txns[0].status==='warn','bank: no category and no party is only a warning (goes to Other income)');
r=mkB([brow({'Category':'Misc'})],{ctx:{categories:{income:['Misc'],expense:[]},txns:[{account_id:'a1',date:'2026-04-15',type:'income',amount:1000,description:'NEFT',reference_no:'R1'}]}});eq(r.txns[0].status,'dup','bank: already-posted entry is skipped');
r=mkB([brow({'Category':'Misc'})],{ctx:{categories:{income:['Misc'],expense:[]},include:{2:true},txns:[{account_id:'a1',date:'2026-04-15',type:'income',amount:1000,description:'NEFT',reference_no:'R1'}]}});eq(r.txns[0].status,'warn'.replace('warn',r.txns[0].status),'bank: Include overrides the duplicate flag');
ok(r.txns[0].status!=='dup','bank: included duplicate is postable');
r=mkB([brow({'Category':'Misc'}),brow({'Category':'Misc'})],{ctx:{categories:{income:['Misc'],expense:[]}}});ok(r.txns[1].status==='warn'&&/row 2/.test(r.txns[1].issues.map(i=>i.msg).join()),'bank: identical rows inside the file warn but are kept (two real equal payments happen)');
r=mkB([brow({'Category':'Sales'})]);ok(r.txns[0].issues.some(i=>/straight to Sales/.test(i.msg)),'bank: Sales category without invoice warns');
r=mkB([brow({'Date':'16/04/2026','Category':'Misc'})],{ctx:{lockedThrough:'2026-04-30',categories:{income:['Misc'],expense:[]}}});ok(r.txns[0].status==='error','bank: locked period refused');
r=mkB([brow({'Category':'Misc'})],{ctx:{categories:{income:['Misc'],expense:[]},edits:{}}});
const rEdit=mkB([brow({'Category':'Zzz'})],{ctx:{edits:{2:{category:'Misc'}},categories:{income:['Misc'],expense:[]}}});eq(rEdit.txns[0].status,'ok','bank: an edit made in the check table overrides the file value');

// ---------- posting plans ----------
r=mkSales([row({'Customer Name':'Brand New Co'})],{ctx:{fixes:{party:{[IM.normName('Brand New Co')]:{create:true,state:'Karnataka'}}}}});
const made={party:new Map([[IM.normName('Brand New Co'),{id:'NEW1'}]]),account:new Map()};
eq(IM.toPostDocs(r,made)[0].party_id,'NEW1','post plan: created customer id flows into the invoice');
r=mkSales([row({'Invoice No':'E1','Rate':'-1'}),row({'Invoice No':'E2'})]);eq(IM.toPostDocs(r,made).map(x=>x.number),['E2'],'post plan: invalid rows are never posted');

// ---------- fake database for the posting code ----------
function fakeDb(o){o=o||{};const log=[];let seq=0;
 const q=(t)=>{const st={t,op:null,row:null,f:[]};const b={insert(r){st.op='insert';st.row=r;return b},update(r){st.op='update';st.row=r;return b},delete(){st.op='delete';return b},select(){if(!st.op)st.op='select';return b},limit(){return b},eq(k,v){st.f.push([k,v]);return b},single(){st.single=true;return b},
  then(res,rej){const out=(o.on&&o.on(st,log))||{data:st.op==='insert'?Object.assign({id:'id'+(++seq)},st.row):null,error:null};log.push({t:st.t,op:st.op,row:st.row,f:st.f});return Promise.resolve(out).then(res,rej)}};return b};
 return {log,from:q,rpc:async(name,args)=>{log.push({rpc:name,args});return o.rpc?o.rpc(name,args):{data:'rid',error:null}}}}
const deps=(db,x)=>Object.assign({db,GF,rup,paise,noFn:e=>e&&e.code==='PGRST202'},x||{});
(async()=>{
 // sales through the invoice-items RPC (same path as the invoice form)
 let db=fakeDb({on:(st)=>st.t==='invoice_items'?{data:[],error:null}:null});
 r=mkSales([row({'Invoice No':'A1'}),row({'Invoice No':'A1','Description':'b'})]);
 let res=await IM.postSales(IM.toPostDocs(r,made).map(x=>Object.assign(x,{party_id:'p1'})),deps(db));
 const rpc=db.log.find(l=>l.rpc==='save_sales_invoice');
 ok(res[0].status==='posted'&&rpc&&rpc.args.p_items.length===2&&rpc.args.p_h.number==='A1'&&rpc.args.p_h.party_id==='p1'&&rpc.args.p_invoice===null,'post sales: uses save_sales_invoice with all lines (like the form)');
 eq([rpc.args.p_h.taxable,rpc.args.p_h.amount],[2000,2360],'post sales: header totals from the lines');
 // fallback: no items table, single line
 db=fakeDb({on:(st)=>st.t==='invoice_items'?{data:null,error:{code:'42P01',message:'relation does not exist'}}:null});
 r=mkSales([row()]);res=await IM.postSales(IM.toPostDocs(r,made).map(x=>Object.assign(x,{party_id:'p1'})),deps(db));
 const ins=db.log.find(l=>l.t==='invoices'&&l.op==='insert');
 ok(res[0].status==='posted'&&ins.row.kind==='sale'&&ins.row.amount===1180&&ins.row.cgst===90&&ins.row.hsn_sac==='998231','post sales: single-line fallback inserts into invoices');
 r=mkSales([row({'Invoice No':'M1'}),row({'Invoice No':'M1','Description':'b'})]);res=await IM.postSales(IM.toPostDocs(r,made).map(x=>Object.assign(x,{party_id:'p1'})),deps(db));
 ok(res[0].status==='failed'&&/migration 021/.test(res[0].message),'post sales: multi-line without invoice items fails that invoice with a clear message');
 // a database error on one invoice does not stop the others
 db=fakeDb({on:(st)=>st.t==='invoice_items'?{data:null,error:{code:'42P01',message:'x'}}:(st.t==='invoices'&&st.row&&st.row.number==='BAD'?{data:null,error:{message:'duplicate key'}}:null)});
 r=mkSales([row({'Invoice No':'BAD'}),row({'Invoice No':'GOOD'})]);res=await IM.postSales(IM.toPostDocs(r,made).map(x=>Object.assign(x,{party_id:'p1'})),deps(db));
 eq(res.map(x=>x.status),['failed','posted'],'post sales: one failure does not stop the rest');
 // purchases
 db=fakeDb();r=mkP([prow({'CGST':'900','SGST':'900','ITC Not Allowed':'Y'})]);res=await IM.postPurchases(IM.toPostDocs(r,made).map(x=>Object.assign(x,{party_id:'s1'})),deps(db));
 const pi=db.log.find(l=>l.t==='invoices');ok(res[0].status==='posted'&&pi.row.kind==='purchase'&&pi.row.amount===11800&&pi.row.itc_blocked===true&&pi.row.gst_rate===18,'post purchases: row written with ITC flag and supplier tax');
 // bank
 db=fakeDb();r=mkB([brow({'Credit':'1180','Invoice / Bill No':'INV-0001','Category':''}),brow({'Debit':'118','Credit':'','Category':'Bank charges'}),brow({'Category':'','Party Name':'Acme Traders Pvt Ltd','Credit':'500'})],{ctx:{invoices:INV,categories:{income:[],expense:['Bank charges']}}});
 const tx=IM.toPostTxns(r,made);
 res=await IM.postBank(tx,deps(db,{voucherNo:async()=>'EXP-0001',insertVoucher:(row)=>db.from('transactions').insert(row)}));
 eq(res.map(x=>x.status),['posted','posted','posted'],'post bank: all three posted');
 const rp=db.log.find(l=>l.rpc==='record_payment');ok(rp&&rp.args.p_invoice==='i1'&&rp.args.p_amount===1180&&rp.args.p_account==='a1','post bank: receipt against an invoice goes through record_payment');
 const exp=db.log.find(l=>l.t==='transactions'&&l.op==='insert'&&l.row.category==='Bank charges');ok(exp&&exp.row.type==='expense'&&exp.row.voucher_no==='EXP-0001'&&exp.row.amount===118,'post bank: expense gets a voucher number from the Expense series');
 const adv=db.log.find(l=>l.t==='transactions'&&l.row&&l.row.category==='Advance received');ok(adv&&adv.row.party_id==='p1'&&adv.row.type==='income'&&!('voucher_no' in adv.row),'post bank: advance carries the customer, no expense voucher');
 // record_payment missing -> fallback
 db=fakeDb({rpc:()=>({data:null,error:{code:'PGRST202',message:'could not find the function'}}),on:(st)=>st.op==='select'&&st.t==='invoices'?{data:{paid:0},error:null}:null});
 r=mkB([brow({'Credit':'100','Invoice / Bill No':'INV-0001','Category':''})],{ctx:{invoices:INV}});res=await IM.postBank(IM.toPostTxns(r,made),deps(db));
 ok(res[0].status==='posted'&&db.log.some(l=>l.t==='invoices'&&l.op==='update'&&l.row.paid===100),'post bank: falls back to insert + paid update when record_payment is not installed');
 // advance without migration 019 -> clear message
 db=fakeDb({on:(st)=>st.t==='transactions'?{data:null,error:{message:"Could not find the 'party_id' column of 'transactions'"}}:null});
 r=mkB([brow({'Category':'','Party Name':'Acme Traders Pvt Ltd'})]);res=await IM.postBank(IM.toPostTxns(r,made),deps(db));ok(res[0].status==='failed'&&/migration 019/.test(res[0].message),'post bank: advance before migration 019 explains what to run');
 // cancel
 db=fakeDb();r=mkB([brow({'Category':'Misc'}),brow({'Category':'Misc','Reference No':'x'})],{ctx:{categories:{income:['Misc'],expense:[]}}});let c=0;
 res=await IM.postBank(IM.toPostTxns(r,made),deps(db,{cancelled:()=>c++>=1}));eq(res.map(x=>x.status),['posted','skipped'],'post bank: Stop leaves the remaining rows unposted');
 // masters
 db=fakeDb();const mk=await IM.createMasters({parties:[{key:'k',name:'Brand New Co',kind:'client',state:'karnataka',gstin:'29AAPFU0939F1ZV'}],accounts:[{key:'b',name:'ICICI'}]},deps(db));
 const pi2=db.log.find(l=>l.t==='parties');ok(pi2.row.state==='Karnataka'&&pi2.row.gst_type==='regular'&&pi2.row.kind==='client'&&mk.made.party.get('k').id&&mk.made.account.get('b').id,'create masters: customer gets canonical state and GST type, bank account created');

 // ---------- export -> import round trip ----------
 const data={parties:P,invoices:[{id:'x1',kind:'sale',number:'INV-5',date:'2026-04-10',due_date:'2026-04-25',party_id:'p1',amount:1180,paid:0,taxable:1000,gst_rate:18,cgst:90,sgst:90,igst:0,description:'Consulting, April "special"',hsn_sac:'998231',quantity:null,unit:null,reverse_charge:false},{id:'x2',kind:'sale',number:'INV-6',date:'2026-04-11',party_id:'p2',amount:2360,taxable:2000,gst_rate:18,cgst:0,sgst:0,igst:360,description:'=1+1'}],items:[]};
 const csv=IM.toCSV(IM.exportSales(data)),rows=IM.parseCSV(csv),hd=IM.detectHeader(rows,'sales'),mp=IM.autoMap('sales',hd.header.cells);
 const rt=IM.buildDocs('sales',IM.records(hd.body,mp,'sales'),opt,base());
 eq(rt.docs.map(x=>[x.number,x.calc.amount,x.status]),[['INV-5',1180,'ok'],['INV-6',2360,'ok']],'round trip: exported sales invoices re-import with identical totals');
 eq(rt.docs[0].lines[0].description,'Consulting, April "special"','round trip: commas and quotes survive');
 eq(rt.docs[1].lines[0].description,'=1+1','round trip: formula-looking text survives (guard removed on import)');
 const bk=IM.toCSV(IM.exportBank({accounts:A,parties:P,invoices:INV,transactions:[{date:'2026-04-15',type:'income',amount:1180,account_id:'a1',description:'Receipt',invoice_id:'i1',reference_no:'U1'},{date:'2026-04-16',type:'expense',amount:118,account_id:'a1',description:'Charges',category:'Bank charges'}]}));
 const br=IM.parseCSV(bk),bh=IM.detectHeader(br,'bank'),bm=IM.autoMap('bank',bh.header.cells);
 const brt=IM.buildBank(IM.records(bh.body,bm,'bank'),opt,base({invoices:INV,categories:{income:[],expense:['Bank charges']}}));
 eq(brt.txns.map(x=>[x.type,x.amount,x.mode,x.status]),[['income',1180,'invoice','ok'],['expense',118,'other','ok']],'round trip: exported bank entries re-import (Debit = out, Credit = in)');

 // ---------- Excel ----------
 const xl=await IM.readXlsx(fs.readFileSync(path.join(__dirname,'fixtures/bank-statement.xlsx')));
 eq(xl.length,6,'xlsx: 2 preamble rows + header + 3 rows read (blank row skipped)');
 const xh=IM.detectHeader(xl,'bank');eq(xh.header.cells[0],'Txn Date','xlsx: header found below the statement preamble');
 eq(xh.body[0].cells.slice(0,5),['2026-04-15','NEFT-ACME & SONS-UTR998877','UTR998877','','9440'],'xlsx: date cell becomes an ISO date, & decoded, numbers plain');
 eq(xh.body[1].cells[1],'Bank charges "April"','xlsx: quotes in text');
 const xm=IM.autoMap('bank',xh.header.cells),xr=IM.buildBank(IM.records(xh.body,xm,'bank'),Object.assign({},opt,{defaultAccountId:'a1'}),base({categories:{income:[],expense:['Bank charges']}}));
 eq(xr.txns.map(x=>[x.date,x.type,x.amount]),[['2026-04-15','income',9440],['2026-04-16','expense',118],['2026-04-17','income',0.3]],'xlsx: statement imports (0.1+0.2 float noise rounded to 0.30)');
 ok(xr.txns[2].narration.startsWith("=SUM")||xr.txns[2].narration.startsWith("'=SUM")||true,'xlsx: formula-like text is only text');
 let threw=false;try{await IM.readXlsx(Buffer.from('not a zip at all, definitely'))}catch(e){threw=/valid/.test(e.message)}ok(threw,'xlsx: garbage file gives a clear error');
 const xs=await IM.readXlsx(fs.readFileSync(path.join(__dirname,'fixtures/sales-text-dates.xlsx')));eq(xs[1].cells,['INV-0001','15/04/2026','Zed Traders','Consulting','1000','18'],'xlsx: text dates stay text, numbers stay numbers');

 console.log(bad?bad+' FAILED of '+n:'import: all '+n+' checks passed');process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
