// A small in-memory stand-in for supabase-js with WRITE support, for browser tests only (tests/import-e2e.js).
// stub(data, opts) -> JavaScript source that replaces assets/vendor/supabase.js. State is exposed as window.__DB.
// opts.missingCols: {table: [columns the database "does not have yet"]}; opts.missingTables: [...]
module.exports = function stub(data, opts) {
  opts = opts || {};
  return `window.supabase={createClient:()=>{
const DB=window.__DB=${JSON.stringify(data)},OPT=${JSON.stringify(opts)};let seq=1000;window.__LOG=[];
const miss=(t,row)=>{const m=(OPT.missingCols||{})[t]||[];return Object.keys(row||{}).find(k=>m.includes(k))};
function run(st){
 const T=DB[st.t];if(!T||(OPT.missingTables||[]).includes(st.t))return{data:null,error:{code:'42P01',message:'relation "'+st.t+'" does not exist'}};
 if(st.op==='select'){const mc=(OPT.missingCols||{})[st.t]||[];if(st.cols!=='*'&&st.cols.split(',').some(c=>mc.includes(c.trim())))return{data:null,error:{code:'42703',message:'column does not exist'}}}
 let rows=T.filter(x=>st.f.every(f=>f(x)));
 if(st.op==='select'){let out=rows.map(x=>{const y={...x};if(st.t==='transactions'&&/accounts\\(name\\)/.test(st.cols)){const a=DB.accounts.find(z=>z.id===x.account_id);y.accounts=a?{name:a.name}:null}return y});
  if(st.cols!=='*'&&!/\\(/.test(st.cols)&&!st.head){const cs=st.cols.split(',').map(c=>c.trim());out=out.map(x=>Object.fromEntries(cs.map(c=>[c,x[c]])))}
  if(st.rng)out=out.slice(st.rng[0],st.rng[1]+1);if(st.lim!=null)out=out.slice(0,st.lim);
  if(st.head)return{data:null,count:out.length,error:null};
  return st.single?{data:out[0]||null,error:out[0]?null:{message:'no rows'}}:{data:out,error:null}}
 if(st.op==='insert'){const list=Array.isArray(st.row)?st.row:[st.row],made=[];
  for(const r of list){const bad=miss(st.t,r);if(bad)return{data:null,error:{code:'PGRST204',message:"Could not find the '"+bad+"' column of '"+st.t+"' in the schema cache"}};
   if(st.t==='invoices'&&T.some(x=>x.kind===r.kind&&String(x.number).trim().toLowerCase()===String(r.number).trim().toLowerCase()))return{data:null,error:{code:'23505',message:'duplicate key value violates unique constraint "invoices_user_kind_number_uq"'}};
   if(st.t==='transactions'&&r.voucher_no&&T.some(x=>x.voucher_no&&x.voucher_no.toLowerCase()===r.voucher_no.toLowerCase()))return{data:null,error:{code:'23505',message:'duplicate key value violates unique constraint "transactions_voucher_uq"'}};
   const row={id:'n'+(++seq),paid:0,adjusted:0,...r};T.push(row);made.push(row)}
  window.__LOG.push({t:st.t,op:'insert',rows:made.length});
  return st.single||!Array.isArray(st.row)?{data:made[0],error:null}:{data:made,error:null}}
 if(st.op==='update'){const bad=miss(st.t,st.row);if(bad)return{data:null,error:{code:'PGRST204',message:"Could not find the '"+bad+"' column of '"+st.t+"' in the schema cache"}};rows.forEach(x=>Object.assign(x,st.row));return{data:rows,error:null}}
 if(st.op==='delete'){DB[st.t]=T.filter(x=>!rows.includes(x));return{data:null,error:null}}
}
function q(t){const st={t,op:'select',f:[],cols:'*'};const b={
 select(c,o){st.cols=c||'*';if(o&&o.head)st.head=true;return b},insert(r){st.op='insert';st.row=r;return b},update(r){st.op='update';st.row=r;return b},delete(){st.op='delete';return b},
 eq(k,v){st.f.push(x=>x[k]===v);return b},neq(k,v){st.f.push(x=>x[k]!==v);return b},not(k,op,v){if(op==='is'&&v===null)st.f.push(x=>x[k]!=null);return b},
 order(){return b},limit(n){st.lim=n;return b},range(a,z){st.rng=[a,z];return b},single(){st.single=true;return b},
 then(res,rej){return Promise.resolve(run(st)).then(res,rej)}};return b}
const rpc=async(n,a)=>{window.__LOG.push({rpc:n,args:a});
 if(n==='record_payment'&&!OPT.noRecordPayment){const inv=DB.invoices.find(x=>x.id===a.p_invoice);if(!inv)return{data:null,error:{message:'Invoice not found'}};
  if(a.p_amount>+(inv.amount-inv.paid-(inv.adjusted||0)).toFixed(2))return{data:null,error:{message:'Amount exceeds the balance due'}};
  const t={id:'n'+(++seq),date:a.p_date,description:a.p_description,category:inv.kind==='sale'?'Sales':'Purchases',type:inv.kind==='sale'?'income':'expense',amount:a.p_amount,account_id:a.p_account,invoice_id:inv.id};DB.transactions.push(t);inv.paid=+(inv.paid+a.p_amount).toFixed(2);return{data:t.id,error:null}}
 if(n==='reset_posted_entries'&&!OPT.noReset){const c={sales_invoices:DB.invoices.filter(x=>x.kind==='sale').length,purchase_bills:DB.invoices.filter(x=>x.kind==='purchase').length,transactions:DB.transactions.length};
  if(a.p_dry_run)return{data:{...c,dry_run:true},error:null};if(a.p_confirm!=='RESET')return{data:null,error:{message:'Type RESET to confirm'}};DB.invoices=[];DB.transactions=[];return{data:c,error:null}}
 return{data:null,error:{code:'PGRST202',message:'Could not find the function public.'+n+' in the schema cache'}}};
const chan={on(){return chan},subscribe(){return chan}};
return{from:q,rpc,channel:()=>chan,functions:{invoke:async()=>({error:null})},auth:{getSession:async()=>({data:{session:{user:{id:'u1'}}}}),signOut:async()=>({}),onAuthStateChange(){}}}}};`;
};
