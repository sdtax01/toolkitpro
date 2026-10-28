const SUPABASE_URL='https://dpgkabvyappujokiujoh.supabase.co',SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZ2thYnZ5YXBwdWpva2l1am9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NzA5MzUsImV4cCI6MjEwNzA0NjkzNX0.iz4f1JYG3Sav4tLWDH1GPjXPxAD-U87ecRYrZKx8KLA';
const db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
try{const pc=document.createElement('link');pc.rel='preconnect';pc.href=SUPABASE_URL;pc.crossOrigin='';document.head.appendChild(pc)}catch(_){}
const $=s=>document.querySelector(s);
const inr=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
/* Money: amounts are INR, held as integer paise for arithmetic, rounded half-up to 2 decimals, stored as numeric(.,2). */
const paise=n=>Math.round((+n||0)*100+(n<0?-1e-9:1e-9)),rup=p=>p/100+0;
/* GST rates offered. 3 and 40 added for the current rate structure; 12 and 28 stay so old documents can still be edited. Confirm the rate for your goods/services with your CA. */
const RATES=[0,3,5,12,18,28,40];
/*NAV-START*/
/* Sidebar: ONE definition, rendered by boot() on every page. Items are [label, href, optional sub-items]. Every href is relative (GitHub Pages safe) and must point at an existing page; tests/nav.test.js checks this.
   Items with a #hash jump to a section of an existing page; they are not separate copies of the data. */
const NAV=[
 {t:'Dashboard',h:'index.html',i:'home'},
 {g:'sales',t:'Sales',i:'sales',c:[['Customers','customers.html?kind=client'],['Sales Invoices','invoices.html?kind=sale'],['Credit Notes','notes.html?kind=credit'],['Debtors Ageing','ageing.html?kind=sale'],['Customer Statements','statement.html?kind=client']]},
 {g:'purchases',t:'Purchases',i:'purchases',c:[['Suppliers','customers.html?kind=supplier'],['Purchase Bills','invoices.html?kind=purchase'],['Debit Notes','notes.html?kind=debit'],['Creditors Ageing','ageing.html?kind=purchase'],['Supplier Statements','statement.html?kind=supplier']]},
 {g:'accounting',t:'Accounting',i:'accounting',c:[['Transactions','transactions.html'],['Banking','banking.html'],['Bank Reconciliation','bank-rec.html'],['Closing Stock','stock.html'],['Fixed Assets','fixed-assets.html'],['Other Assets','assets.html'],['Budgets','budgets.html'],['Financial Goals','goals.html']]},
 {g:'tax',t:'Tax & Compliance',i:'tax',c:[['GST & Taxes','taxes.html'],['Credit / Debit Notes','notes.html'],['TDS Entries','tds.html'],['Documents & Uploads','documents.html'],['Compliance Calendar','calendar.html'],['Reminders','reminders.html']]},
 {g:'reports',t:'Reports & Insights',i:'reports',c:[['Reports Dashboard','reports.html'],['Monthly / Financial Year Analysis','reports.html#monthly'],['Business Overview','overview.html'],['Daily Summary','daily.html']]},
 {g:'books',t:'Books of Accounts',i:'books',c:[['Trial Balance','trial-balance.html'],['General Ledger','ledger.html'],['Cash Book','ledger.html?book=cash'],['Day Book','daybook.html'],['Journal Entry (Manual Posting)','journal-new.html'],['Profit & Loss','profit-loss.html'],['Balance Sheet','balance-sheet.html'],['Financial Statements (Schedule III)','statements.html',[['Balance Sheet','statements.html#sch-bs'],['Statement of Profit and Loss','statements.html#sch-pl'],['Cash Flow Statement','statements.html#sch-cf']]],['Year-end Review','year-end.html'],['Chart of Accounts','coa.html'],['Ledger Setup','ledger-setup.html']]},
 {g:'settings',t:'Settings',i:'settings',c:[['Company Profile','settings.html#company'],['Business & GST Details','settings.html#gst'],['Application Settings','settings.html#app'],['Voice Assistant','settings.html#voice']]}
];
/* Detail pages belong to a menu item: party.html is a customer/supplier, invoice.html and invoice-new.html are a sales invoice/purchase bill. */
const navAlias=(f,q)=>f==='party.html'?['customers.html',{kind:q.kind==='supplier'?'supplier':'client'}]:(f==='invoice.html'||f==='invoice-new.html')?['invoices.html',{kind:q.kind==='purchase'?'purchase':'sale'}]:f==='statement.html'?['statement.html',{kind:q.kind==='supplier'?'supplier':'client'}]:[f,q];
const navLeaves=()=>NAV.flatMap(n=>n.c?n.c.flatMap(([l,h,s])=>[[l,h,n.g],...(s||[]).map(([l2,h2])=>[l2,h2,n.g])]):[[n.t,n.h,'']]);
/* Returns the href of the menu item that matches the page: same file, every query parameter of the item present with the same value, and the #hash when the item has one. The most specific match wins. */
function navFind(file,query,hash,act){
 const[f,q]=navAlias(file||'index.html',query);let best=null,sc=-1,any=null;
 for(const[,h]of navLeaves()){const[p,hs]=h.split('#'),[pf,ps]=p.split('?'),pq=new URLSearchParams(ps||'');
  if(pf!==f)continue;if(!any)any=h;let ok=true,s=0;pq.forEach((v,k)=>{if(q[k]===v)s++;else ok=false});
  if(!ok)continue;if(hs){if('#'+hs!==hash)continue;s+=.5}
  if(s>sc){sc=s;best=h}}
 return best||any||(act&&navLeaves().some(l=>l[1]===act)?act:null)}
const NAVI={home:'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',sales:'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6',purchases:'M6 6h15l-1.5 9h-12z M6 6L5 3H2 M9 20h.01 M18 20h.01',accounting:'M3 7a2 2 0 0 1 2-2h13v4 M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z M16 14h.01',tax:'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',reports:'M4 20h16 M7 20v-6 M12 20V6 M17 20v-9',books:'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',settings:'M4 6h9 M17 6h3 M4 12h3 M11 12h9 M4 18h11 M19 18h1 M15 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M9 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'};
const navIcon=k=>`<svg class=ni viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${NAVI[k]}"/></svg>`;
const NAVCHEV='<svg class=nc viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';
const navSaved=()=>{try{return JSON.parse(localStorage.getItem('tp.nav')||'[]')}catch(_){return[]}};
const navSave=l=>{try{localStorage.setItem('tp.nav',JSON.stringify(l))}catch(_){}};
function navHTML(on){
 const open=new Set(navSaved()),lk=(l,h,c)=>`<a href="${h}" class="${c||''}${h===on?' on':''}"${h===on?' aria-current="page"':''}>${l}</a>`;
 return NAV.map(n=>{if(!n.c)return`<a href="${n.h}" class="nt${n.h===on?' on':''}"${n.h===on?' aria-current="page"':''}>${navIcon(n.i)}<span>${n.t}</span></a>`;
  const has=n.c.some(([,h,s])=>h===on||(s||[]).some(x=>x[1]===on)),o=has||open.has(n.g);
  return`<div class="ngw${has?' has':''}" data-g="${n.g}"><button type=button class=ng id="nv-b-${n.g}" aria-expanded="${o}" aria-controls="nv-${n.g}">${navIcon(n.i)}<span>${n.t}</span>${NAVCHEV}</button><div class=nsub id="nv-${n.g}" role=group aria-labelledby="nv-b-${n.g}"${o?'':' hidden'}>${n.c.map(([l,h,s])=>lk(l,h)+(s?`<div class=nsub2>${s.map(([l2,h2])=>lk(l2,h2)).join('')}</div>`:'')).join('')}</div></div>`}).join('')}
/*NAV-END*/
const Q=new URLSearchParams(location.search);
const inr2=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const stat=x=>{const o=paise(x.amount)-paise(x.paid)-paise(x.adjusted);if(o<=0)return['Paid','ok'];if(x.due_date&&days(x.due_date)<0)return['Overdue','od'];return(+x.paid>0||+x.adjusted>0)?['Partially paid','pp']:['Unpaid','du']};
const badge=x=>{const[t,c]=stat(x);return`<span class="bd ${c}">${t}</span>`};
async function fixGst(list,S,p){const ans=prompt('GST rate % for these invoices ('+RATES.join(', ')+')',S.default_gst??18);if(ans===null)return false;const r=+ans;if(!RATES.includes(r)){alert('Enter one of: '+RATES.join(', '));return false}
 const incl=confirm('Do the existing amounts already include GST?\nOK = included (total stays the same)\nCancel = GST is extra (total increases)');
 for(const x of list){const a=+x.amount,tv=incl?+(a/(1+r/100)).toFixed(2):a,g=gst(tv,r,S,p.find(y=>y.id===x.party_id)),tax=incl?rup(paise(a)-paise(tv)):rup(paise(g.cgst)+paise(g.sgst)+paise(g.igst)),hp=Math.floor(paise(tax)/2),c=g.igst?{cgst:0,sgst:0,igst:tax}:{cgst:rup(hp),sgst:rup(paise(tax)-hp),igst:0};
  if(!(await ok(db.from('invoices').update({taxable:tv,gst_rate:r,...c,amount:rup(paise(tv)+paise(tax))}).eq('id',x.id))))return false}toast('GST updated');return true}
/* Supabase returns at most 1000 rows per request. Below that nothing changes; at 1000 rows we re-read every page in a stable order so nothing is silently cut off. */
const fetchAll=async mk=>{const f=await mk();if(f.error)throw f.error;const d=f.data||[];if(d.length<1000)return d;let out=[];for(let o=0;;o+=1000){const r=await mk().order('id').range(o,o+999);if(r.error)throw r.error;out=out.concat(r.data||[]);if((r.data||[]).length<1000)break}return out};
let LP=null;const load0=async()=>{const q=n=>fetchAll(()=>db.from(n).select('*'));const[t,a,p,i,r,h,s,b,g,d]=await Promise.all(['transactions','accounts','parties','invoices','reminders','assets','settings','budgets','goals','documents'].map(q));return{t,a,p,i,r,h,S:s[0]||{},b,g,d}};
const load=()=>LP||load0();
const sum=(l,t)=>l.filter(x=>x.type===t).reduce((s,x)=>s+paise(x.amount),0)/100;
const bal=(a,t)=>a.map(x=>{const l=t.filter(y=>y.account_id===x.id);return{...x,inc:sum(l,'income'),exp:sum(l,'expense'),bal:rup(paise(x.opening)+paise(sum(l,'income'))-paise(sum(l,'expense')))}});
const owed=(i,k)=>i.filter(x=>x.kind===k).reduce((s,x)=>s+paise(x.amount)-paise(x.paid)-paise(x.adjusted),0)/100;
const spent=(t,c,mo)=>t.filter(x=>x.type==='expense'&&x.date.startsWith(mo)&&(x.category||'').trim().toLowerCase()===c.trim().toLowerCase()).reduce((s,x)=>s+paise(x.amount),0)/100;
const days=d=>Math.round((new Date(d)-new Date(today()))/864e5);
const due=d=>{const n=days(d);return n<0?`Overdue ${-n}d`:n===0?'Due today':`Due in ${n} days`};
const taxOf=x=>(+x.cgst||0)+(+x.sgst||0)+(+x.igst||0);
/* GSTIN: 15 characters, first two = state code, last = check character. stCode() reads the state code only when the GSTIN is well formed. */
const GSTIN_CH='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gstinOk=g=>{g=String(g||'').trim().toUpperCase();if(!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g))return false;let s=0;for(let i=0;i<14;i++){let v=GSTIN_CH.indexOf(g[i])*(i%2?2:1);s+=Math.floor(v/36)+v%36}return g[14]===GSTIN_CH[(36-s%36)%36]};
const stCode=g=>{g=String(g||'').trim().toUpperCase();return/^\d{2}[A-Z0-9]{13}$/.test(g)?g.slice(0,2):null};
/* Blank is fine. A GSTIN that fails the format/check-digit test asks for confirmation (it never blocks, so existing work is not hampered). */
const gstinGate=g=>{g=String(g||'').trim();return!g||gstinOk(g)||confirm('This GSTIN looks invalid (format or check digit). Save it anyway?')};
/* Inter-state when the two GSTIN state codes differ; if either GSTIN is missing/malformed, fall back to comparing the State names as before. */
const isInter=(S,P)=>{const a=stCode(S?.gstin),b=stCode(P?.gstin);if(a&&b)return a!==b;return!!(S?.state&&P?.state&&S.state.trim().toLowerCase()!==P.state.trim().toLowerCase())};
/* CGST and SGST are each half the rate on the taxable value and are always equal (each rounded half-up to the paisa); IGST is the full rate. */
const gst=(taxable,rate,S,P)=>{const tp=paise(taxable);if(isInter(S,P))return{cgst:0,sgst:0,igst:rup(Math.round(tp*rate/100+1e-9))};const h=Math.round(tp*rate/200+1e-9);return{cgst:rup(h),sgst:rup(h),igst:0}};
const bar=(v,max)=>{const p=max?v/max*100:0;return`<div class=bar><i class="${p>100?'dn':''}" style="width:${Math.min(100,p)}%"></i></div>`};
const ok=async p=>{const r=await p;if(r.error){alert(r.error.message);return false}return true};
const toast=m=>{const d=document.createElement('div');d.className='toast';d.setAttribute('role','status');d.setAttribute('aria-live','polite');d.textContent=m;document.body.appendChild(d);setTimeout(()=>d.remove(),3500)};
/* Double-submit guard: one in-flight save per form, buttons disabled meanwhile (idempotent against double clicks/Enter). */
const guard=async(f,fn)=>{if(!f||f.dataset.busy)return;f.dataset.busy=1;f.setAttribute('aria-busy','true');const bs=[...f.querySelectorAll('button')],pv=bs.map(b=>b.disabled);bs.forEach(b=>b.disabled=true);try{return await fn()}finally{delete f.dataset.busy;f.removeAttribute('aria-busy');bs.forEach((b,i)=>b.disabled=pv[i])}};
/* True when a Supabase RPC has not been installed yet (migrations not run): callers fall back to the older client-side flow. */
const noFn=e=>!!e&&(e.code==='PGRST202'||e.code==='42883'||/could not find the function|schema cache/i.test(e.message||''));
/* ---- Ledger helpers (Phase 2). Everything degrades gracefully when the ledger tables are not installed. ---- */
const noTable=e=>!!e&&(e.code==='42P01'||e.code==='PGRST205'||/does not exist|schema cache|could not find the table/i.test(e.message||''));
const loadLedger=async()=>{const s=await db.from('ledger_settings').select('*').limit(1);
 if(s.error){if(noTable(s.error))return{missing:true};throw s.error}
 const st=(s.data||[])[0]||null;if(!st||!st.posting_enabled)return{missing:false,ready:false,settings:st};
 const[accts,journals,lines]=await Promise.all([fetchAll(()=>db.from('gl_accounts').select('*')),fetchAll(()=>db.from('journals').select('*')),fetchAll(()=>db.from('journal_lines').select('*'))]);
 const jm=new Map(journals.map(j=>[j.id,j]));
 return{missing:false,ready:true,settings:st,accts,journals,lines:lines.map(l=>{const j=jm.get(l.journal_id)||{};return{...l,entry_date:j.entry_date,journal_no:j.journal_no,narration:j.narration,kind:j.kind,source_table:j.source_table,source_id:j.source_id}})}};
/* Income/Expense heads that can be chosen on an invoice or bill. {on:false} until migration 014 is installed and the ledger has accounts. */
const loadHeads=async(kind,keep)=>{const off={on:false,heads:[],name:()=>''};try{
 const c=await db.from('invoices').select('gl_account_id').limit(1);if(c.error)return off;
 const g=await db.from('gl_accounts').select('*');if(g.error||!(g.data||[]).length)return off;
 const all=g.data,ty=kind==='sale'?'income':'expense',sys=kind==='sale'?'sales':'purchases',byId=new Map(all.map(a=>[a.id,a])),
  full=a=>{const o=[a.name];let p=a.parent_id&&byId.get(a.parent_id),n=0;while(p&&n++<10){o.unshift(p.name);p=p.parent_id&&byId.get(p.parent_id)}return o.join(' › ')},
  heads=all.filter(a=>a.type===ty&&a.system_key!==sys&&(a.is_active||a.id===keep)).sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true})).map(a=>({id:a.id,code:a.code,label:full(a)+(a.is_active?'':' (inactive)')}));
 return{on:heads.length>0,heads,name:id=>{const a=byId.get(id);return a?full(a):''}}}catch(e){return off}};
const ledgerGate=(m,L)=>{if(L.missing){m.innerHTML='<div class=card role=status><h3>Ledger not installed yet</h3><p>The ledger tables have not been added to your database. Run <b>010_ledger_core.sql</b>, <b>011_ledger_posting.sql</b> and <b>012_ledger_functions.sql</b> from the <code>supabase/migrations</code> folder in the Supabase SQL Editor, then reload. Everything else keeps working without it.</p></div>';return true}
 if(!L.ready){m.innerHTML='<div class=card role=status><h3>Ledger not set up yet</h3><p>Your books have not been switched on. Nothing has been changed in your existing data.</p><a class=btn href="ledger-setup.html">Go to Ledger Setup</a></div>';return true}return false};
const jsrc=(t,id,inv)=>t==='invoices'?'invoice.html?id='+id+'&kind='+((inv||[]).find(x=>x.id===id)?.kind||'sale'):t==='transactions'?'transactions.html':t==='accounts'?'banking.html':'';
/* Period lock pre-check for multi-step edits (the database enforces it too; this avoids half-finished two-step saves). */
const lockedBlock=async(...ds)=>{try{const r=await db.from('ledger_settings').select('locked_through,posting_enabled').limit(1),s=r.error?null:(r.data||[])[0];
 if(!s||!s.posting_enabled||!s.locked_through)return false;const b=ds.filter(Boolean).map(String).find(d=>d<=s.locked_through);
 if(b){alert('The date '+b+' is in a locked period (up to '+s.locked_through+'). Ask the owner to unlock it in Ledger Setup, or use a later date.');return true}return false}catch(_){return false}};
const mail=async(to,s,b)=>{if(!to){alert('Add an email address for this contact first.');return}
 const{error}=await db.functions.invoke('send-mail',{body:{to,subject:s,body:b}});
 if(error){alert('Server mail failed: '+error.message+'. Opening your email app instead.');location.href=`mailto:${to}?subject=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`}else toast('Email sent to '+to)};
function editBox(title,fields,vals,save){
 return new Promise(res=>{
  const o=document.createElement('div');o.className='modal';
  const fld=f=>`<label class="${f.full?'full':''}">${esc(f.l)}${f.opts?`<select name="${f.n}">${f.opts.map(p=>{const v=Array.isArray(p)?p[0]:p,l=Array.isArray(p)?p[1]:p;return`<option value="${esc(v)}" ${String(vals[f.n]??'')===String(v)?'selected':''}>${esc(l)}</option>`}).join('')}</select>`:`<input name="${f.n}" type="${f.t||'text'}" ${f.req?'required':''} ${f.step?`step="${f.step}"`:''} ${f.min!=null?`min="${f.min}"`:''} value="${esc(vals[f.n]??'')}">`}</label>`;
  const prev=document.activeElement;o.innerHTML=`<div class=card role=dialog aria-modal=true aria-labelledby=ebt><h3 id=ebt>${esc(title)}</h3><form class=g2>${fields.map(fld).join('')}<div class="f2 full"><button>Save changes</button><button type=button class=g data-c>Cancel</button></div></form></div>`;
  document.body.appendChild(o);
  const close=()=>{o.remove();try{prev&&prev.focus&&prev.focus()}catch(_){}res()};
  o.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}else if(e.key==='Tab'){const f=[...o.querySelectorAll('input,select,button:not(:disabled)')];if(!f.length)return;const a=f[0],z=f[f.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}}});
  const f1=o.querySelector('input,select');if(f1)f1.focus();
  o.querySelector('[data-c]').onclick=close;
  o.addEventListener('mousedown',e=>{if(e.target===o)close()});
  o.querySelector('form').onsubmit=e=>{e.preventDefault();const fm=e.target,d=Object.fromEntries(new FormData(fm));return guard(fm,async()=>{if((await save(d))!==false){close();toast('Changes saved')}})};
 })}
const SKEL=`<div class=sk role=status aria-label="Loading"><div class=skr><i class=b></i><i class=b></i><i class=b></i><i class=b></i></div><div class=skc><i class=b></i><i class=b></i></div><div class=skl><i class=b></i><i class=b></i><i class=b></i><i class=b></i><i class=b></i></div></div>`,QSK='<div class=skq><i class=b></i><i class=b></i><i class=b></i><i class=b></i></div>';
const nul=d=>Object.fromEntries(Object.entries(d).map(([k,v])=>[k,v===''?null:v]));
function login(){
 document.documentElement.classList.add('auth');document.body.className='auth';
 const ic={
  user:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7"/></svg>',
  lock:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  eye:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeoff:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4-.8M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  refresh:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 5v5h-5M4 19v-5h5"/><path d="M19 10A8 8 0 0 0 5.6 7.4M5 14a8 8 0 0 0 13.4 2.6"/></svg>',
  enter:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l4 4-4 4M14 12H3"/></svg>'
 };
 const social=[
  ['google','Google','<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.2 1-3.8 1-2.9 0-5.4-2-6.3-4.6H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.7 14c-.2-.7-.4-1.3-.4-2s.2-1.4.4-2V7.2H2.1a11 11 0 0 0 0 9.6L5.7 14z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.3 1.7l3.1-3.1A11 11 0 0 0 2.1 7.2L5.7 10c.9-2.6 3.4-4.6 6.3-4.6z"/></svg>'],
  ['facebook','Facebook','<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1877F2"/><path fill="#fff" d="M13.4 22v-8h2.7l.4-3.2h-3.1V8.9c0-.9.3-1.5 1.6-1.5h1.7V4.5c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.5-4 4.1v2.3H7.6V14h2.7v8z"/></svg>'],
  ['linkedin_oidc','LinkedIn','<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="4" fill="#0A66C2"/><path fill="#fff" d="M6.4 9.5h2.6V18H6.4zM7.7 5.4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM10.5 9.5H13v1.2c.4-.7 1.3-1.4 2.6-1.4 2.6 0 3.1 1.7 3.1 3.9V18h-2.6v-4.2c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2V18h-2.6z"/></svg>']
 ];
 document.body.innerHTML=`
 <div class="amb" aria-hidden="true"><i class="mesh m1"></i><i class="mesh m2"></i><i class="mesh m3"></i><i class="dr d1"></i><i class="dr d2"></i><i class="dr d3"></i><i class="dr d4"></i><i class="dr d5"></i><i class="dr d6"></i><i class="blob bl"></i><i class="blob br"></i></div>
 <main class="authwrap">
  <form class="card login glass" novalidate aria-labelledby="lt">
   <img class="alogo" src="assets/logo-login.png?v=20261029" alt="Shree Digitax Solutions" width="420" height="261">
   <h1 id="lt">Login</h1>
   <p class="sub">Welcome Back! Please login to continue.</p>
   <div class="fld"><label for="e" class="sr">Email ID</label><span class="ico">${ic.user}</span><input id="e" name="email" type="email" placeholder="Email ID" autocomplete="username" required></div>
   <div class="fld"><label for="p" class="sr">Password</label><span class="ico">${ic.lock}</span><input id="p" name="password" type="password" placeholder="Password" autocomplete="current-password" required minlength="6"><button type="button" class="eye" id="eye" aria-label="Show password" aria-pressed="false">${ic.eye}</button></div>
   <div class="cap">
    <canvas id="cv" width="150" height="44" role="img" aria-label="Captcha image"></canvas>
    <button type="button" class="rf" id="rf" aria-label="Refresh captcha">${ic.refresh}</button>
    <div class="fld"><label for="cp" class="sr">Enter captcha</label><input id="cp" type="text" placeholder="Enter Captcha" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="5" required></div>
   </div>
   <p class="cl" id="cl" hidden>Caps Lock is on</p>
   <p id="msg" class="msg" role="alert" aria-live="polite"></p>
   <button type="submit" class="go" id="si"><span class="lbl">${ic.enter}<span>Login</span></span><span class="spin" aria-hidden="true"></span></button>
   <div class="alt"><button type="button" class="lnk" id="fp">Forgot password?</button><button type="button" class="lnk" id="su">Create account</button></div>
   <div class="or"><span>Or Login With</span></div>
   <div class="soc">${social.map(s=>`<button type="button" class="sb" data-p="${s[0]}" aria-label="Continue with ${s[1]}">${s[2]}</button>`).join('')}</div>
  </form>
 </main>`;
 const form=document.forms[0],msg=$('#msg'),btns=[...form.querySelectorAll('button')];let code='';
 const say=(t,ok)=>{msg.textContent=t||'';msg.className='msg'+(t?(ok?' ok':' er'):'');if(t&&!ok){form.classList.remove('shake');void form.offsetWidth;form.classList.add('shake')}};
 const busy=b=>{form.classList.toggle('loading',b);form.setAttribute('aria-busy',b);btns.forEach(x=>x.disabled=b)};
 const cap=()=>{const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789',r=crypto.getRandomValues(new Uint8Array(5));code=[...r].map(n=>A[n%A.length]).join('');
  const c=$('#cv'),x=c.getContext('2d'),w=c.width,h=c.height;x.clearRect(0,0,w,h);
  const g=x.createLinearGradient(0,0,w,h);g.addColorStop(0,'#eaf3ff');g.addColorStop(1,'#d7e8fb');x.fillStyle=g;x.fillRect(0,0,w,h);
  for(let i=0;i<7;i++){x.strokeStyle='rgba(31,79,216,'+(.15+Math.random()*.25)+')';x.lineWidth=1;x.beginPath();x.moveTo(Math.random()*w,Math.random()*h);x.bezierCurveTo(Math.random()*w,Math.random()*h,Math.random()*w,Math.random()*h,Math.random()*w,Math.random()*h);x.stroke()}
  x.font='700 26px ui-monospace,Menlo,Consolas,monospace';x.textBaseline='middle';
  [...code].forEach((ch,i)=>{x.save();x.translate(14+i*26,h/2+(Math.random()*8-4));x.rotate((Math.random()-.5)*.5);x.fillStyle='#0b2a6b';x.fillText(ch,0,0);x.restore()});
  for(let i=0;i<30;i++){x.fillStyle='rgba(11,42,107,.3)';x.fillRect(Math.random()*w,Math.random()*h,1.5,1.5)}
  $('#cp').value=''};
 cap();$('#rf').onclick=()=>{cap();$('#cp').focus()};
 $('#eye').onclick=()=>{const p=$('#p'),s=p.type==='password';p.type=s?'text':'password';$('#eye').innerHTML=s?ic.eyeoff:ic.eye;$('#eye').setAttribute('aria-pressed',s);$('#eye').setAttribute('aria-label',s?'Hide password':'Show password')};
 const check=()=>{const e=$('#e').value.trim(),p=$('#p').value;
  if(!e||!/^\S+@\S+\.\S+$/.test(e)){say('Enter a valid email ID.');$('#e').focus();return 0}
  if(p.length<6){say('Password must be at least 6 characters.');$('#p').focus();return 0}
  if($('#cp').value.trim().toUpperCase()!==code){say('Captcha does not match. Try the new one.');cap();$('#cp').focus();return 0}
  say('');return 1};
 const go=async up=>{if(!check())return;const c={email:$('#e').value.trim(),password:$('#p').value};busy(1);
  try{const{data,error}=await(up?db.auth.signUp(c):db.auth.signInWithPassword(c));
   if(error){say(error.message);cap();busy(0);return}
   if(up&&!(data&&data.session)){say('Account created. Check your email to confirm it, then log in.',1);cap();busy(0);return}
   say('Success! Opening your workspace…',1);location.reload()}
  catch(err){say('Network problem. Please try again.');cap();busy(0)}};
 form.onsubmit=ev=>{ev.preventDefault();go(0)};$('#su').onclick=()=>go(1);
 $('#fp').onclick=async()=>{const e=$('#e').value.trim();if(!/^\S+@\S+\.\S+$/.test(e)){say('Enter your email ID above, then tap Forgot password.');$('#e').focus();return}
  busy(1);try{const{error}=await db.auth.resetPasswordForEmail(e,{redirectTo:location.href.split('#')[0]});error?say(error.message):say('Password reset link sent. Check your email.',1)}catch(x){say('Network problem. Please try again.')}busy(0)};
 form.querySelectorAll('.sb').forEach(b=>b.onclick=async()=>{busy(1);try{const{error}=await db.auth.signInWithOAuth({provider:b.dataset.p,options:{redirectTo:location.href.split('#')[0]}});if(error){say(error.message.includes('not enabled')||error.message.includes('Unsupported')?'This sign-in method is not enabled yet. Use email and password.':error.message);busy(0)}}catch(x){say('Network problem. Please try again.');busy(0)}});
 const amb=$('.amb'),rm=matchMedia('(prefers-reduced-motion:reduce)').matches;
 if(!rm)document.addEventListener('pointermove',ev=>{const x=ev.clientX/innerWidth-.5,y=ev.clientY/innerHeight-.5;amb.style.setProperty('--mx',x.toFixed(3));amb.style.setProperty('--my',y.toFixed(3));const r=form.getBoundingClientRect();form.style.setProperty('--gx',(ev.clientX-r.left)+'px');form.style.setProperty('--gy',(ev.clientY-r.top)+'px')});
 $('#p').addEventListener('keyup',ev=>{if(ev.getModifierState)$('#cl').hidden=!ev.getModifierState('CapsLock')});$('#p').addEventListener('blur',()=>$('#cl').hidden=true);
 $('#si').addEventListener('pointerdown',ev=>{if(rm||$('#si').disabled)return;const b=$('#si'),r=b.getBoundingClientRect(),d=document.createElement('i');d.className='rip';d.style.cssText='left:'+(ev.clientX-r.left)+'px;top:'+(ev.clientY-r.top)+'px';b.appendChild(d);setTimeout(()=>d.remove(),700)});
 form.addEventListener('input',()=>{if(msg.classList.contains('er'))say('')});
 $('#e').focus()}
/* Voice assistant: loaded on every signed-in page (microphone button at the bottom right). Safe to call twice. */
let VOICE_P=null;const loadVoice=()=>VOICE_P||(VOICE_P=new Promise(res=>{const add=src=>new Promise(r=>{const s=document.createElement('script');s.src=src;s.onload=s.onerror=r;document.head.appendChild(s)});add('assets/voice-core.js?v=20261029').then(()=>add('assets/voice.js?v=20261029')).then(res)}));
async function boot(title,render,act){
 const{data:{session}}=await db.auth.getSession();if(!session)return login();
 const file=location.pathname.split('/').pop()||'index.html',Qo=Object.fromEntries(Q),fb=act||file+location.search,nowOn=()=>navFind(file,Qo,location.hash,fb),on=nowOn();
 document.body.innerHTML=`<a class=skip href="#main">Skip to main content</a><aside id=sidenav aria-label="Sidebar"><div class=brand><img src="assets/logo.png?v=20261029" alt="Shree Digitax Solutions"></div><nav aria-label="Main">${navHTML(on)}</nav></aside><div class=scrim id=scrim></div><section><header><div class=hl><button class="g menu" id=mn aria-label="Toggle navigation" aria-expanded="false" aria-controls="sidenav">☰</button><div><h1>${title}</h1><small id=who>Welcome back!</small></div></div><div class=noprint><button class=g id=out>Sign out</button></div></header><main id=main aria-busy=true>${SKEL}</main></section>`;
 const setNav=o=>{document.body.classList.toggle('navopen',o);$('#mn').setAttribute('aria-expanded',o)};
 $('#mn').onclick=()=>setNav(!document.body.classList.contains('navopen'));
 $('#scrim').onclick=()=>setNav(false);
 addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('navopen')){setNav(false);$('#mn').focus()}});
 const nv=$('nav');
 nv.addEventListener('click',e=>{if(e.target.closest('a'))setNav(false)});
 nv.querySelectorAll('.ng').forEach(b=>b.onclick=()=>{const o=b.getAttribute('aria-expanded')!=='true',s=new Set(navSaved());b.setAttribute('aria-expanded',o);document.getElementById(b.getAttribute('aria-controls')).hidden=!o;o?s.add(b.parentNode.dataset.g):s.delete(b.parentNode.dataset.g);navSave([...s])});
 /* #hash menu items stay on the same page: re-mark the active item when the hash changes. */
 addEventListener('hashchange',()=>{const o=nowOn();nv.querySelectorAll('a').forEach(a=>{const y=a.getAttribute('href')===o;a.classList.toggle('on',y);y?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current')});nv.querySelectorAll('.ngw').forEach(w=>{const h=!!w.querySelector('a.on');w.classList.toggle('has',h);if(h){w.querySelector('.ng').setAttribute('aria-expanded','true');w.querySelector('.nsub').hidden=false}})});
 {const a=nv.querySelector('a.on');if(a)nv.scrollTop=Math.max(0,a.offsetTop-nv.clientHeight/2)}
 $('#out').onclick=async()=>{await db.auth.signOut();location.reload()};
 const side=async()=>{const{S}=await load();if(S.business_name)$('#who').textContent=S.business_name};
 let first=1;const run=async()=>{try{LP=load0();const sp=side().catch(()=>{});await render($('#main'));await sp;if(first){first=0;try{const h=location.hash.slice(1),t=h&&document.getElementById(decodeURIComponent(h));if(t)t.scrollIntoView()}catch(_){}}}catch(e){$('#main').innerHTML='<div class="card dn" role="alert">Could not load data: '+esc(e.message)+'. Check the Supabase keys and that the SQL has been run. <button class=g id=retry>Retry</button></div>';const rb=$('#retry');if(rb)rb.onclick=()=>{$('#main').innerHTML=SKEL;run()}}finally{LP=null;const mm=$('#main');if(mm)mm.setAttribute('aria-busy','false')}};
 window.refresh=run;await run();loadVoice();let rt;db.channel('live').on('postgres_changes',{event:'*',schema:'public'},()=>{clearTimeout(rt);rt=setTimeout(run,400)}).subscribe();}
