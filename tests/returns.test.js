const GR=require('../assets/gst-returns.js'),PC=require('../assets/practice-core.js'),IM=require('../assets/import-core.js'),fs=require('fs'),os=require('os'),cp=require('child_process');
global.PC=PC;let bad=0;const t=(n,c,m)=>{if(c)console.log('PASS '+n);else{bad++;console.log('FAIL '+n+(m?': '+m:''))}};
const S={gstin:'27AAPFU0939F1ZV',state:'Maharashtra'};
const parties=[{id:'r1',name:'Reg Local',kind:'client',gstin:'27AAACR5055K1Z7',state:'Maharashtra',gst_type:'regular'},{id:'r2',name:'Reg Inter',kind:'client',gstin:'29AAACR5055K1Z5',state:'Karnataka',gst_type:'regular'},{id:'u1',name:'Consumer Local',kind:'client',state:'Maharashtra',gst_type:'unregistered'},{id:'u2',name:'Consumer Far',kind:'client',state:'Delhi',gst_type:'unregistered'},{id:'x1',name:'Foreign Co',kind:'client',gst_type:'overseas'},{id:'s1',name:'Supplier One',kind:'supplier',gstin:'27AAACS1111A1Z5',state:'Maharashtra',gst_type:'regular'},{id:'s2',name:'Supplier Two',kind:'supplier',gstin:'29AAACS2222B1Z3',state:'Karnataka',gst_type:'regular'}];
const inv=(o)=>Object.assign({kind:'sale',gst_rate:18,cgst:0,sgst:0,igst:0,hsn_sac:'998231',description:'Consulting'},o);
const sale=[
 inv({id:'a1',number:'INV-0001',date:'2026-10-02',party_id:'r1',taxable:10000,cgst:900,sgst:900,amount:11800}),
 inv({id:'a2',number:'INV-0002',date:'2026-10-03',party_id:'r2',taxable:20000,igst:3600,amount:23600,place_of_supply:'Karnataka'}),
 inv({id:'a3',number:'INV-0003',date:'2026-10-04',party_id:'u1',taxable:5000,cgst:450,sgst:450,amount:5900}),
 inv({id:'a4',number:'INV-0004',date:'2026-10-05',party_id:'u2',taxable:300000,igst:54000,amount:354000,place_of_supply:'Delhi'}),
 inv({id:'a5',number:'INV-0005',date:'2026-10-06',party_id:'u2',taxable:1000,igst:180,amount:1180,place_of_supply:'Delhi'}),
 inv({id:'a6',number:'INV-0007',date:'2026-10-07',party_id:'x1',taxable:50000,igst:0,gst_rate:0,amount:50000}),
 inv({id:'a7',number:'INV-0008',date:'2026-10-08',party_id:'r1',taxable:2000,gst_rate:0,amount:2000,hsn_sac:'9954'}),
 inv({id:'a8',number:'INV-0009',date:'2026-09-30',party_id:'r1',taxable:999,cgst:90,sgst:90,amount:1179}),
];
const buy=[
 inv({id:'b1',kind:'purchase',number:'BILL/001',date:'2026-10-05',party_id:'s1',taxable:10000,cgst:900,sgst:900,amount:11800}),
 inv({id:'b2',kind:'purchase',number:'B-2',date:'2026-10-06',party_id:'s2',taxable:5000,igst:900,amount:5900}),
 inv({id:'b3',kind:'purchase',number:'B-3',date:'2026-10-07',party_id:'s1',taxable:1000,cgst:90,sgst:90,amount:1180,itc_blocked:true}),
 inv({id:'b4',kind:'purchase',number:'B-4',date:'2026-10-08',party_id:'s1',taxable:2000,cgst:180,sgst:180,amount:2360,reverse_charge:true}),
];
const notes=[{id:'n1',kind:'credit',invoice_id:'a1',number:'CN-0001',date:'2026-10-20',taxable:1000,cgst:90,sgst:90,igst:0,amount:1180,reason:'return'},
 {id:'n2',kind:'credit',invoice_id:'a5',number:'CN-0002',date:'2026-10-21',taxable:500,cgst:0,sgst:0,igst:90,amount:590,reason:'rate'},
 {id:'n3',kind:'credit',invoice_id:'a4',number:'CN-0003',date:'2026-10-22',taxable:10000,cgst:0,sgst:0,igst:1800,amount:11800,reason:'disc'},
 {id:'n4',kind:'debit',invoice_id:'b1',number:'DN-0001',date:'2026-10-25',taxable:1000,cgst:90,sgst:90,igst:0,amount:1180,reason:'return'}];
const D={settings:S,parties,invoices:[...sale,...buy],notes,items:[]};
const r=GR.gstr1(D,'2026-10-01','2026-10-31');
t('B2B has the two registered customers',r.b2b.length===2&&r.b2b.find(x=>x.number==='INV-0002').pos==='29'&&r.b2b.find(x=>x.number==='INV-0001').pos==='27',JSON.stringify(r.b2b.map(x=>x.number+':'+x.pos)));
t('B2B excludes September invoice and nil-rated line',!r.b2b.find(x=>x.number==='INV-0009')&&!r.b2b.find(x=>x.number==='INV-0008'));
t('B2CL: unregistered inter-state above 2.5 lakh',r.b2cl.length===1&&r.b2cl[0].number==='INV-0004'&&r.b2cl[0].pos==='07');
t('B2CS consolidates local consumer sale and the small inter-state sale',r.b2cs.length===2&&r.b2cs.find(x=>x.type==='INTRA').taxable===5000&&r.b2cs.find(x=>x.type==='INTER').taxable===1000-500,JSON.stringify(r.b2cs));
t('credit note to a consumer is netted in B2CS (500 off the 1000)',r.b2cs.find(x=>x.type==='INTER').igst===90);
t('CDNR for registered, CDNUR for the large consumer invoice',r.cdnr.length===1&&r.cdnr[0].number==='CN-0001'&&r.cdnr[0].ntty==='C'&&r.cdnur.length===1&&r.cdnur[0].number==='CN-0003'&&r.cdnur[0].urType==='B2CL');
t('nil table: local registered 2000',r.nil[0].taxable===2000&&r.nil.reduce((s,x)=>s+x.taxable,0)===2000);
t('export invoice listed separately',r.exp.length===1&&r.exp[0].number==='INV-0007'&&r.exp[0].taxable===50000);
t('HSN summary rolls up by code and rate',r.hsn.find(x=>x.hsn==='998231'&&x.rate===18).taxable===10000+20000+5000+300000+1000&&r.hsn.find(x=>x.hsn==='998231').uqc==='NA'&&r.hsn.find(x=>x.hsn==='9954'&&x.rate===0));
const d1=r.docs.find(x=>x.label==='Invoices for outward supply');
t('document series with gap detection (INV-0006 missing)',d1.from==='INV-0001'&&d1.to==='INV-0008'&&d1.total===7&&d1.gaps===1,JSON.stringify(d1));
t('warns about the gap',r.warnings.some(w=>/not in your books/.test(w.message)));
t('totals',r.totals.b2b.taxable===30000&&r.totals.b2b.igst===3600&&r.totals.invoices===7,JSON.stringify(r.totals.b2b));
// wrong tax split warning
const D2={...D,invoices:[inv({id:'z',number:'Z-1',date:'2026-10-02',party_id:'r2',taxable:100,cgst:9,sgst:9,amount:118,place_of_supply:'Karnataka'})],notes:[]};
t('warns when an inter-state invoice carries CGST/SGST',GR.gstr1(D2,'2026-10-01','2026-10-31').warnings.some(w=>/inter-state.*CGST/.test(w.message)));
// multi-line items drive the rows
const D3={...D,invoices:[inv({id:'m',number:'M-1',date:'2026-10-02',party_id:'r1',taxable:1500,cgst:51.25,sgst:51.25,amount:1602.5})],notes:[],items:[{invoice_id:'m',line_no:1,description:'A',hsn_sac:'998231',quantity:1,taxable:1000,gst_rate:18,cgst:90,sgst:90,igst:0},{invoice_id:'m',line_no:2,description:'B',hsn_sac:'998311',quantity:1,taxable:500,gst_rate:5,cgst:12.5,sgst:12.5,igst:0}]};
const r3=GR.gstr1(D3,'2026-10-01','2026-10-31');
t('multi-rate invoice: one B2B invoice, two rate rows',r3.b2b.length===1&&r3.b2b[0].rows.length===2&&r3.b2b[0].rows[1].rate===5&&r3.hsn.length===2);
// JSON
const j=GR.gstr1Json(r,'27AAPFU0939F1ZV');
t('GSTR-1 JSON structure',j.fp==='102026'&&j.b2b.length===2&&j.b2b[0].inv[0].itms[0].itm_det.rt===18&&j.b2b[0].inv[0].idt==='02-10-2026'&&j.b2cs[0].typ==='OE'&&j.cdnr[0].nt[0].ntty==='C'&&j.hsn.data.length===r.hsn.length&&j.doc_issue.doc_det[0].docs[0].from==='INV-0001'&&j.b2cl[0].pos==='07',JSON.stringify(Object.keys(j)));
t('JSON round-trips',JSON.parse(JSON.stringify(j)).b2b[1].ctin.length===15);
// 3B
const b=GR.gstr3b(D,'2026-10-01','2026-10-31');
// outward: a1 10000, a2 20000, a3 5000, a4 300000, a5 1000 less notes n1(1000) n2(500) n3(10000)
const tx=10000+20000+5000+300000+1000-1000-500-10000;
t('3.1(a) taxable value and taxes net of credit notes',b.t31.a.taxable===tx&&b.t31.a.igst===3600+54000+180-90-1800&&b.t31.a.cgst===900+450-90&&b.t31.a.sgst===900+450-90,JSON.stringify(b.t31.a));
t('3.1(b) export, 3.1(c) nil',b.t31.b.taxable===50000&&b.t31.c.taxable===2000);
t('3.1(d) reverse charge bill',b.t31.d.taxable===2000&&b.t31.d.cgst===180);
t('4(A)(5) excludes blocked and RCM bills',b.t4.a5.igst===900&&b.t4.a5.cgst===900&&b.t4.a5.sgst===900&&b.t4.ineligible.cgst===90);
t('4(A)(3) RCM credit and 4(B)(2) debit-note reversal',b.t4.a3.cgst===180&&b.t4.b2.cgst===90);
t('net ITC',b.t4.net.cgst===900+180-90&&b.t4.net.igst===900);
t('3.2 inter-state to consumers by place of supply',b.t32.unreg.length===1&&b.t32.unreg[0].pos==='07'&&b.t32.unreg[0].taxable===300000+1000-500-10000);
// set-off checks
const so=GR.setoff({igst:1000,cgst:500,sgst:500},{igst:600,cgst:300,sgst:100},{igst:0,cgst:0,sgst:0});
t('set-off: IGST credit pays IGST first, then CGST, then SGST',so.itcUsed.igst.igst===600&&so.itcUsed.igst.cgst===0,JSON.stringify(so.itcUsed));
t('set-off: CGST credit pays CGST then IGST; SGST credit pays SGST then IGST (never each other)',so.itcUsed.cgst.cgst===300&&so.itcUsed.sgst.sgst===100&&so.cash.igst===400&&so.cash.cgst===200&&so.cash.sgst===400,JSON.stringify(so.cash));
const so2=GR.setoff({igst:0,cgst:100,sgst:100},{igst:150,cgst:0,sgst:0},{igst:0,cgst:0,sgst:0});
t('set-off: IGST credit clears CGST then SGST',so2.itcUsed.igst.cgst===100&&so2.itcUsed.igst.sgst===50&&so2.cash.sgst===50&&so2.carryForward.igst===0);
const so3=GR.setoff({igst:0,cgst:0,sgst:0},{igst:0,cgst:50,sgst:50},{igst:0,cgst:30,sgst:0});
t('set-off: reverse-charge tax is always cash and credit is carried forward',so3.cash.cgst===30&&so3.carryForward.cgst===50);
t('3B payment adds up',Math.abs((b.t61.outward.igst+b.t61.outward.cgst+b.t61.outward.sgst+b.t61.rcm.igst+b.t61.rcm.cgst+b.t61.rcm.sgst)-(b.totals.cash+(b.t4.net.igst+b.t4.net.cgst+b.t4.net.sgst)-(b.t61.carryForward.igst+b.t61.carryForward.cgst+b.t61.carryForward.sgst)))<0.01,JSON.stringify(b.t61));
const bj=GR.gstr3bJson(b,'27AAPFU0939F1ZV');t('3B JSON',bj.ret_period==='102026'&&bj.sup_details.osup_det.txval===tx&&bj.itc_elg.itc_avl[4].ty==='OTH'&&bj.inter_sup.unreg_details[0].pos==='07');
t('3B warns about RCM bills',b.warnings.some(w=>/reverse charge/.test(w.message)));
// sheets & xlsx
const sh=GR.gstr1Sheets(r);t('sheets exist',sh.B2B.length===1+2&&sh.HSN.length>1&&sh.Documents.length===1+1+1+0,Object.keys(sh).map(k=>k+':'+sh[k].length).join());
const x=GR.toXlsx({...sh,...GR.gstr3bSheet(b)});const f=os.tmpdir()+'/gr-test.xlsx';fs.writeFileSync(f,x);
let py='';try{py=cp.execSync(`python3 -c "import openpyxl;wb=openpyxl.load_workbook('${f}');print(','.join(wb.sheetnames));ws=wb['B2B'];print(ws['A1'].value,ws['C2'].value,ws['J2'].value)"`).toString()}catch(e){py='ERR '+e.message}
t('xlsx opens in Excel-compatible readers',/B2B,B2CL,B2CS/.test(py)&&/GSTIN of recipient INV-/.test(py.replace(/\n/g,' ')),py);
IM.readXlsx(new Uint8Array(x)).then(rows=>{t('xlsx reads back with the app\'s own reader',rows[0].cells[0]==='GSTIN of recipient');next()});
function next(){
// 2B
const json2b={data:{gstin:'27AAPFU0939F1ZV',rtnprd:'102026',docdata:{b2b:[
 {ctin:'27AAACS1111A1Z5',trdnm:'Supplier One',inv:[{inum:'BILL/001',dt:'05-10-2026',val:11800,pos:'27',rev:'N',itcavl:'Y',items:[{num:1,rt:18,txval:10000,igst:0,cgst:900,sgst:900,cess:0}]},{inum:'X-77',dt:'09-10-2026',val:1180,itcavl:'Y',items:[{num:1,rt:18,txval:1000,cgst:90,sgst:90}]}]},
 {ctin:'29AAACS2222B1Z3',trdnm:'Supplier Two',inv:[{inum:'B2',dt:'06-10-2026',val:5900,itcavl:'Y',items:[{num:1,rt:18,txval:5000,igst:810,cgst:0,sgst:0}]}]}],
 cdnr:[{ctin:'27AAACS1111A1Z5',trdnm:'Supplier One',nt:[{ntnum:'DN-0001',typ:'C',dt:'25-10-2026',val:1180,items:[{txval:1000,cgst:90,sgst:90}]}]}]}}};
const p=GR.parse2BJson(JSON.stringify(json2b));
t('2B JSON parsed with notes and item sums',p.rows.length===4&&p.rows[0].taxable===10000&&p.rows[0].cgst===900&&p.rows[3].note&&p.period==='102026'&&p.rows[0].date==='2026-10-05');
const rc=GR.reconcile2B(D,p.rows,'2026-10-01','2026-10-31');
t('matching ignores case, dashes and leading zeros (BILL/001 vs BILL/001, B-2 vs B2)',rc.matched.some(x=>x.books.number==='BILL/001')&&rc.mismatch.some(x=>x.books.number==='B-2'),JSON.stringify(rc.summary));
t('tax difference is reported',rc.mismatch[0].taxDiff===-90,JSON.stringify(rc.mismatch[0].taxDiff));
t('note matched against the purchase debit note',rc.matched.some(x=>x.books.note&&x.books.number==='DN-0001'));
t('in 2B but not in books',rc.only2b.length===1&&rc.only2b[0].gst2b.number==='X-77'&&rc.summary.unbooked===180);
t('in books but not in 2B: blocked and RCM bills are explained and do not count as ITC at risk',rc.onlyBooks.length===2&&rc.onlyBooks.every(x=>x.reason)&&rc.summary.atRisk===0,JSON.stringify(rc.onlyBooks.map(x=>x.reason)));
const D4={...D,invoices:[...D.invoices,inv({id:'b9',kind:'purchase',number:'LATE-1',date:'2026-10-10',party_id:'s1',taxable:3000,cgst:270,sgst:270,amount:3540})]};
const rc4=GR.reconcile2B(D4,p.rows,'2026-10-01','2026-10-31');t('ITC at risk = tax on bills the supplier has not reported',rc4.summary.atRisk===540);
const D5={...D,invoices:[...D.invoices,inv({id:'b8',kind:'purchase',number:'Z-X-99',date:'2026-10-09',party_id:'s1',taxable:1000,cgst:90,sgst:90,amount:1180})]};
const rc5=GR.reconcile2B(D5,p.rows,'2026-10-01','2026-10-31');t('probable match: same amount and date but different number',rc5.probable.length===1&&rc5.probable[0].gst2b.number==='X-77'&&rc5.only2b.length===0);
const sup=rc4.suppliers.find(s=>s.gstin==='27AAACS1111A1Z5');t('supplier-wise summary',sup&&sup.atRisk===540&&sup.matched>=1);
t('reconciliation sheets',GR.reconSheets(rc4).Reconciliation.length>=1+5&&GR.reconSheets(rc4).Suppliers.length>=3);
// table input
const tbl=[['GSTR-2B','','','',''],['Statement for Oct 2026'],['GSTIN of supplier','Trade/Legal name','Invoice number','Invoice date','Invoice Value (₹)','Taxable Value (₹)','Integrated Tax(₹)','Central Tax(₹)','State/UT Tax(₹)','ITC Availability'],['27AAACS1111A1Z5','Supplier One','BILL/001','05-Oct-2026','11,800.00','10,000.00','0','900','900','Yes'],['','Total']];
const pt=GR.parse2BTable(tbl);t('2B spreadsheet with title lines and rupee formatting',pt.rows.length===1&&pt.rows[0].taxable===10000&&pt.rows[0].date==='2026-10-05'&&pt.rows[0].igst===0);
let e1='';try{GR.parse2BTable([['a','b'],[1,2]])}catch(e){e1=e.message}t('clear error for a wrong file',/Could not find the columns/.test(e1));
let e2='';try{GR.parse2BJson('{"x":1}')}catch(e){e2=e.message}t('clear error for wrong JSON',/No B2B/.test(e2));
let e3='';try{GR.parse2BJson('not json')}catch(e){e3=e.message}t('clear error for bad JSON',/not valid JSON/.test(e3));
t('CSV export guards formulas',GR.toCSV([['=1+1','ok','-5','-x']])==="'=1+1,ok,-5,'-x");
console.log(bad?bad+' FAILED':'returns: all checks passed');process.exit(bad?1:0)}
