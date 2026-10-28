// Static checks for the sidebar (no install needed): node tests/nav.test.js
// 1. every menu item points at an existing page, with #hash targets that exist as ids on that page
// 2. no duplicate menu hrefs, all paths relative (GitHub Pages), page links use the same cache-busting version
// 3. navFind() highlights the right item for list pages and for detail pages (party, invoice, statement)
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..'),src=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
const m=src.match(/\/\*NAV-START\*\/([\s\S]*?)\/\*NAV-END\*\//);
if(!m){console.error('FAIL cannot find the NAV block in assets/app.js');process.exit(1)}
const ctx={URLSearchParams,localStorage:{getItem(){return null},setItem(){}}};vm.createContext(ctx);
vm.runInContext(m[1]+';this.NAV=NAV;this.navFind=navFind;this.navLeaves=navLeaves;this.navHTML=navHTML',ctx);
let bad=0;const ok=(c,msg)=>{console.log((c?'PASS ':'FAIL ')+msg);if(!c)bad++};
const leaves=ctx.navLeaves();
const ids=f=>{const s=fs.readFileSync(path.join(root,f),'utf8');return new Set([...s.matchAll(/\bid=["']?([A-Za-z][\w-]*)/g)].map(x=>x[1]))};

ok(leaves.length>=45,'menu has '+leaves.length+' items');
const seen=new Set();let dup=[];leaves.forEach(([l,h])=>{if(seen.has(h))dup.push(h);seen.add(h)});ok(!dup.length,'no duplicate menu hrefs'+(dup.length?': '+dup:''));
let miss=[],badAnchor=[],abs=[];
for(const[l,h]of leaves){const[p,hs]=h.split('#'),f=p.split('?')[0];
 if(/^(\/|https?:)/.test(h))abs.push(h);
 if(!fs.existsSync(path.join(root,f)))miss.push(h);
 else if(hs&&!ids(f).has(hs))badAnchor.push(h)}
ok(!abs.length,'all menu paths are relative'+(abs.length?': '+abs:''));
ok(!miss.length,'every menu item points at an existing page'+(miss.length?': '+miss:''));
ok(!badAnchor.length,'every #section link has a matching id on its page'+(badAnchor.length?': '+badAnchor:''));

// query parameters that other pages depend on must survive exactly
for(const h of ['customers.html?kind=client','customers.html?kind=supplier','invoices.html?kind=sale','invoices.html?kind=purchase','ageing.html?kind=sale','ageing.html?kind=purchase','ledger.html?book=cash'])
 ok(seen.has(h),'menu keeps '+h);
ok(seen.has('banking.html'),'menu has unified Banking entry point');
ok(!seen.has('transactions.html?type=income')&&!seen.has('transactions.html?type=expense'),'legacy income/expense shortcuts are removed from navigation');

// Highlighting: [page file, query, hash] -> expected active menu href
const T=[['index.html','',''  ,'index.html'],['','', '','index.html'],
 ['customers.html','kind=client','','customers.html?kind=client'],['customers.html','kind=supplier','','customers.html?kind=supplier'],
 ['party.html','id=1&kind=client','','customers.html?kind=client'],['party.html','id=1&kind=supplier','','customers.html?kind=supplier'],
 ['invoices.html','kind=sale','','invoices.html?kind=sale'],['invoices.html','kind=purchase','','invoices.html?kind=purchase'],
 ['invoice.html','id=1&kind=sale','','invoices.html?kind=sale'],['invoice.html','id=1&kind=purchase','','invoices.html?kind=purchase'],
 ['invoice-new.html','kind=sale','','invoices.html?kind=sale'],['invoice-new.html','kind=purchase&party=2','','invoices.html?kind=purchase'],
 ['ageing.html','kind=sale','','ageing.html?kind=sale'],['ageing.html','kind=purchase','','ageing.html?kind=purchase'],
 ['statement.html','kind=client','','statement.html?kind=client'],['statement.html','id=1&kind=supplier','','statement.html?kind=supplier'],['statement.html','id=1','','statement.html?kind=client'],
 ['notes.html','kind=credit','','notes.html?kind=credit'],['notes.html','kind=debit','','notes.html?kind=debit'],['notes.html','','','notes.html'],['notes.html','invoice=9','','notes.html'],
 ['transactions.html','','','transactions.html'],['transactions.html','type=income','','transactions.html'],['transactions.html','type=expense','','transactions.html'],
 ['ledger.html','','','ledger.html'],['ledger.html','acc=5&from=2026-04-01','','ledger.html'],['ledger.html','book=cash','','ledger.html?book=cash'],
 ['reports.html','','','reports.html'],['reports.html','','#monthly','reports.html#monthly'],['reports.html','','#income-expense','reports.html#income-expense'],['reports.html','','#receivables-payables','reports.html#receivables-payables'],['reports.html','','#main','reports.html'],
 ['statements.html','','','statements.html'],['statements.html','','#sch-bs','statements.html#sch-bs'],['statements.html','','#sch-pl','statements.html#sch-pl'],['statements.html','','#sch-cf','statements.html#sch-cf'],
 ['settings.html','','#company','settings.html#company'],['settings.html','','#gst','settings.html#gst'],['settings.html','','#app','settings.html#app'],['settings.html','','','settings.html#company'],
 ['ledger-setup.html','','','ledger-setup.html'],['ledger-setup.html','','#prefs','ledger-setup.html#prefs'],
 ['balance-sheet.html','asof=2026-03-31','','balance-sheet.html'],['profit-loss.html','from=2026-04-01&to=2026-10-27','','profit-loss.html'],['trial-balance.html','asof=2026-03-31','','trial-balance.html'],
 ['bank-rec.html','acc=1','','bank-rec.html'],['daily.html','d=2026-10-01','','daily.html'],['overview.html','','','overview.html'],['year-end.html','fy=2026-04-01','','year-end.html']];
for(const[f,q,h,want]of T){const got=ctx.navFind(f,Object.fromEntries(new URLSearchParams(q)),h,null);
 ok(got===want,`${f}${q?'?'+q:''}${h} -> ${got}${got===want?'':' (expected '+want+')'}`)}
// every leaf resolves to itself
const selfBad=leaves.filter(([l,h])=>{const[p,hs]=h.split('#'),[f,qs]=p.split('?');return ctx.navFind(f,Object.fromEntries(new URLSearchParams(qs||'')),hs?'#'+hs:'',null)!==h});
ok(!selfBad.length,'each menu item highlights itself when opened'+(selfBad.length?': '+selfBad.map(x=>x[1]):''));

// html shape: exactly one active item; its group expanded
const html=ctx.navHTML('invoices.html?kind=sale');
ok((html.match(/ on"/g)||[]).length===1&&/aria-current="page"/.test(html),'rendered menu marks exactly one active item');
ok(/id="nv-b-sales"[^>]*aria-expanded="true"/.test(html)&&/id="nv-b-purchases"[^>]*aria-expanded="false"/.test(html),'active group is expanded, others collapsed');
const idl=[...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]);ok(new Set(idl).size===idl.length,'sidebar element ids are unique');

// every page uses the same cache-busting version and no other page ships its own sidebar
const pages=fs.readdirSync(root).filter(f=>f.endsWith('.html')),vers=new Set();let own=[];
for(const f of pages){const s=fs.readFileSync(path.join(root,f),'utf8');for(const x of s.matchAll(/v=(\d{8})/g))vers.add(x[1]);if(/<aside|<nav/.test(s))own.push(f);if(!/boot\(/.test(s))own.push(f+' (no boot)')}
ok(vers.size===1,'all pages use one cache-busting version: '+[...vers]);
ok(!own.length,'no page has its own sidebar markup and every page calls boot()'+(own.length?': '+own:''));
const av=[...src.matchAll(/v=(\d{8})/g)].map(x=>x[1]);ok(av.every(v=>vers.has(v)),'app.js logo link uses the same version');
console.log(bad?`\n${bad} check(s) failed`:'\nAll navigation checks passed');process.exit(bad?1:0);
