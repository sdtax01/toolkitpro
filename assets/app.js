const SUPABASE_URL='https://dpgkabvyappujokiujoh.supabase.co',SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZ2thYnZ5YXBwdWpva2l1am9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NzA5MzUsImV4cCI6MjEwNzA0NjkzNX0.iz4f1JYG3Sav4tLWDH1GPjXPxAD-U87ecRYrZKx8KLA';
const db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const $=s=>document.querySelector(s);
const inr=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const today=()=>new Date().toISOString().slice(0,10);
const RATES=[0,5,12,18,28];
const NAV=[['index.html','Dashboard'],['overview.html','Overview'],['transactions.html','Transactions'],['transactions.html?type=income','Income'],['transactions.html?type=expense','Expenses'],['parties.html?kind=client','Clients & Sales'],['parties.html?kind=supplier','Suppliers & Purchases'],['banking.html','Banking & Accounts'],['assets.html','Assets & Investments'],['reports.html','Reports'],['budgets.html','Budgets'],['goals.html','Goals'],['taxes.html','Taxes'],['documents.html','Documents'],['calendar.html','Calendar'],['reminders.html','Reminders'],['settings.html','Settings']];
const load=async()=>{const q=n=>db.from(n).select('*').then(r=>{if(r.error)throw r.error;return r.data||[]});const[t,a,p,i,r,h,s,b,g,d]=await Promise.all(['transactions','accounts','parties','invoices','reminders','assets','settings','budgets','goals','documents'].map(q));return{t,a,p,i,r,h,S:s[0]||{},b,g,d}};
const sum=(l,t)=>l.filter(x=>x.type===t).reduce((s,x)=>s+ +x.amount,0);
const bal=(a,t)=>a.map(x=>{const l=t.filter(y=>y.account_id===x.id);return{...x,inc:sum(l,'income'),exp:sum(l,'expense'),bal:+x.opening+sum(l,'income')-sum(l,'expense')}});
const owed=(i,k)=>i.filter(x=>x.kind===k).reduce((s,x)=>s+(+x.amount-+x.paid),0);
const spent=(t,c,mo)=>t.filter(x=>x.type==='expense'&&x.date.startsWith(mo)&&(x.category||'').trim().toLowerCase()===c.trim().toLowerCase()).reduce((s,x)=>s+ +x.amount,0);
const days=d=>Math.round((new Date(d)-new Date(today()))/864e5);
const due=d=>{const n=days(d);return n<0?`Overdue ${-n}d`:n===0?'Due today':`Due in ${n} days`};
const taxOf=x=>(+x.cgst||0)+(+x.sgst||0)+(+x.igst||0);
const gst=(taxable,rate,S,P)=>{const tax=+(taxable*rate/100).toFixed(2),inter=!!(S?.state&&P?.state&&S.state.trim().toLowerCase()!==P.state.trim().toLowerCase());return inter?{cgst:0,sgst:0,igst:tax}:{cgst:+(tax/2).toFixed(2),sgst:+(tax/2).toFixed(2),igst:0}};
const bar=(v,max)=>{const p=max?v/max*100:0;return`<div class=bar><i class="${p>100?'dn':''}" style="width:${Math.min(100,p)}%"></i></div>`};
const ok=async p=>{const r=await p;if(r.error){alert(r.error.message);return false}return true};
const toast=m=>{const d=document.createElement('div');d.className='toast';d.textContent=m;document.body.appendChild(d);setTimeout(()=>d.remove(),3500)};
const mail=async(to,s,b)=>{if(!to){alert('Add an email address for this contact first.');return}
 const{error}=await db.functions.invoke('send-mail',{body:{to,subject:s,body:b}});
 if(error){alert('Server mail failed: '+error.message+'. Opening your email app instead.');location.href=`mailto:${to}?subject=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`}else toast('Email sent to '+to)};
function login(){document.body.innerHTML=`<form class="card login"><h3>Toolkit Pro</h3><input id=e type=email placeholder=Email required><input id=p type=password placeholder=Password required minlength=6><button>Sign in</button> <button type=button class=g id=su>Create account</button><p id=msg class=dn></p></form>`;
 const go=async up=>{const c={email:$('#e').value,password:$('#p').value};const{error}=await(up?db.auth.signUp(c):db.auth.signInWithPassword(c));error?$('#msg').textContent=error.message:location.reload()};
 document.forms[0].onsubmit=ev=>{ev.preventDefault();go(0)};$('#su').onclick=()=>go(1)}
async function boot(title,render){
 const{data:{session}}=await db.auth.getSession();if(!session)return login();
 const cur=location.pathname.split('/').pop()+location.search;
 document.body.innerHTML=`<aside><div class=brand><img src="assets/logo.png" alt="Shree Digitax Solutions"></div><nav>${NAV.map(([h,n])=>`<a href="${h}" class="${(h===cur||(h==='index.html'&&cur===''))?'on':''}">${n}</a>`).join('')}</nav><div class=qs id=qs></div></aside><section><header><div><h1>${title}</h1><small id=who>Welcome back!</small></div><div><a class=btn href="transactions.html">+ Add Transaction</a> <button class=g id=out>Sign out</button></div></header><main id=main></main></section>`;
 $('#out').onclick=async()=>{await db.auth.signOut();location.reload()};
 const side=async()=>{const{t,a,S}=await load(),mo=today().slice(0,7),l=t.filter(x=>x.date.startsWith(mo)),i=sum(l,'income'),e=sum(l,'expense');
  $('#qs').innerHTML=`<b>Quick Summary</b><small> This month</small><div>Total Income<span class=up>${inr(i)}</span></div><div>Total Expenses<span class=dn>${inr(e)}</span></div><div>Net Profit<span class=up>${inr(i-e)}</span></div><div>Cash Balance<b>${inr(bal(a,t).reduce((s,x)=>s+x.bal,0))}</b></div>`;if(S.business_name)$('#who').textContent=S.business_name};
 const run=async()=>{try{await render($('#main'));side().catch(()=>{})}catch(e){$('#main').innerHTML='<div class="card dn">Could not load data: '+esc(e.message)+'. Check the Supabase keys and that all three SQL files have been run.</div>'}};
 await run();db.channel('live').on('postgres_changes',{event:'*',schema:'public'},run).subscribe();}
