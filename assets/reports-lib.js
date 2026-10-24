/* Toolkit Pro - reporting helpers (pure functions: no DOM, no database). Used by ageing / statement / daily pages and by tests/phase1.test.js.
   Money is handled as integer paise internally and returned in rupees rounded to 2 decimals. */
const TP=(()=>{
 const paise=n=>{n=+n||0;return Math.round(n*100+(n<0?-1e-9:1e-9))},rup=p=>p/100;
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
 return{paise,rup,diff,addDays,BUCKETS,bucketOf,ageing,statement,daily,csv,download,fyStart};
})();
if(typeof module!=='undefined')module.exports=TP;
