/* Toolkit Pro - reporting helpers (pure functions: no DOM, no database). Used by ageing / statement / daily pages and by tests/phase1.test.js.
   Money is handled as integer paise internally and returned in rupees rounded to 2 decimals. */
const TP=(()=>{
 const paise=n=>{n=+n||0;return Math.round(n*100+(n<0?-1e-9:1e-9))},rup=p=>p/100+0;
 const dnum=s=>{const[y,m,d]=String(s).slice(0,10).split('-').map(Number);return Date.UTC(y,m-1,d)/864e5};
 const diff=(a,b)=>Math.round(dnum(a)-dnum(b)),addDays=(s,n)=>new Date((dnum(s)+n)*864e5).toISOString().slice(0,10);
 const BUCKETS=[['cur','Not yet due'],['b1','1-30 days'],['b2','31-60 days'],['b3','61-90 days'],['b4','Over 90 days']];
 const bucketOf=od=>od<=0?'cur':od<=30?'b1':od<=60?'b2':od<=90?'b3':'b4';
 const empty=()=>({cur:0,b1:0,b2:0,b3:0,b4:0,total:0});
 const fin=o=>{const r={};for(const k in o)r[k]=rup(o[k]);return r};

 /* Outstanding by party in ageing buckets. Days overdue = asOf - due date (invoice date when there is no due date). */
 function ageing(invoices,parties,kind,asOf){
  const pm=new Map((parties||[]).map(p=>[p.id,p])),map=new Map(),tot=empty();let noDue=0,count=0;
  for(const x of invoices||[]){
   if(x.kind!==kind)continue;const bal=paise(x.amount)-paise(x.paid);if(bal<=0)continue;
   if(!x.due_date)noDue++;
   const od=diff(asOf,x.due_date||x.date),b=bucketOf(od);count++;
   let r=map.get(x.party_id);if(!r){const p=pm.get(x.party_id);r={id:x.party_id,name:p?p.name:'(deleted contact)',party:p||null,b:empty(),invoices:[],oldest:0};map.set(x.party_id,r)}
   r.b[b]+=bal;r.b.total+=bal;tot[b]+=bal;tot.total+=bal;if(od>r.oldest)r.oldest=od;
   r.invoices.push({id:x.id,number:x.number,date:x.date,due:x.due_date||null,balance:rup(bal),overdueDays:Math.max(0,od),bucket:b});
  }
  const rows=[...map.values()].map(r=>{const o=r.b.total-r.b.cur;return{...r,overdue:rup(o),b:fin(r.b),oldest:Math.max(0,r.oldest)}}).sort((u,v)=>v.b.total-u.b.total||u.name.localeCompare(v.name));
  rows.forEach(r=>r.invoices.sort((u,v)=>v.overdueDays-u.overdueDays));
  return{rows,totals:fin(tot),overdue:rup(tot.total-tot.cur),count,noDue,asOf};
 }

 /* Party statement: invoices raise the balance, linked payments reduce it. Optional from/to (inclusive, YYYY-MM-DD). */
 function statement(party,invoices,txns,from,to){
  const sale=party.kind==='client'?'sale':'purchase',mine=(invoices||[]).filter(x=>x.party_id===party.id&&x.kind===sale),ids=new Set(mine.map(x=>x.id));
  const ev=[];let seq=0;
  for(const x of mine)ev.push({date:x.date,ord:0,seq:seq++,type:'Invoice',ref:x.number,billed:paise(x.amount),paid:0});
  const linked=new Map();
  for(const t of txns||[]){if(!ids.has(t.invoice_id))continue;linked.set(t.invoice_id,(linked.get(t.invoice_id)||0)+paise(t.amount));
   ev.push({date:t.date,ord:1,seq:seq++,type:'Payment',ref:t.description||'',billed:0,paid:paise(t.amount)})}
  ev.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:a.ord-b.ord||a.seq-b.seq);
  let bal=0,opening=0,billed=0,paid=0;const rows=[];
  for(const e of ev){
   if(from&&e.date<from){bal+=e.billed-e.paid;opening=bal;continue}
   if(to&&e.date>to)continue;
   bal+=e.billed-e.paid;billed+=e.billed;paid+=e.paid;rows.push({date:e.date,type:e.type,ref:e.ref,billed:rup(e.billed),paid:rup(e.paid),balance:rup(bal)});
  }
  const mismatches=mine.filter(x=>paise(x.paid)!==(linked.get(x.id)||0)).map(x=>({number:x.number,recorded:rup(paise(x.paid)),linked:rup(linked.get(x.id)||0)}));
  const outstandingNow=rup(mine.reduce((s,x)=>s+paise(x.amount)-paise(x.paid),0));
  return{opening:rup(opening),billed:rup(billed),paid:rup(paid),closing:rup(bal),rows,mismatches,outstandingNow};
 }

 /* One-day business summary. t = transactions, a = accounts, i = invoices, r = reminders. */
 function daily(date,t,a,i,p,r){
  const sum=(l,ty)=>l.filter(x=>x.type===ty).reduce((s,x)=>s+paise(x.amount),0),mo=date.slice(0,7);
  const day=t.filter(x=>x.date===date),mtd=t.filter(x=>x.date.startsWith(mo)&&x.date<=date),upto=t.filter(x=>x.date<=date);
  const accounts=a.map(x=>{const l=upto.filter(y=>y.account_id===x.id);return{id:x.id,name:x.name,balance:rup(paise(x.opening)+sum(l,'income')-sum(l,'expense'))}});
  const un=upto.filter(x=>!x.account_id),unassigned=rup(sum(un,'income')-sum(un,'expense'));
  const cash=rup(accounts.reduce((s,x)=>s+paise(x.balance),0)+paise(unassigned));
  const due=kind=>{const l=(i||[]).filter(x=>x.kind===kind&&paise(x.amount)-paise(x.paid)>0&&x.date<=date),od=l.filter(x=>diff(date,x.due_date||x.date)>0),soon=l.filter(x=>{const d=diff(x.due_date||x.date,date);return d>=0&&d<=7}),s=q=>rup(q.reduce((z,x)=>z+paise(x.amount)-paise(x.paid),0));
   return{overdueCount:od.length,overdue:s(od),soonCount:soon.length,soon:s(soon)}};
  const topDebtors=ageing((i||[]).filter(x=>x.date<=date),p||[],'sale',date).rows.filter(x=>x.overdue>0).sort((u,v)=>v.overdue-u.overdue).slice(0,5);
  const rem=(r||[]).filter(x=>!x.done&&x.due_date<=addDays(date,7)).sort((u,v)=>u.due_date<v.due_date?-1:1);
  return{date,income:rup(sum(day,'income')),expense:rup(sum(day,'expense')),net:rup(sum(day,'income')-sum(day,'expense')),
   mtdIncome:rup(sum(mtd,'income')),mtdExpense:rup(sum(mtd,'expense')),mtdNet:rup(sum(mtd,'income')-sum(mtd,'expense')),
   accounts,unassigned,cash,receivables:due('sale'),payables:due('purchase'),topDebtors,reminders:rem,entries:day};
 }

 /* CSV text. Cells that start with = + - @ (formula characters) are neutralised so spreadsheets never run them. */
 const cell=v=>{if(v==null)return'';if(typeof v==='number')return String(v);let s=String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return/[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
 const csv=rows=>rows.map(r=>r.map(cell).join(',')).join('\r\n');
 function download(name,rows){if(typeof document==='undefined')return;const b=new Blob(['﻿'+csv(rows)],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
 const fyStart=d=>{const y=+d.slice(0,4),m=+d.slice(5,7);return(m>=4?y:y-1)+'-04-01'};

 /* ---------------- Ledger reports (Phase 2). lines = journal lines joined with their journal: {gl_account_id, debit, credit, entry_date, journal_no, party_id} ---------------- */
 const DR_TYPES={asset:1,expense:1},natural=(type,d,c)=>DR_TYPES[type]?d-c:c-d,side=(bal,type)=>bal===0?'':((bal>0)===!!DR_TYPES[type]?'Dr':'Cr');
 const codeCmp=(a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true});
 const jno=n=>'JV-'+String(n).padStart(6,'0');

 function trialBalance(accts,lines,asOf){
  const m=new Map((accts||[]).map(a=>[a.id,{a,d:0,c:0}]));
  for(const l of lines||[]){if(asOf&&l.entry_date>asOf)continue;const r=m.get(l.gl_account_id);if(!r)continue;r.d+=paise(l.debit);r.c+=paise(l.credit)}
  let td=0,tc=0;
  const rows=[...m.values()].sort((x,y)=>codeCmp(x.a,y.a)).map(({a,d,c})=>{const net=d-c,dr=net>0?net:0,cr=net<0?-net:0;td+=dr;tc+=cr;
   return{id:a.id,code:a.code,name:a.name,type:a.type,active:a.is_active!==false,debit:rup(dr),credit:rup(cr),movementDr:rup(d),movementCr:rup(c)}});
  return{rows,totalDebit:rup(td),totalCredit:rup(tc),balanced:td===tc,difference:rup(td-tc),asOf:asOf||null};
 }

 function generalLedger(acct,lines,from,to){
  const mine=(lines||[]).filter(l=>l.gl_account_id===acct.id).sort((x,y)=>x.entry_date<y.entry_date?-1:x.entry_date>y.entry_date?1:(x.journal_no-y.journal_no)||String(x.id).localeCompare(String(y.id)));
  let open=0,bal=0,td=0,tc=0;const rows=[];
  for(const l of mine){const d=paise(l.debit),c=paise(l.credit),n=natural(acct.type,d,c);
   if(from&&l.entry_date<from){open+=n;bal=open;continue}
   if(to&&l.entry_date>to)continue;
   bal+=n;td+=d;tc+=c;rows.push({date:l.entry_date,journalNo:l.journal_no,journalId:l.journal_id,narration:l.narration||'',kind:l.kind||'',sourceTable:l.source_table||null,sourceId:l.source_id||null,memo:l.memo||'',debit:rup(d),credit:rup(c),balance:rup(bal),side:side(bal,acct.type)})}
  return{opening:rup(open),openingSide:side(open,acct.type),rows,totalDebit:rup(td),totalCredit:rup(tc),closing:rup(bal),closingSide:side(bal,acct.type)};
 }

 function dayBook(journals,lines,accts,from,to){
  const am=new Map((accts||[]).map(a=>[a.id,a])),by=new Map();
  for(const l of lines||[]){if(!by.has(l.journal_id))by.set(l.journal_id,[]);by.get(l.journal_id).push(l)}
  return(journals||[]).filter(j=>(!from||j.entry_date>=from)&&(!to||j.entry_date<=to))
   .sort((x,y)=>x.entry_date<y.entry_date?-1:x.entry_date>y.entry_date?1:x.journal_no-y.journal_no)
   .map(j=>{const ls=(by.get(j.id)||[]).map(l=>({code:am.get(l.gl_account_id)?.code||'',name:am.get(l.gl_account_id)?.name||'(unknown account)',debit:rup(paise(l.debit)),credit:rup(paise(l.credit)),memo:l.memo||''}));
    return{...j,label:jno(j.journal_no),lines:ls,total:rup(ls.reduce((s,l)=>s+paise(l.debit),0))}});
 }

 /* Client-side check before posting a manual journal (the database re-checks everything). */
 function validateJournal(lines){
  const errors=[];let d=0,c=0,n=0;
  for(const [i,l] of (lines||[]).entries()){const dr=paise(l.debit),cr=paise(l.credit);if(!l.account_id&&!dr&&!cr)continue;n++;
   if(!l.account_id)errors.push('Line '+(i+1)+': choose an account');
   if(dr<0||cr<0)errors.push('Line '+(i+1)+': amounts cannot be negative');
   if(dr>0&&cr>0)errors.push('Line '+(i+1)+': use either debit or credit, not both');
   if(!dr&&!cr)errors.push('Line '+(i+1)+': enter an amount');
   d+=dr;c+=cr}
  if(n<2)errors.push('Add at least two lines');
  if(d!==c)errors.push('Debit and credit must be equal');
  return{ok:!errors.length,debit:rup(d),credit:rup(c),diff:rup(d-c),errors};
 }

 /* Ledger vs sub-ledgers. Differences point at data to review (manual journals, unsynced rows, or paid amounts that disagree with linked payments). */
 function reconcile({lines,accts,invoices,txns,bankAccounts}){
  const sys=new Map((accts||[]).filter(a=>a.system_key).map(a=>[a.system_key,a])),ids=k=>sys.get(k)?.id;
  const net=(pred)=>(lines||[]).filter(pred).reduce((s,l)=>s+paise(l.debit)-paise(l.credit),0);
  const out=(kind)=>(invoices||[]).filter(x=>x.kind===kind).reduce((s,x)=>s+paise(x.amount)-paise(x.paid),0);
  const mk=(name,l,b)=>({name,ledger:rup(l),books:rup(b),diff:rup(l-b),ok:l===b});
  const rec=mk('Debtors (accounts receivable) vs unpaid sales invoices',net(l=>l.gl_account_id===ids('receivables')),out('sale'));
  const pay=mk('Creditors (accounts payable) vs unpaid bills',-net(l=>l.gl_account_id===ids('payables')),out('purchase'));
  const banks=(bankAccounts||[]).map(b=>{const g=(accts||[]).find(a=>a.bank_account_id===b.id),t=(txns||[]).filter(x=>x.account_id===b.id);
   const books=paise(b.opening)+t.reduce((s,x)=>s+(x.type==='income'?1:-1)*paise(x.amount),0);return mk('Bank: '+b.name,g?net(l=>l.gl_account_id===g.id):0,books)});
  const t0=(txns||[]).filter(x=>!x.account_id),cash=mk('Cash in hand (entries with no bank account)',net(l=>l.gl_account_id===ids('cash')),t0.reduce((s,x)=>s+(x.type==='income'?1:-1)*paise(x.amount),0));
  const tb=trialBalance(accts,lines);
  // per-party receivable/payable differences
  const parties=[];for(const [key,kind,sign] of [['receivables','sale',1],['payables','purchase',-1]]){const g=ids(key),led=new Map(),sub=new Map();
   for(const l of lines||[]){if(l.gl_account_id!==g||!l.party_id)continue;led.set(l.party_id,(led.get(l.party_id)||0)+sign*(paise(l.debit)-paise(l.credit)))}
   for(const x of invoices||[]){if(x.kind!==kind)continue;sub.set(x.party_id,(sub.get(x.party_id)||0)+paise(x.amount)-paise(x.paid))}
   for(const id of new Set([...led.keys(),...sub.keys()])){const a=led.get(id)||0,b=sub.get(id)||0;if(a!==b)parties.push({party_id:id,kind,ledger:rup(a),books:rup(b),diff:rup(a-b)})}}
  return{checks:[rec,pay,...banks,cash],trialBalanceBalanced:tb.balanced,partyDifferences:parties,allOk:tb.balanced&&[rec,pay,...banks,cash].every(c=>c.ok)&&!parties.length};
 }
 return{paise,rup,diff,addDays,BUCKETS,bucketOf,ageing,statement,daily,csv,download,fyStart,natural,side,jno,trialBalance,generalLedger,dayBook,validateJournal,reconcile};
})();
if(typeof module!=='undefined')module.exports=TP;
