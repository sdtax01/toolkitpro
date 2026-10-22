const SUPABASE_URL='https://dpgkabvyappujokiujoh.supabase.co',SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZ2thYnZ5YXBwdWpva2l1am9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NzA5MzUsImV4cCI6MjEwNzA0NjkzNX0.iz4f1JYG3Sav4tLWDH1GPjXPxAD-U87ecRYrZKx8KLA';
const db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
try{const pc=document.createElement('link');pc.rel='preconnect';pc.href=SUPABASE_URL;pc.crossOrigin='';document.head.appendChild(pc)}catch(_){}
const $=s=>document.querySelector(s);
const inr=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const today=()=>new Date().toISOString().slice(0,10);
const RATES=[0,5,12,18,28];
const NAV=[['Home',[['index.html','Dashboard'],['overview.html','Overview']]],['Sales',[['customers.html?kind=client','Customers'],['invoices.html?kind=sale','Invoices']]],['Purchases',[['customers.html?kind=supplier','Suppliers'],['invoices.html?kind=purchase','Bills']]],['Accounting',[['transactions.html','Transactions'],['transactions.html?type=income','Income'],['transactions.html?type=expense','Expenses'],['banking.html','Banking'],['assets.html','Assets'],['budgets.html','Budgets'],['goals.html','Goals']]],['Compliance',[['taxes.html','GST & Taxes'],['documents.html','Documents'],['calendar.html','Calendar'],['reminders.html','Reminders']]],['Insights',[['reports.html','Reports']]],['',[['settings.html','Settings']]]];
const Q=new URLSearchParams(location.search);
const inr2=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const stat=x=>{const o=x.amount-x.paid;if(o<=0.005)return['Paid','ok'];if(x.due_date&&days(x.due_date)<0)return['Overdue','od'];return+x.paid>0?['Partially paid','pp']:['Unpaid','du']};
const badge=x=>{const[t,c]=stat(x);return`<span class="bd ${c}">${t}</span>`};
async function fixGst(list,S,p){const ans=prompt('GST rate % for these invoices (0, 5, 12, 18, 28)',S.default_gst??18);if(ans===null)return false;const r=+ans;if(!RATES.includes(r)){alert('Enter one of: '+RATES.join(', '));return false}
 const incl=confirm('Do the existing amounts already include GST?\nOK = included (total stays the same)\nCancel = GST is extra (total increases)');
 for(const x of list){const a=+x.amount,tv=incl?+(a/(1+r/100)).toFixed(2):a,g=gst(tv,r,S,p.find(y=>y.id===x.party_id)),tax=incl?+(a-tv).toFixed(2):g.cgst+g.sgst+g.igst,c=g.igst?{cgst:0,sgst:0,igst:tax}:{cgst:+(tax/2).toFixed(2),sgst:+(tax/2).toFixed(2),igst:0};
  if(!(await ok(db.from('invoices').update({taxable:tv,gst_rate:r,...c,amount:+(tv+tax).toFixed(2)}).eq('id',x.id))))return false}toast('GST updated');return true}
let LP=null;const load0=async()=>{const q=n=>db.from(n).select('*').then(r=>{if(r.error)throw r.error;return r.data||[]});const[t,a,p,i,r,h,s,b,g,d]=await Promise.all(['transactions','accounts','parties','invoices','reminders','assets','settings','budgets','goals','documents'].map(q));return{t,a,p,i,r,h,S:s[0]||{},b,g,d}};
const load=()=>LP||load0();
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
function editBox(title,fields,vals,save){
 return new Promise(res=>{
  const o=document.createElement('div');o.className='modal';
  const fld=f=>`<label class="${f.full?'full':''}">${esc(f.l)}${f.opts?`<select name="${f.n}">${f.opts.map(p=>{const v=Array.isArray(p)?p[0]:p,l=Array.isArray(p)?p[1]:p;return`<option value="${esc(v)}" ${String(vals[f.n]??'')===String(v)?'selected':''}>${esc(l)}</option>`}).join('')}</select>`:`<input name="${f.n}" type="${f.t||'text'}" ${f.req?'required':''} ${f.step?`step="${f.step}"`:''} ${f.min!=null?`min="${f.min}"`:''} value="${esc(vals[f.n]??'')}">`}</label>`;
  o.innerHTML=`<div class=card><h3>${esc(title)}</h3><form class=g2>${fields.map(fld).join('')}<div class="f2 full"><button>Save changes</button><button type=button class=g data-c>Cancel</button></div></form></div>`;
  document.body.appendChild(o);
  const close=()=>{o.remove();res()};
  o.querySelector('[data-c]').onclick=close;
  o.addEventListener('mousedown',e=>{if(e.target===o)close()});
  o.querySelector('form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));if((await save(d))!==false){close();toast('Changes saved')}};
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
   <img class="alogo" src="assets/logo-login.png" alt="Shree Digitax Solutions" width="420" height="261">
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
async function boot(title,render,act){
 const{data:{session}}=await db.auth.getSession();if(!session)return login();
 const cur=act||location.pathname.split('/').pop()+location.search;
 document.body.innerHTML=`<aside><div class=brand><img src="assets/logo.png" alt="Shree Digitax Solutions"></div><nav>${NAV.map(([g,l])=>(g?`<div class=grp>${g}</div>`:'')+l.map(([h,n])=>`<a href="${h}" class="${(h===cur||(h==='index.html'&&cur===''))?'on':''}">${n}</a>`).join('')).join('')}</nav><div class=qs id=qs>${QSK}</div></aside><section><header><div class=hl><button class="g menu" id=mn>☰</button><div><h1>${title}</h1><small id=who>Welcome back!</small></div></div><div class=noprint><a class=btn href="transactions.html">+ Add Transaction</a> <button class=g id=out>Sign out</button></div></header><main id=main aria-busy=true>${SKEL}</main></section>`;
 $('#mn').onclick=()=>document.body.classList.toggle('navopen');
 $('#out').onclick=async()=>{await db.auth.signOut();location.reload()};
 const side=async()=>{const{t,a,S}=await load(),mo=today().slice(0,7),l=t.filter(x=>x.date.startsWith(mo)),i=sum(l,'income'),e=sum(l,'expense');
  $('#qs').innerHTML=`<b>Quick Summary</b><small> This month</small><div>Total Income<span class=up>${inr(i)}</span></div><div>Total Expenses<span class=dn>${inr(e)}</span></div><div>Net Profit<span class=up>${inr(i-e)}</span></div><div>Cash Balance<b>${inr(bal(a,t).reduce((s,x)=>s+x.bal,0))}</b></div>`;if(S.business_name)$('#who').textContent=S.business_name};
 const run=async()=>{try{LP=load0();const sp=side().catch(()=>{});await render($('#main'));await sp}catch(e){$('#main').innerHTML='<div class="card dn">Could not load data: '+esc(e.message)+'. Check the Supabase keys and that the SQL has been run.</div>'}finally{LP=null;const mm=$('#main');if(mm)mm.setAttribute('aria-busy','false')}};
 window.refresh=run;await run();let rt;db.channel('live').on('postgres_changes',{event:'*',schema:'public'},()=>{clearTimeout(rt);rt=setTimeout(run,400)}).subscribe();}
