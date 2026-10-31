// Browser test of Client master, Compliance tracker, Recurring invoices and GST Returns against the in-memory fake Supabase.
// Run: NODE_PATH=$(npm root -g) node tests/practice-e2e.js [screenshotDir]
const {chromium}=require('playwright'),http=require('http'),fs=require('fs'),path=require('path'),stub=require('./fake-supabase.js');
const root=path.join(__dirname,'..'),shots=process.argv[2]||null;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'};
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(root,p);if(!f.startsWith(root)||!fs.existsSync(f)){s.writeHead(404);return s.end()}s.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s)});
const seed=()=>({settings:[{id:'s',business_name:'Shree Digitax Solutions',gstin:'27AAPFU0939F1ZV',state:'Maharashtra',default_gst:18,doc_series:null}],
 parties:[{id:'p1',kind:'client',name:'Alpha Traders',state:'Maharashtra',gstin:'27AAPFU0939F1ZV'},{id:'p2',kind:'client',name:'Beta Works',state:'Karnataka'},{id:'s1',kind:'supplier',name:'Supply Co',state:'Maharashtra',gstin:'27AAACS1111A1Z5'}],
 accounts:[{id:'a1',name:'HDFC Bank',opening:50000}],
 invoices:[{id:'i1',party_id:'p1',kind:'sale',number:'INV-0001',date:'2026-09-01',due_date:'2026-09-16',amount:11800,paid:0,adjusted:0,taxable:10000,gst_rate:18,cgst:900,sgst:900,igst:0,hsn_sac:'998231'},{id:'i4',party_id:'s1',kind:'purchase',number:'BILL-0001',date:'2026-09-02',due_date:'2026-09-17',amount:7080,paid:0,adjusted:0,taxable:6000,gst_rate:18,cgst:540,sgst:540,igst:0}],
 transactions:[],reminders:[],assets:[],budgets:[],goals:[],documents:[],gst_notes:[],client_master:[],compliance_tasks:[],recurring_invoices:[]});
let bad=0;const fail=(n,m)=>{bad++;console.log('FAIL '+n+': '+m)},pass=n=>console.log('PASS '+n);const check=(c,n,m)=>c?pass(n):fail(n,m||'');
(async()=>{await new Promise(r=>srv.listen(0,r));const port=srv.address().port,br=await chromium.launch();
 const mk=async(opts,w,mod,keep)=>{const ctx=await br.newContext({viewport:{width:w||1366,height:900},acceptDownloads:true}),page=await ctx.newPage(),errs=[];
  page.on('pageerror',e=>errs.push('pageerror: '+e.message));page.on('console',m=>{if(m.type()==='error'&&!/favicon|Failed to load resource/.test(m.text()))errs.push('console: '+m.text())});
  try{await page.clock.install({time:new Date('2026-10-31T10:00:00')})}catch(_){}
  await page.route('**/assets/vendor/supabase.js*',r=>r.fulfill({contentType:'text/javascript',body:stub(keep||(()=>{const d=seed();if(mod)mod(d);return d})(),opts)}));
  await page.route('**/*',r=>/^http:\/\/127\.0\.0\.1/.test(r.request().url())?r.fallback():r.abort());page.on('dialog',d=>d.accept());return{ctx,page,errs}};
 const open=async(page,u)=>{await page.goto(`http://127.0.0.1:${port}/${u}`);await page.waitForFunction(()=>document.querySelector('#main')&&document.querySelector('#main').getAttribute('aria-busy')==='false',null,{timeout:8000})};
 const shot=async(page,n)=>{if(shots){fs.mkdirSync(shots,{recursive:true});await page.screenshot({path:path.join(shots,n+'.png'),fullPage:true})}};
 const noScroll=async(page,n)=>check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),n+': no horizontal page scroll');
 const dbq=(page,t)=>page.evaluate(t=>window.__DB[t],t);const snap=page=>page.evaluate(()=>JSON.stringify(window.__DB));
 const text=page=>page.evaluate(()=>document.querySelector('#main').innerText);

 /* ---------- missing migration ---------- */
 for(const pg of ['clients','compliance','recurring']){const {ctx,page,errs}=await mk({missingTables:['client_master','compliance_tasks','recurring_invoices']});await open(page,pg+'.html');
  check(/023_practice_suite\.sql/.test(await text(page)),pg+': without migration 023 the page says what to run');check(errs.length===0,pg+' (no migration): no script errors',errs.join('|'));await ctx.close()}

 /* ---------- clients + compliance + recurring in one session (state carried through a shared DB) ---------- */
 let kept=null;
 { const {ctx,page,errs}=await mk({});await open(page,'clients.html');
  check(/Alpha Traders/.test(await text(page))&&/Beta Works/.test(await text(page))&&!/Supply Co/.test(await text(page)),'clients: customers listed, suppliers not');
  await noScroll(page,'clients');
  await page.click('[data-edit=p1]');await page.waitForSelector('.modal #f');
  check(await page.inputValue('.modal [name=pan]')==='AAPFU0939F','client form: PAN is suggested from the GSTIN');
  await page.fill('.modal [name=pan]','ABCDE1234F');await page.locator('.modal [name=svc][value=gstr1]').check();await page.click('.modal button:has-text("Save")');
  check(/does not match the PAN/.test(await page.locator('.modal #err').innerText()),'client form: PAN that disagrees with the GSTIN is refused');
  await page.fill('.modal [name=pan]','AAPFU0939F');
  await page.locator('.modal [name=svc][value=gstr3b]').check();await page.locator('.modal [name=svc][value=tds_26q]').check();await page.click('.modal button:has-text("Save")');
  check(/TAN is needed/.test(await page.locator('.modal #err').innerText()),'client form: TDS service without a TAN is refused');
  await page.fill('.modal [name=tan]','puna12345b');await page.fill('.modal [name=fee_amount]','5000');await page.click('.modal button:has-text("Save")');
  check(/billed/.test(await page.locator('.modal #err').innerText())||/how often/.test(await page.locator('.modal #err').innerText()),'client form: a fee needs a billing cycle');
  await page.selectOption('.modal [name=fee_cycle]','monthly');await page.fill('.modal [name=assignee]','Asha');await page.fill('.modal [name=extra]','27AAACS1111A1ZA, Maharashtra, Pune branch');await page.click('.modal button:has-text("Save")');await page.waitForTimeout(400);if(process.env.DBG)console.log('ERR:',await page.locator('.modal #err').innerText().catch(()=>'(no modal)'));
  let cm=await dbq(page,'client_master');check(cm.length===1&&cm[0].pan==='AAPFU0939F'&&cm[0].tan==='PUNA12345B'&&cm[0].services.join()==='gstr1,gstr3b,tds_26q'&&cm[0].fee_amount===5000&&cm[0].extra_gstins[0].label==='Pune branch','client saved with PAN, TAN, services, fee and extra GSTIN',JSON.stringify(cm));
  check((await dbq(page,'parties')).find(p=>p.id==='p1').pan==='AAPFU0939F','PAN also written to the customer record');
  check(/GSTR-1/.test(await text(page))&&/5,000\.00/.test(await text(page))&&/Asha/.test(await text(page)),'list shows services, fee and assignee');
  // add client
  await page.click('#cnew');await page.fill('.modal [name=name]','Gamma Consulting');await page.fill('.modal [name=gstin]','27AAPFU0939F1ZX');await page.click('.modal button:has-text("Add and set up")');
  check(/mistyped/.test(await page.locator('.modal #err').innerText()),'add client: mistyped GSTIN refused (check digit)');
  await page.fill('.modal [name=gstin]','GAMMAGSTIN');await page.click('.modal button:has-text("Add and set up")');check(/15 characters/.test(await page.locator('.modal #err').innerText()),'add client: short GSTIN refused');await page.fill('.modal [name=gstin]','29AAACG1234H1ZW');await page.click('.modal button:has-text("Add and set up")');await page.waitForSelector('.modal [name=svc]');
  check((await dbq(page,'parties')).some(p=>p.name==='Gamma Consulting'&&p.kind==='client'),'add client: customer created and the profile opens');
  await page.locator('.modal [name=svc][value=gstr1]').check();await page.locator('.modal [name=svc][value=gstr3b]').check();await page.selectOption('.modal [name=gst_frequency]','qrmp');await page.click('.modal button:has-text("Save")');await page.waitForTimeout(400);
  check((await dbq(page,'client_master')).length===2,'second client profile saved');
  await page.click('#cexp').catch(()=>{});
  check(errs.length===0,'clients: no script errors',errs.join('|'));await shot(page,'clients');
  // compliance on the same DB
  kept=JSON.parse(await snap(page));await ctx.close()}
 { const {ctx,page,errs}=await mk({},0,null,kept);await open(page,'compliance.html');
  check(/Nothing here/.test(await text(page)),'compliance: empty to start with');
  await page.click('#gen');await page.waitForSelector('.modal #f');await page.fill('.modal [name=from]','2026-10-01');await page.fill('.modal [name=to]','2026-10-31');
  await page.waitForTimeout(150);const pv=await page.locator('.modal #pv').innerText();
  check(/4 task\(s\)/.test(pv)||/\d+ task\(s\)/.test(pv),'generate: preview counts tasks',pv);
  const n0=pv.match(/(\d+) task/)[1];
  await page.click('.modal #go');await page.waitForTimeout(600);
  const T=await dbq(page,'compliance_tasks');
  check(T.some(t=>t.service==='gstr1'&&t.period==='2026-09'&&t.due_date==='2026-10-11'&&t.party_id==='p1'&&t.assignee==='Asha'),'monthly GSTR-1 for September due 11 Oct, assigned from the client',JSON.stringify(T.map(t=>t.service+t.period+t.due_date)));
  check(T.some(t=>t.service==='gstr1'&&t.period==='2026-Q2'&&t.due_date==='2026-10-13'&&t.party_id!=='p1')&&T.some(t=>t.service==='gstr3b'&&t.period==='2026-Q2'&&t.due_date==='2026-10-22'),'QRMP client gets quarterly dates (13 and 22 Oct)');
  check(T.length===+n0,'exactly the previewed number of tasks created');
  check(/Overdue/.test(await text(page))&&(await page.locator('tr:has-text("GSTR-3B")').count())>=1,'overdue tasks appear in the list');
  await shot(page,'compliance');
  // second generate: nothing new
  await page.click('#gen');await page.waitForSelector('.modal #f');await page.fill('.modal [name=from]','2026-10-01');await page.fill('.modal [name=to]','2026-10-31');await page.waitForTimeout(150);
  check(/Nothing new/.test(await page.locator('.modal #pv').innerText()),'generate again: nothing new (no duplicates)');await page.click('.modal #cx');
  // mark filed via status select
  const sel=page.locator('select[data-st]').first();const tid=await sel.getAttribute('data-st');await sel.selectOption('filed');await page.waitForSelector('.modal #f');
  await page.fill('.modal [name=filed_on]','');await page.click('.modal button:has-text("Save")');check(/date it was filed/.test(await page.locator('.modal #err').innerText()),'filing needs a filed date');
  await page.fill('.modal [name=filed_on]','2026-10-30');await page.fill('.modal [name=ack_no]','AA2709261234567');await page.click('.modal button:has-text("Save")');await page.waitForTimeout(400);
  const ft=(await dbq(page,'compliance_tasks')).find(t=>t.id===tid);check(ft.status==='filed'&&ft.filed_on==='2026-10-30'&&ft.ack_no==='AA2709261234567','task marked filed with date and acknowledgement');
  await page.selectOption('#ftab','filed');check(/AA2709261234567/.test(await text(page))&&/filed late/.test(await text(page)),'filed tab shows the ARN and flags late filing');
  // add manual task
  await page.selectOption('#ftab','all');await page.click('#add');await page.fill('.modal [name=title]','Renew professional tax registration');await page.fill('.modal [name=due_date]','2026-11-30');await page.click('.modal button:has-text("Save")');await page.waitForTimeout(400);
  check((await dbq(page,'compliance_tasks')).some(t=>t.title==='Renew professional tax registration'&&t.party_id===null),'manual firm task added');
  await noScroll(page,'compliance');
  check(errs.length===0,'compliance: no script errors',errs.join('|'));kept=JSON.parse(await snap(page));await ctx.close()}

 /* ---------- recurring ---------- */
 { const {ctx,page,errs}=await mk({},0,null,kept);await open(page,'recurring.html');
  check(/No recurring invoices yet/.test(await text(page))&&await page.locator('#run').isDisabled(),'recurring: empty and nothing to run');
  await page.click('#new');await page.selectOption('.modal [name=party_id]','p1');await page.waitForTimeout(100);
  check(await page.inputValue('.modal [name=amount]')==='5000'&&await page.inputValue('.modal [name=frequency]')==='monthly','new recurring: fee and cycle come from the client master');
  await page.fill('.modal [name=next_date]','2026-09-01');await page.waitForTimeout(100);check(/5,900\.00/.test(await page.locator('.modal #tot').innerText()),'new recurring: invoice total with GST shown (5,900)');
  await page.fill('.modal [name=amount]','0');await page.click('.modal button:has-text("Save")');await page.waitForTimeout(100);
  check(await page.locator('.modal').count()===1,'zero fee is not accepted');await page.fill('.modal [name=amount]','5000');await page.click('.modal button:has-text("Save")');await page.waitForTimeout(400);
  let rr=(await dbq(page,'recurring_invoices'));check(rr.length===1&&rr[0].anchor_day===1&&rr[0].next_date==='2026-09-01'&&rr[0].active===true,'recurring invoice saved');
  check(!(await page.locator('#run').isDisabled())&&/Due now/.test(await text(page)),'two months are due now (Sep and Oct)');
  await page.click('#run');await page.waitForSelector('.modal #pv table');
  const pvt=await page.locator('.modal #pv').innerText();check(/INV-0002/.test(pvt)&&/INV-0003/.test(pvt)&&/September 2026/.test(pvt)&&/October 2026/.test(pvt)&&/2 invoice\(s\)/.test(pvt)&&/11,800\.00/.test(pvt),'preview lists INV-0002 and INV-0003 with the month in the description and total 11,800',pvt);
  check((await dbq(page,'invoices')).length===2,'nothing is created before confirming');
  await page.click('.modal #go');await page.waitForTimeout(800);
  const inv=await dbq(page,'invoices'),a=inv.find(x=>x.number==='INV-0002'),b=inv.find(x=>x.number==='INV-0003');
  check(a&&b&&a.date==='2026-09-01'&&b.date==='2026-10-01'&&a.amount===5900&&a.cgst===450&&a.sgst===450&&a.due_date==='2026-09-16'&&a.party_id==='p1'&&a.kind==='sale'&&/September 2026/.test(a.description),'two invoices created: dated, numbered in sequence, CGST+SGST, due after 15 days',JSON.stringify(a));
  rr=await dbq(page,'recurring_invoices');check(rr[0].next_date==='2026-11-01'&&rr[0].last_number==='INV-0003'&&rr[0].run_count===2&&rr[0].last_date==='2026-10-01','schedule advanced to 1 Nov with last number and count',JSON.stringify(rr[0]));
  await page.waitForTimeout(300);check(await page.locator('#run').isDisabled(),'nothing due afterwards (cannot create twice)');
  await page.click('[data-p]');await page.waitForTimeout(300);check((await dbq(page,'recurring_invoices'))[0].active===false&&/Paused/.test(await text(page)),'pause works');
  await noScroll(page,'recurring');await shot(page,'recurring');check(errs.length===0,'recurring: no script errors',errs.join('|'));kept=JSON.parse(await snap(page));await ctx.close()}
 { // month-end anchor
  const {ctx,page,errs}=await mk({},0,d=>{d.recurring_invoices.push({id:'r9',party_id:'p2',description:'Fee {MONTH}',hsn_sac:'998231',amount:1000,gst_rate:18,frequency:'monthly',next_date:'2026-08-31',anchor_day:31,due_days:0,active:true,run_count:0})});
  await open(page,'recurring.html');await page.click('#run');await page.waitForSelector('.modal #pv table');await page.fill('.modal #upto','2026-11-30');await page.dispatchEvent('.modal #upto','change');await page.waitForTimeout(500);
  const t=await page.locator('.modal #pv').innerText();check(/2026-08-31/.test(t)&&/2026-09-30/.test(t)&&/2026-10-31/.test(t)&&/2026-11-30/.test(t)&&/IGST|Karnataka|1,180\.00/.test(t),'month-end fees: 31 Aug, 30 Sep, 31 Oct, 30 Nov; inter-state client total 1,180',t.slice(0,300));
  await page.click('.modal #go');await page.waitForTimeout(900);const r9=(await dbq(page,'recurring_invoices'))[0],iv=(await dbq(page,'invoices')).filter(x=>/^INV-/.test(x.number));
  check(r9.next_date==='2026-12-31'&&r9.run_count===4&&iv.find(x=>x.date==='2026-09-30').igst===180,'anchor day kept: next is 31 Dec; Karnataka client charged IGST',JSON.stringify(r9));
  check(errs.length===0,'recurring (anchor): no script errors',errs.join('|'));await ctx.close()}
 { // posting failure keeps the schedule untouched
  const {ctx,page,errs}=await mk({},0,d=>{d.invoices.push({id:'i9',party_id:'p1',kind:'sale',number:'INV-0002',date:'2026-10-01',amount:1,paid:0,adjusted:0});d.recurring_invoices.push({id:'r8',party_id:'p1',description:'Fee',amount:1000,gst_rate:18,frequency:'monthly',next_date:'2026-10-01',anchor_day:1,due_days:0,active:true,run_count:0})});
  await open(page,'recurring.html');await page.click('#run');await page.waitForSelector('.modal #pv table');
  // the app picks INV-0003 (next free), so force a clash by pre-inserting it after the preview
  await page.evaluate(()=>window.__DB.invoices.push({id:'i10',party_id:'p1',kind:'sale',number:'INV-0003',date:'2026-10-01',amount:1,paid:0,adjusted:0}));
  await page.click('.modal #go');await page.waitForTimeout(800);
  check(/problem/.test(await page.locator('.modal').innerText())&&(await dbq(page,'recurring_invoices'))[0].next_date==='2026-10-01'&&(await dbq(page,'recurring_invoices'))[0].run_count===0,'a failed invoice leaves the schedule unchanged and reports the problem');await ctx.close()}

 /* ---------- GST returns ---------- */
 { const {ctx,page,errs}=await mk({});await open(page,'gst-returns.html');await page.fill('#mo','2026-09');await page.dispatchEvent('#mo','change');await page.waitForTimeout(200);
  let t=await text(page);check(/INV-0001/.test(t)&&/10,000\.00/.test(t)&&/Check before you file/.test(t),'GSTR-1: September invoice appears in B2B with warnings section');
  await noScroll(page,'gst returns');await shot(page,'gstr1');
  const [x]=await Promise.all([page.waitForEvent('download'),page.click('#x1')]);const xf=await x.path();check(fs.statSync(xf).size>1000&&/GSTR1-202609\.xlsx/.test(x.suggestedFilename()),'GSTR-1 Excel downloads');
  const [j]=await Promise.all([page.waitForEvent('download'),page.click('#j1')]);const js=JSON.parse(fs.readFileSync(await j.path(),'utf8'));check(js.fp==='092026'&&js.b2b[0].ctin==='27AAPFU0939F1ZV'&&js.b2b[0].inv[0].inum==='INV-0001'&&js.b2b[0].inv[0].itms[0].itm_det.camt===900&&js.gstin==='27AAPFU0939F1ZV','GSTR-1 JSON has the invoice with CGST 900');
  await page.click('[data-t=gstr3b]');await page.waitForTimeout(200);t=await text(page);
  check(/Cash to pay/.test(t)&&/720\.00/.test(t)&&/1,800\.00/.test(t)&&/1,080\.00/.test(t),'GSTR-3B: output tax 1,800, ITC 1,080, cash 720',t.slice(0,500));
  const [x3]=await Promise.all([page.waitForEvent('download'),page.click('#x3')]);check(fs.statSync(await x3.path()).size>800,'GSTR-3B Excel downloads');
  await page.click('[data-t=recon]');await page.waitForSelector('#f2');
  const j2b={data:{gstin:'27AAPFU0939F1ZV',rtnprd:'092026',docdata:{b2b:[{ctin:'27AAACS1111A1Z5',trdnm:'Supply Co',inv:[{inum:'BILL-0001',dt:'02-09-2026',val:7080,itcavl:'Y',items:[{num:1,rt:18,txval:6000,cgst:540,sgst:540}]},{inum:'ZZ-5',dt:'04-09-2026',val:1180,itcavl:'Y',items:[{num:1,rt:18,txval:1000,cgst:90,sgst:90}]}]}]}}};
  await page.setInputFiles('#f2',{name:'2b.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(j2b))});await page.waitForSelector('#rb [data-f]');t=await text(page);
  check(/Matched \(1\)/.test(t)&&/In 2B, not in books \(1\)/.test(t)&&/In 2B, not yet booked\s*₹180\.00/.test(t),'2B: BILL-0001 matched, ZZ-5 reported as not booked (180 ITC)',t.slice(0,600));
  await page.click('[data-f=only2b]');check(/ZZ-5/.test(await text(page))&&/Book this bill/.test(await text(page)),'2B: the unbooked bill is listed with what to do');
  await page.setInputFiles('#f2',{name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"a":1}')});await page.waitForTimeout(200);check(/No B2B/.test(await page.locator('#ferr').innerText()),'2B: wrong file gives a clear message');
  const j2c={...j2b,data:{...j2b.data,gstin:'29AAACR5055K1Z5'}};await page.setInputFiles('#f2',{name:'other.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(j2c))});await page.waitForTimeout(200);check(/belongs to GSTIN/.test(await page.locator('#ferr').innerText()),'2B: a file for another GSTIN is refused');
  const csv='GSTIN of supplier,Trade/Legal name,Invoice number,Invoice date,Taxable Value,Integrated Tax,Central Tax,State/UT Tax\n27AAACS1111A1Z5,Supply Co,BILL-0001,02-09-2026,6000,0,500,500\n';
  await page.setInputFiles('#f2',{name:'2b.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForTimeout(400);if(process.env.DBG)console.log('FERR:',await page.locator('#ferr').innerText());await page.waitForFunction(()=>/from 2b\.csv/.test(document.querySelector('#main').innerText));await page.click('[data-f=mismatch]');t=await text(page);check(/BILL-0001/.test(t)&&/Ask the supplier/.test(t)&&/80\.00/.test(t),'2B CSV: tax difference of 80 shown as a mismatch',t.slice(-900));
  const [xr]=await Promise.all([page.waitForEvent('download'),page.click('#xr')]);check(fs.statSync(await xr.path()).size>800,'reconciliation Excel downloads');await shot(page,'recon');
  check(errs.length===0,'gst returns: no script errors',errs.join('|'));
  check(JSON.stringify(await dbq(page,'invoices'))===JSON.stringify(seed().invoices),'GST returns changed nothing in the books');await ctx.close()}
 { const {ctx,page,errs}=await mk({},390);for(const u of ['clients','compliance','recurring','gst-returns']){await open(page,u+'.html');await noScroll(page,'mobile '+u)}check(errs.length===0,'mobile: no script errors',errs.join('|'));await ctx.close()}
 await br.close();srv.close();console.log(bad?bad+' FAILED':'practice e2e: all checks passed');process.exit(bad?1:0)})().catch(e=>{console.error(e);process.exit(1)});
