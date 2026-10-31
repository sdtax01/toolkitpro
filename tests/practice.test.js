const PC=require('../assets/practice-core.js');let bad=0;
const t=(n,c,m)=>{if(c)console.log('PASS '+n);else{bad++;console.log('FAIL '+n+(m?': '+m:''))}};
// identifiers
t('seed GSTIN check digit is valid',PC.gstinProblem('27AAPFU0939F1ZV')==='',PC.gstinProblem('27AAPFU0939F1ZV'));
t('mistyped GSTIN is caught',/mistyped/.test(PC.gstinProblem('27AAPFU0939F1ZX')));
t('wrong length',/15 characters/.test(PC.gstinProblem('27AAPFU0939F1Z')));
t('bad state code',/state code/.test(PC.gstinProblem('50AAPFU0939F1Z'+PC.gstinCheckDigit('50AAPFU0939F1Z'))));
t('empty is fine',PC.gstinProblem('')==='');
t('PAN',PC.panProblem('ABCDE1234F')===''&&PC.panProblem('abcde1234f')===''&&PC.panProblem('ABCD1234F')!=='');
t('TAN',PC.tanProblem('PUNA12345B')===''&&PC.tanProblem('PUN12345B')!=='');
t('PAN 4th letter gives constitution',PC.kindFromPan('AAPFU0939F')==='firm'&&PC.kindFromPan('ABCPE1234F')==='individual'&&PC.kindFromPan('AAACG2115R')==='company');
// dates
t('addMonths clamps to month end and restores the anchor',PC.addMonths('2026-01-31',1,31)==='2026-02-28'&&PC.addMonths('2026-02-28',1,31)==='2026-03-31'&&PC.addMonths('2028-01-31',1,31)==='2028-02-29');
t('addMonths across year',PC.addMonths('2026-11-15',3)==='2027-02-15');
t('addDays/daysBetween',PC.addDays('2026-10-29',3)==='2026-11-01'&&PC.daysBetween('2026-10-29','2026-11-01')===3);
t('FY start year',PC.fyStartYear('2026-03-31')===2025&&PC.fyStartYear('2026-04-01')===2026);
// task rules
const mk=(o)=>Object.assign({party_id:'p1',status:'active',services:[],gst_frequency:'monthly',state_code:'27'},o);
const g=(c,a,b,ex)=>PC.generate([c],a,b,ex);
let r=g(mk({services:['gstr1','gstr3b']}),'2026-10-01','2026-10-31');
t('monthly GST: Sep returns fall due in October (11th and 20th)',r.length===2&&r.find(x=>x.service==='gstr1').due_date==='2026-10-11'&&r.find(x=>x.service==='gstr3b').due_date==='2026-10-20'&&r[0].period==='2026-09',JSON.stringify(r));
r=g(mk({services:['gstr1','gstr3b'],gst_frequency:'qrmp'}),'2026-10-01','2026-10-31');
t('QRMP: Q2 returns due 13 Oct and 22 Oct (Maharashtra)',r.length===2&&r.find(x=>x.service==='gstr1').due_date==='2026-10-13'&&r.find(x=>x.service==='gstr3b').due_date==='2026-10-22'&&r[0].period==='2026-Q2',JSON.stringify(r));
r=g(mk({services:['gstr3b'],gst_frequency:'qrmp',state_code:'07'}),'2026-10-01','2026-10-31');t('QRMP in other states: 24th',r[0].due_date==='2026-10-24');
r=g(mk({services:['gstr1']}),'2026-01-01','2026-03-31');t('three months of GSTR-1',r.length===3);
r=g(mk({services:['tds_pay']}),'2027-04-01','2027-04-30');t('TDS payment for March is due 30 April',r.length===1&&r[0].due_date==='2027-04-30'&&r[0].period==='2027-03',JSON.stringify(r));
r=g(mk({services:['tds_pay']}),'2026-11-01','2026-11-30');t('TDS payment for October due 7 Nov',r[0].due_date==='2026-11-07');
r=g(mk({services:['tds_26q','tds_24q']}),'2026-07-01','2026-07-31');t('26Q and 24Q Q1 due 31 July',r.length===2&&r.every(x=>x.due_date==='2026-07-31'&&x.period==='2026-Q1'));
r=g(mk({services:['tds_26q']}),'2027-05-01','2027-05-31');t('Q4 return due 31 May of next year, period belongs to the earlier FY',r.length===1&&r[0].period==='2026-Q4');
r=g(mk({services:['adv_tax']}),'2026-04-01','2027-03-31');t('advance tax: four instalments',r.length===4&&r.map(x=>x.due_date).join()==='2026-06-15,2026-09-15,2026-12-15,2027-03-15');
r=g(mk({services:['itr','tax_audit','roc','gstr9']}),'2026-07-01','2026-12-31');
t('annual items for the year just ended',r.map(x=>x.service+':'+x.due_date).join()==='itr:2026-07-31,tax_audit:2026-09-30,roc:2026-10-30,tax_audit:2026-10-31,roc:2026-11-29,gstr9:2026-12-31',r.map(x=>x.service+':'+x.due_date).join());
t('annual items name the right FY',r.find(x=>x.service==='itr').title==='Income-tax return for FY 2025-26');
// idempotent + status filter
const ex=[{party_id:'p1',service:'gstr1',period:'2026-09'}];
r=g(mk({services:['gstr1','gstr3b']}),'2026-10-01','2026-10-31',ex);t('existing tasks are not generated again',r.length===1&&r[0].service==='gstr3b');
t('on-hold and closed clients are skipped',g(mk({services:['gstr1'],status:'on_hold'}),'2026-10-01','2026-10-31').length===0&&g(mk({services:['gstr1'],status:'closed'}),'2026-10-01','2026-10-31').length===0);
t('no services, no tasks',g(mk({}),'2026-04-01','2027-03-31').length===0);
r=PC.generate([mk({services:['gstr3b']}),mk({party_id:'p2',services:['gstr3b']})],'2026-10-01','2026-10-31',[]);t('several clients',r.length===2&&r[0].party_id!==r[1].party_id);
t('assignee defaults from the client',PC.generate([mk({services:['gstr1'],assignee:'Asha'})],'2026-10-01','2026-10-31')[0].assignee==='Asha');
// urgency
const T=(d,s)=>({due_date:d,status:s||'pending'});
t('urgency',PC.urgency(T('2026-10-28'),'2026-10-30')==='overdue'&&PC.urgency(T('2026-11-05'),'2026-10-30')==='due_soon'&&PC.urgency(T('2026-11-06'),'2026-10-30')==='due_soon'&&PC.urgency(T('2026-11-07'),'2026-10-30')==='open'&&PC.urgency(T('2026-10-01','filed'),'2026-10-30')==='filed'&&PC.urgency(T('2026-10-01','not_applicable'),'2026-10-30')==='na');
t('due today is not overdue',PC.urgency(T('2026-10-30'),'2026-10-30')==='due_soon');
const sm=PC.summarize([T('2026-10-01'),T('2026-10-31'),{due_date:'2026-10-10',status:'filed',filed_on:'2026-10-12'},{due_date:'2026-10-10',status:'filed',filed_on:'2026-10-09'}],'2026-10-30');
t('summary counts',sm.overdue===1&&sm.due_soon===1&&sm.filed===2&&sm.filedLate===1&&sm.thisMonth===2,JSON.stringify(sm));
// recurring
const rec={active:true,frequency:'monthly',next_date:'2026-08-31',anchor_day:31};
t('recurring catches up missed months and respects month ends',PC.dueRuns(rec,'2026-11-30').join()==='2026-08-31,2026-09-30,2026-10-31,2026-11-30',PC.dueRuns(rec,'2026-11-30').join());
t('nothing due before the date',PC.dueRuns({...rec,next_date:'2026-12-01'},'2026-11-30').length===0);
t('end date stops the series',PC.dueRuns({...rec,end_date:'2026-09-30'},'2027-01-01').join()==='2026-08-31,2026-09-30');
t('inactive series gives nothing',PC.dueRuns({...rec,active:false},'2027-01-01').length===0);
t('catch-up is capped',PC.dueRuns({active:true,frequency:'monthly',next_date:'2020-01-01'},'2026-10-30').length===12);
t('quarterly and yearly',PC.dueRuns({active:true,frequency:'quarterly',next_date:'2026-04-01'},'2027-03-31').join()==='2026-04-01,2026-07-01,2026-10-01,2027-01-01'&&PC.dueRuns({active:true,frequency:'yearly',next_date:'2024-04-01'},'2026-10-30').length===3);
t('text tokens',PC.renderText('Retainer for {MONTH}','2026-09-01','monthly')==='Retainer for September 2026'&&PC.renderText('Fee {PERIOD}','2026-10-01','quarterly')==='Fee October 2026 to December 2026'&&PC.renderText('FY {FY}','2027-02-01','yearly')==='FY 2026-27');
t('recurring validation',PC.recurringIssues({}).length>=5&&PC.recurringIssues({party_id:'a',description:'x',amount:100,gst_rate:18,frequency:'monthly',next_date:'2026-11-01'}).length===0&&PC.recurringIssues({party_id:'a',description:'x',amount:100,gst_rate:18,frequency:'monthly',next_date:'2026-11-01',end_date:'2026-10-01'}).length===1);
// client checks
t('client issues: PAN must match the GSTIN',PC.clientIssues({gstin:'27AAPFU0939F1ZV',pan:'ABCDE1234F'}).some(x=>/does not match/.test(x.message))&&!PC.clientIssues({gstin:'27AAPFU0939F1ZV',pan:'AAPFU0939F'}).length);
t('client issues: TDS needs TAN, GST needs GSTIN',PC.clientIssues({services:['tds_26q']}).some(x=>x.field==='tan')&&PC.clientIssues({services:['gstr1']}).some(x=>x.field==='gstin'));
t('effective PAN comes from the GSTIN when blank',PC.effectivePan({gstin:'27AAPFU0939F1ZV'})==='AAPFU0939F'&&PC.effectivePan({pan:'abcde1234f'})==='ABCDE1234F');
t('gaps',PC.clientGaps({}).join()==='PAN,services,contact'&&PC.clientGaps({pan:'ABCDE1234F',services:['gstr1'],contact_phone:'1'}).length===0);
console.log(bad?bad+' FAILED':'practice: all checks passed');process.exit(bad?1:0);
