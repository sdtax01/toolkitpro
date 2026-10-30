// End-to-end browser test of Settings (numbering series, data reset) and Import / Export, against an in-memory fake Supabase.
// Run: NODE_PATH=$(npm root -g) node tests/import-e2e.js [screenshotDir]   (needs playwright)
const {chromium}=require('playwright'),http=require('http'),fs=require('fs'),path=require('path'),stub=require('./fake-supabase.js');
const root=path.join(__dirname,'..'),shots=process.argv[2]||null;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'};
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(root,p);if(!f.startsWith(root)||!fs.existsSync(f)){s.writeHead(404);return s.end()}s.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s)});
const seed=()=>({settings:[{id:'s',business_name:'Shree Digitax Solutions',gstin:'27AAPFU0939F1ZV',state:'Maharashtra',default_gst:18,doc_series:null}],
 parties:[{id:'p1',kind:'client',name:'Alpha Traders',state:'Maharashtra',gstin:'27AAPFU0939F1ZV'},{id:'p2',kind:'client',name:'Beta Works',state:'Karnataka'},{id:'s1',kind:'supplier',name:'Supply Co',state:'Maharashtra'}],
 accounts:[{id:'a1',name:'HDFC Bank',opening:50000}],
 invoices:[{id:'i1',party_id:'p1',kind:'sale',number:'INV-0001',date:'2026-09-01',due_date:'2026-09-16',amount:11800,paid:0,adjusted:0,taxable:10000,gst_rate:18,cgst:900,sgst:900,igst:0},{id:'i4',party_id:'s1',kind:'purchase',number:'BILL-0001',date:'2026-09-02',due_date:'2026-09-17',amount:7080,paid:0,adjusted:0,taxable:6000,gst_rate:18,cgst:540,sgst:540,igst:0}],
 transactions:[{id:'t2',date:'2026-10-01',description:'Office rent',category:'Rent',type:'expense',amount:12000,account_id:'a1'}],
 reminders:[],assets:[],budgets:[],goals:[],documents:[]});
let bad=0;const fail=(n,m)=>{bad++;console.log('FAIL '+n+': '+m)},pass=n=>console.log('PASS '+n);
const check=(c,n,m)=>c?pass(n):fail(n,m||'');
(async()=>{await new Promise(r=>srv.listen(0,r));const port=srv.address().port,br=await chromium.launch();
 const mk=async(opts,w,mod)=>{const ctx=await br.newContext({viewport:{width:w||1366,height:900},acceptDownloads:true}),page=await ctx.newPage(),errs=[];
  page.on('pageerror',e=>errs.push('pageerror: '+e.message));page.on('console',m=>{if(m.type()==='error'&&!/favicon|Failed to load resource/.test(m.text()))errs.push('console: '+m.text())});
  await page.route('**/assets/vendor/supabase.js*',r=>r.fulfill({contentType:'text/javascript',body:stub((()=>{const d=seed();if(mod)mod(d);return d})(),opts)}));
  await page.route('**/*',r=>/^http:\/\/127\.0\.0\.1/.test(r.request().url())?r.fallback():r.abort());
  page.on('dialog',d=>d.accept());return{ctx,page,errs}};
 const open=async(page,u)=>{await page.goto(`http://127.0.0.1:${port}/${u}`);await page.waitForFunction(()=>document.querySelector('#main')&&document.querySelector('#main').getAttribute('aria-busy')==='false',null,{timeout:8000})};
 const shot=async(page,n)=>{if(shots){fs.mkdirSync(shots,{recursive:true});await page.screenshot({path:path.join(shots,n+'.png'),fullPage:true})}};
 const noScroll=async(page,n)=>check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),n+': no horizontal page scroll');
 const dbq=(page,t)=>page.evaluate(t=>window.__DB[t],t);
 const text=page=>page.evaluate(()=>document.querySelector('#main').innerText);

 /* ================= Settings: numbering series ================= */
 { const {ctx,page,errs}=await mk({});await open(page,'settings.html');
  await page.waitForSelector('#series table');
  const pv=await page.$$eval('#series [data-pv]',a=>a.map(x=>x.textContent));
  check(pv[0]==='INV-0002'&&pv[1]==='BILL-0002'&&pv[2]==='EXP-0001'&&pv[3]==='CN-0001'&&pv[4]==='DN-0001','series: previews continue existing numbers (INV-0002, BILL-0002, EXP-0001, CN-0001, DN-0001)',pv.join());
  const sale=page.locator('#series tr[data-k=sale]');
  await sale.locator('[data-f=prefix]').fill('INVOICE/{FY}/');await sale.locator('[data-f=digits]').fill('4');
  check(await page.locator('#ssave').isDisabled(),'series: a 17+ character GST invoice number disables Save');
  check(/at most 16 characters/.test(await sale.locator('[data-is]').innerText()),'series: the reason is shown');
  await sale.locator('[data-f=prefix]').fill('SDS/{FYS}/');await sale.locator('[data-f=digits]').fill('3');
  const p2=await sale.locator('[data-pv]').innerText();check(/^SDS\/\d\d-\d\d\/001$/.test(p2),'series: FY token and digits in the preview',p2);
  await page.locator('#ssave').click();await page.waitForTimeout(300);
  const st=(await dbq(page,'settings'))[0].doc_series;check(st&&st.sale&&st.sale.prefix==='SDS/{FYS}/'&&st.sale.digits===3&&!st.purchase,'series: only the changed series is saved',JSON.stringify(st));
  check(errs.length===0,'settings: no script errors',errs.join('|'));await shot(page,'settings-series');
  await page.evaluate(()=>{});
  // the invoice form picks the series up
  const db1=await page.evaluate(()=>JSON.stringify(window.__DB));await page.close();
  const p=await ctx.newPage();await p.route('**/assets/vendor/supabase.js*',r=>r.fulfill({contentType:'text/javascript',body:stub(Object.assign(JSON.parse(db1)),{})}));await p.route('**/*',r=>/^http:\/\/127\.0\.0\.1/.test(r.request().url())?r.fallback():r.abort());p.on('dialog',d=>d.accept());
  await open(p,'invoice-new.html?kind=sale');const no=await p.inputValue('input[name=number]');check(/^SDS\/\d\d-\d\d\/001$/.test(no),'invoice form: new invoice number follows the series',no);
  await p.goto(`http://127.0.0.1:${port}/invoice-new.html?kind=purchase`);await p.waitForSelector('input[name=number]');check(await p.inputValue('input[name=number]')==='BILL-0002','bill form: default series continues (BILL-0002)');
  await ctx.close()}

 /* ================= Settings: data reset ================= */
 { const {ctx,page,errs}=await mk({});await open(page,'settings.html');await page.waitForSelector('#rstbtn');
  await page.click('#rstbtn');await page.waitForSelector('#rgo');
  const t=await page.locator('.modal').innerText();check(/1.*sales invoices/s.test(t)&&/1.*purchase bills/s.test(t)&&/1.*receipts, payments and expenses/s.test(t),'reset: shows exactly what will be erased',t.slice(0,300));
  check(await page.locator('#rgo').isDisabled(),'reset: button disabled until RESET is typed');
  await page.fill('#rc','reset');check(await page.locator('#rgo').isDisabled(),'reset: lower case is not enough');
  await page.fill('#rc','RESET');
  const [dlw]=await Promise.all([page.waitForEvent('download'),page.click('#rgo')]);
  const body=fs.readFileSync(await dlw.path(),'utf8'),js=JSON.parse(body);check(js.kind==='posted-entries-backup'&&js.tables.invoices.length===2&&js.tables.transactions.length===1,'reset: a backup of every posted entry is downloaded first');
  await page.waitForTimeout(400);
  check((await dbq(page,'invoices')).length===0&&(await dbq(page,'transactions')).length===0,'reset: invoices, bills and transactions erased');
  check((await dbq(page,'parties')).length===3&&(await dbq(page,'accounts')).length===1&&(await dbq(page,'settings')).length===1,'reset: customers, suppliers, bank accounts and settings untouched');
  check(errs.length===0,'reset: no script errors',errs.join('|'));await ctx.close()}
 { // client-side fallback when migration 022 is not installed and the ledger is off
  const {ctx,page,errs}=await mk({noReset:true,missingCols:{settings:['doc_series']}},0,d=>{delete d.settings[0].doc_series});await open(page,'settings.html');await page.waitForSelector('#rstbtn');await page.click('#rstbtn');await page.waitForSelector('#rgo');
  check(/Run <b>|migration 022/.test(await page.locator('#series').innerHTML()),'without migration 022: the numbering card says what to run');
  await page.fill('#rc','RESET');await Promise.all([page.waitForEvent('download'),page.click('#rgo')]);await page.waitForTimeout(500);
  check((await dbq(page,'invoices')).length===0&&(await dbq(page,'parties')).length===3,'reset works without migration 022 while the ledger is off');
  check(errs.length===0,'fallback reset: no script errors',errs.join('|'));await ctx.close()}

 /* ================= Import: sales invoices ================= */
 { const {ctx,page,errs}=await mk({});await open(page,'import-export.html?type=sales');
  const [tpl]=await Promise.all([page.waitForEvent('download'),page.click('#tpl')]);const tcsv=fs.readFileSync(await tpl.path(),'utf8');
  check(tcsv.startsWith('﻿Invoice No*,Invoice Date*,Due Date,Customer Name*'),'sales template downloads with the standard columns');
  await noScroll(page,'import start');
  const csv=['Invoice No*,Invoice Date*,Due Date,Customer Name*,Customer GSTIN,Customer State,Place of Supply,Description*,HSN/SAC,Quantity,Unit,Rate*,Discount,GST Rate %*,Invoice Total (check),Reverse Charge (Y/N),Income Head',
   'S-1,15/10/2026,,Alpha Tradrs,,,,Consulting,998231,1,,1000,,18,1180,,','S-2,16/10/2026,,Gamma Corp,,Karnataka,,Audit,998221,2,Nos,500,,18,1180,,','S-3,17/10/2026,,Beta Works,,,,Bad rate,,1,,100,,15,,,','S-4,18/10/2026,,Beta Works,,,,Return,,1,,-5,,18,,,','INV-0001,01/09/2026,,Alpha Traders,,,,Already there,,1,,10000,,18,,,'].join('\r\n');
  await page.setInputFiles('#file',{name:'sales.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.waitForSelector('#go');
  const unmapped=await page.$$eval('select[data-f]',a=>a.filter(s=>s.value==='-1').map(s=>s.dataset.f));check(unmapped.length===0,'map: every template column was matched automatically',unmapped.join());
  await noScroll(page,'import map');await shot(page,'import-map');
  await page.click('#go');await page.waitForSelector('#masters');
  let tx=await text(page);check(/2 to decide/.test(tx),'check: two names need a decision (Alpha Tradrs, Gamma Corp)',tx.slice(0,400));
  check(await page.locator('#post').isDisabled(),'check: posting is blocked while names are undecided');
  check(/Use “Alpha Traders”/.test(tx),'check: the right spelling is suggested');
  await shot(page,'import-check-1');
  await page.locator('[data-m=party] button[data-act=use-party]').first().click();
  await page.locator('[data-m=party]:has-text("Gamma Corp") button[data-act=create-party]').click();
  check(await page.locator('#cp select[name=state]').inputValue()==='Karnataka','create customer: state prefilled from the file');
  await page.locator('#cp').evaluate(f=>f.requestSubmit());await page.waitForTimeout(150);
  tx=await text(page);check(/all decided/.test(tx),'check: all names decided');
  check(await page.locator('#post').isDisabled(),'check: errors still block posting until skipped');
  const errRows=await page.$$eval('tr[data-st=error]',a=>a.map(r=>r.innerText));check(errRows.length===2&&errRows.some(r=>/15/.test(r))&&errRows.some(r=>/credit note/.test(r)),'check: bad GST rate and negative amount are errors with reasons',errRows.join('|'));
  check(await page.$$eval('tr[data-st=dup]',a=>a.length)===1,'check: invoice that already exists is skipped');
  await page.check('#skiperr');check(!(await page.locator('#post').isDisabled()),'check: "skip errors" lets the valid rows through');
  await noScroll(page,'import check');await shot(page,'import-check-2');
  await page.click('#post');const cd=await page.locator('.modal').innerText();check(/Post 2 invoices/.test(cd)&&/Gamma Corp \(customer\)/.test(cd)&&/2,?360\.00/.test(cd.replace(/,/g,'')+''.replace(/,/g,''))||/2360/.test(cd.replace(/[,.]/g,'')),'confirm: shows count, totals and the customer to be created',cd);
  await page.click('#ok');await page.waitForSelector('#again');
  const inv=await dbq(page,'invoices'),s1=inv.find(x=>x.number==='S-1'),s2=inv.find(x=>x.number==='S-2'),gamma=(await dbq(page,'parties')).find(x=>x.name==='Gamma Corp');
  check(inv.length===4&&s1&&s1.party_id==='p1'&&s1.amount===1180&&s1.cgst===90&&s1.sgst===90&&s1.kind==='sale'&&s1.due_date==='2026-10-30','posted S-1 to the chosen customer with CGST+SGST (due = date + 15)',JSON.stringify(s1));
  check(s2&&gamma&&s2.party_id===gamma.id&&s2.igst===180&&s2.amount===1180&&s2.quantity===2&&gamma.state==='Karnataka'&&gamma.kind==='client','posted S-2 to the newly created customer with IGST and quantity',JSON.stringify([s2,gamma]));
  tx=await text(page);check(/2 invoices posted/.test(tx)&&/Gamma Corp/.test(tx),'result: summary shown');
  const [rp]=await Promise.all([page.waitForEvent('download'),page.click('#rep')]);const rc=fs.readFileSync(await rp.path(),'utf8');check(/S-3/.test(rc)&&/S-4/.test(rc)&&/INV-0001/.test(rc)&&!/S-1/.test(rc)&&/Import result/.test(rc),'result: report lists only rows that were not posted',rc);
  check(errs.length===0,'sales import: no script errors',errs.join('|'));await shot(page,'import-done');await ctx.close()}

 /* ================= Import: sales, multi-line + auto number + Excel header names ================= */
 { const {ctx,page,errs}=await mk({});await open(page,'import-export.html?type=sales');
  const csv=['Invoice No,Date,Party,Item,Taxable Value,GST %,Total','A,01/10/2026,Alpha Traders,One,1000,18,','A,01/10/2026,Alpha Traders,Two,500,5,','B,02/10/2026,Beta Works,Three,200,18,'].join('\n');
  await page.setInputFiles('#file',{name:'x.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForSelector('#go');
  const m=await page.$$eval('select[data-f]',a=>Object.fromEntries(a.map(s=>[s.dataset.f,s.value])));check(m.number!=='-1'&&m.date!=='-1'&&m.party!=='-1'&&m.description!=='-1'&&m.rate!=='-1'&&m.gst_rate!=='-1'&&m.total!=='-1','map: another software\'s headings (Date, Party, Item, Taxable Value, GST %) matched');
  await page.click('#go');await page.waitForSelector('#post');const t=await text(page);check(/2 invoices/.test(t)&&/Ready to post\s*2/.test(t),'check: two-line invoice grouped (2 invoices from 3 rows)',t.slice(0,300));
  await page.click('#post');await page.click('#ok');await page.waitForSelector('#again');
  const ivs=await dbq(page,'invoices');check(!ivs.find(x=>x.number==='A')&&ivs.find(x=>x.number==='B'),'multi-line invoice is not half-posted without migration 021; the single-line one posts','got '+ivs.map(x=>x.number));
  const tx2=await text(page);check(/migration 021/.test(tx2),'a several-line invoice without the invoice-items table is reported clearly (not silently merged)',tx2.slice(0,300));
  check(errs.length===0,'no script errors',errs.join('|'));await ctx.close()}

 /* ================= Import: purchase bills ================= */
 { const {ctx,page,errs}=await mk({});await open(page,'import-export.html?type=purchase');
  const csv=['Bill No*,Bill Date*,Due Date,Supplier Name*,Supplier GSTIN,Supplier State,Taxable Value*,GST Rate %*,CGST,SGST,IGST,Bill Total (check),ITC Not Allowed (Y/N),Expense Head','P-1,10/10/2026,,Supply Co,,,10000,18,900,900,,11800,N,','P-2,11/10/2026,,Supply Cc,,,5000,18,,,900,5900,Y,','P-3,12/10/2026,,Supply Co,,,1000,18,,,,1500,N,'].join('\r\n');
  await page.setInputFiles('#file',{name:'p.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForSelector('#go');await page.click('#go');await page.waitForSelector('#masters');
  let t=await text(page);check(/Use “Supply Co”/.test(t),'purchase: misspelt supplier gets a suggestion');
  await page.locator('[data-act=use-party]').first().click();await page.check('#skiperr');
  check(/differs from the computed total/.test(await page.locator('tr[data-st=error]').innerText()),'purchase: total mismatch is an error');
  await page.click('#post');await page.click('#ok');await page.waitForSelector('#again');
  const b=await dbq(page,'invoices'),p1=b.find(x=>x.number==='P-1'),p2=b.find(x=>x.number==='P-2');
  check(p1&&p1.kind==='purchase'&&p1.amount===11800&&p1.party_id==='s1'&&!p1.itc_blocked,'purchase bill posted with tax as written on the bill');
  check(p2&&p2.igst===900&&p2.amount===5900&&p2.itc_blocked===true&&p2.party_id==='s1','second bill: corrected supplier, IGST kept, ITC flag set');
  check(errs.length===0,'purchase import: no script errors',errs.join('|'));await ctx.close()}

 /* ================= Import: bank entries from an Excel statement ================= */
 { const {ctx,page,errs}=await mk({});await open(page,'import-export.html?type=bank');
  await page.setInputFiles('#file',fs.readFileSync(path.join(__dirname,'fixtures/bank-statement.xlsx')).length?{name:'stmt.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:fs.readFileSync(path.join(__dirname,'fixtures/bank-statement.xlsx'))}:null);
  await page.waitForSelector('#go');
  const mm=await page.$$eval('select[data-f]',a=>Object.fromEntries(a.map(s=>[s.dataset.f,s.value])));check(mm.date==='0'&&mm.narration==='1'&&mm.reference==='2'&&mm.debit==='3'&&mm.credit==='4'&&mm.account==='-1','bank: statement columns matched (Txn Date, Narration, Chq/Ref, Withdrawal, Deposit)',JSON.stringify(mm));
  check(await page.locator('#o-acc').inputValue()==='a1','bank: the only bank account is preselected for rows without one');
  await page.click('#go');await page.waitForSelector('#post');
  if(process.env.DBG)console.log(await page.$$eval('tr[data-st]',a=>a.map(r=>r.dataset.st+' | '+r.innerText.replace(/\s+/g,' '))).then(x=>x.join('\n')));let t=await text(page);check(/Money in\s*₹9,440\.30/.test(t)&&/money out\s*₹118\.00/.test(t),'check: money in / out totals (float noise 0.1+0.2 shown as 0.30)',t.slice(0,300));
  check(await page.$$eval('tr[data-st=warn]',a=>a.length)===3,'check: rows without a category are flagged as warnings');
  await page.locator('input[data-edit=category][data-n="6"]').fill('Bank charges');await page.locator('input[data-edit=category][data-n="6"]').blur();await page.waitForTimeout(150);
  await page.locator('input[data-edit=category][data-n="5"]').fill('Consulting receipts');await page.locator('input[data-edit=category][data-n="5"]').blur();await page.waitForTimeout(150);
  check(/Consulting receipts/.test(await page.locator('#masters').innerText())&&await page.locator('#post').isDisabled(),'check: a new category must be created or corrected before posting (typos cannot create heads silently)');
  await page.locator('[data-act=create-cat]').click();await noScroll(page,'bank check');await shot(page,'bank-check');
  await page.click('#post');await page.click('#ok');await page.waitForSelector('#again');
  const tr=await dbq(page,'transactions'),a=tr.find(x=>x.description.startsWith('NEFT-ACME')),c=tr.find(x=>x.category==='Bank charges'),w=tr.find(x=>x.description.startsWith('=SUM'));
  check(a&&a.type==='income'&&a.amount===9440&&a.category==='Consulting receipts'&&a.account_id==='a1'&&a.reference_no==='UTR998877'&&a.date==='2026-04-15'&&!a.voucher_no,'receipt posted: Credit = money in, category and UTR kept');
  check(c&&c.type==='expense'&&c.amount===118&&c.voucher_no==='EXP-0001','expense posted: Debit = money out, with voucher EXP-0001 from the Expense series');
  check(w&&w.amount===0.3&&w.type==='income'&&/weird/.test(w.description),'formula-looking narration kept as text; amount rounded to 0.30');
  // same file again: everything is recognised as already posted
  await page.click('#again');await page.setInputFiles('#file',{name:'stmt.xlsx',mimeType:'application/octet-stream',buffer:fs.readFileSync(path.join(__dirname,'fixtures/bank-statement.xlsx'))});await page.waitForSelector('#go');await page.click('#go');await page.waitForSelector('#post');
  t=await text(page);check(await page.$$eval('tr[data-st=dup]',a=>a.length)===3&&await page.locator('#post').isDisabled(),'re-importing the same statement posts nothing (all rows recognised as already posted)',t.slice(0,300));
  check(errs.length===0,'bank import: no script errors',errs.join('|'));await ctx.close()}

 /* ================= Import: bank CSV - invoices, spelling, advances ================= */
 { const {ctx,page,errs}=await mk({});await open(page,'import-export.html?type=bank');
  const csv=['Date*,Bank Account*,Narration*,Debit,Credit,Reference No,Party Name,Invoice / Bill No,Category','20/10/2026,HDFC Bnk,NEFT Alpha,,5000,U1,,INV-0001,','21/10/2026,HDFC Bank,Paid Supply Co,7080,,U2,,BILL-0001,','22/10/2026,HDFC Bank,Advance,,1000,U3,Alpha Tradrs,,','23/10/2026,HDFC Bank,Too much,,9000,U4,,INV-0001,'].join('\r\n');
  await page.setInputFiles('#file',{name:'b.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForSelector('#go');await page.click('#go');await page.waitForSelector('#masters');
  let t=await text(page);check(/Use “HDFC Bank”/.test(t)&&/Use “Alpha Traders”/.test(t),'bank: misspelt account and party both get suggestions');
  await page.locator('[data-act=use-account]').first().click();await page.locator('[data-m=party] [data-act=use-party]').first().click();
  check(/more than the balance due/.test(await page.locator('tr[data-st=error]').innerText()),'bank: receipt larger than the balance due after the first receipt is an error');
  await page.check('#skiperr');await page.click('#post');await page.click('#ok');await page.waitForSelector('#again');
  const inv=await dbq(page,'invoices');check(inv.find(x=>x.id==='i1').paid===5000&&inv.find(x=>x.id==='i4').paid===7080,'receipt and payment settled the invoice and the bill (paid updated)');
  const tr=await dbq(page,'transactions'),adv=tr.find(x=>x.category==='Advance received');check(adv&&adv.party_id==='p1'&&adv.amount===1000&&adv.reference_no==='U3','advance booked to the customer with its reference',JSON.stringify(adv));
  check(tr.filter(x=>x.invoice_id).length===2&&tr.find(x=>x.invoice_id==='i1').description.includes('INV-0001'),'invoice-linked entries carry the invoice number in the narration');
  check(errs.length===0,'bank csv: no script errors',errs.join('|'));await ctx.close()}

 /* ================= Export ================= */
 { const {ctx,page,errs}=await mk({});await open(page,'import-export.html?type=sales');
  const [d]=await Promise.all([page.waitForEvent('download'),page.click('#ex button')]);const c=fs.readFileSync(await d.path(),'utf8');
  check(c.startsWith('﻿Invoice No*')&&/INV-0001,01\/09\/2026,16\/09\/2026,Alpha Traders,27AAPFU0939F1ZV,Maharashtra/.test(c),'sales export uses the same standard columns and DD/MM/YYYY dates',c.slice(0,300));
  await page.click('[data-type=bank]');await page.waitForSelector('#tpl');const [d2]=await Promise.all([page.waitForEvent('download'),page.click('#ex button')]);const c2=fs.readFileSync(await d2.path(),'utf8');
  check(/Office rent,12000,,,,,Rent/.test(c2),'bank export: payments in the Debit column (money out)',c2);
  check(errs.length===0,'export: no script errors',errs.join('|'));await ctx.close()}
 { const {ctx,page,errs}=await mk({},390);await open(page,'import-export.html?type=bank');await noScroll(page,'mobile import start');
  await page.setInputFiles('#file',{name:'b.csv',mimeType:'text/csv',buffer:Buffer.from('Date,Narration,Debit,Credit\n20/10/2026,Test,,100\n')});await page.waitForSelector('#go');await noScroll(page,'mobile map');await page.click('#go');await page.waitForSelector('#post');await noScroll(page,'mobile check');
  check(errs.length===0,'mobile: no script errors',errs.join('|'));await ctx.close()}
 await br.close();srv.close();console.log(bad?bad+' FAILED':'e2e: all checks passed');process.exit(bad?1:0)})().catch(e=>{console.error(e);process.exit(1)});
