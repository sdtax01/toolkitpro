\set ON_ERROR_STOP on
\set QUIET on
-- psql -v with_p0=1 -f tests/sql/phase2_test.sql   (with_p0=1 also installs the Phase 0 migrations first)
\i tests/sql/supabase_mock.sql
\i supabase/schema_all.sql
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant usage on schema auth to authenticated;
\if :{?with_p0}
\i supabase/migrations/001_constraints.sql
\i supabase/migrations/002_payment_functions.sql
\i supabase/migrations/003_audit.sql
\endif
create function pg_temp.fails(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create table public._t(k text, ok boolean); grant all on public._t to authenticated;
create function public._chk(k text, ok boolean) returns void language sql as $$ insert into public._t values(k, ok) $$;
grant execute on function public._chk(text, boolean) to authenticated;

\i supabase/migrations/010_ledger_core.sql
\i supabase/migrations/011_ledger_posting.sql
\i supabase/migrations/012_ledger_functions.sql
create function public.bal(p_user uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit),0) from journal_lines l join gl_accounts a on a.id = l.gl_account_id where l.user_id = p_user and a.system_key = p_key $$;
grant execute on function public.bal(uuid, text) to authenticated;
grant all on public._t to authenticated;

-- ---------- seed (superuser, posting still OFF) ----------
insert into parties(id,user_id,name,kind,state) values
 ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','Cust A','client','MH'),
 ('00000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','Cust B','client','KA'),
 ('00000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','Supp C','supplier','MH'),
 ('00000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','Other co','client','MH');
insert into accounts(id,user_id,name,opening) values
 ('00000000-0000-0000-0000-0000000000c1','11111111-1111-1111-1111-111111111111','HDFC',10000),
 ('00000000-0000-0000-0000-0000000000c2','22222222-2222-2222-2222-222222222222','Other bank',500);
insert into invoices(id,user_id,party_id,kind,number,date,due_date,amount,paid,taxable,gst_rate,cgst,sgst,igst) values
 ('00000000-0000-0000-0000-0000000000d1','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1','sale','INV-1','2026-04-10','2026-04-25',1180,500,1000,18,90,90,0),
 ('00000000-0000-0000-0000-0000000000d2','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a2','sale','INV-2','2026-05-02','2026-05-17',2360,0,2000,18,0,0,360),
 ('00000000-0000-0000-0000-0000000000d3','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a3','purchase','BILL-1','2026-05-05','2026-05-20',590,0,500,18,45,45,0),
 ('00000000-0000-0000-0000-0000000000d4','22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-0000000000b1','sale','INV-1','2026-04-11',null,300,0,null,0,0,0,0);
insert into transactions(id,user_id,date,description,category,type,amount,account_id,invoice_id) values
 ('00000000-0000-0000-0000-0000000000e1','11111111-1111-1111-1111-111111111111','2026-05-01','Receipt INV-1','Sales','income',500,'00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000d1'),
 ('00000000-0000-0000-0000-0000000000e2','11111111-1111-1111-1111-111111111111','2026-05-03','Office rent','Rent','expense',300,'00000000-0000-0000-0000-0000000000c1',null),
 ('00000000-0000-0000-0000-0000000000e3','11111111-1111-1111-1111-111111111111','2026-05-04','Consulting fee','Consulting','income',700,'00000000-0000-0000-0000-0000000000c1',null),
 ('00000000-0000-0000-0000-0000000000e4','11111111-1111-1111-1111-111111111111','2026-05-06','Misc','','expense',50,'00000000-0000-0000-0000-0000000000c1',null),
 ('00000000-0000-0000-0000-0000000000e5','11111111-1111-1111-1111-111111111111','2026-05-07','Tea','Rent','expense',20,null,null);
select public._chk('before setup: nothing posted', (select count(*)=0 from journals));
insert into transactions(user_id,date,description,type,amount) values ('11111111-1111-1111-1111-111111111111','2026-05-08','later','expense',1);
select public._chk('before setup: new rows still no journals', (select count(*)=0 from journals));
delete from transactions where description='later';

-- ---------- setup as user 1 ----------
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public._chk('add journal blocked before setup', pg_temp.err($q$select public.post_manual_journal('2026-05-10','x','[]')$q$) like '%Set up the ledger first%');
select public.setup_ledger('2026-04-01') as setup_result \gset
select public._chk('setup ran', (select count(*)>=8 from journals));
select public._chk('every journal balances', (select count(*)=0 from (select journal_id from journal_lines group by 1 having sum(debit)<>sum(credit)) x));
select public._chk('trial balance totals equal', (select sum(debit)=sum(credit) from journal_lines));
select public._chk('receivables = open sales (3040)', public.bal('11111111-1111-1111-1111-111111111111','receivables')=3040);
select public._chk('payables = open bills (590)', public.bal('11111111-1111-1111-1111-111111111111','payables')=-590);
select public._chk('bank ledger = 10000+500+700-300-50', (select sum(l.debit-l.credit)=10850 from journal_lines l join gl_accounts a on a.id=l.gl_account_id where a.bank_account_id='00000000-0000-0000-0000-0000000000c1'));
select public._chk('cash ledger = -20', public.bal('11111111-1111-1111-1111-111111111111','cash')=-20);
select public._chk('sales credit 3000', public.bal('11111111-1111-1111-1111-111111111111','sales')=-3000);
select public._chk('output tax 90/90/360', public.bal('11111111-1111-1111-1111-111111111111','output_cgst')=-90 and public.bal('11111111-1111-1111-1111-111111111111','output_sgst')=-90 and public.bal('11111111-1111-1111-1111-111111111111','output_igst')=-360);
select public._chk('input tax 45/45', public.bal('11111111-1111-1111-1111-111111111111','input_cgst')=45 and public.bal('11111111-1111-1111-1111-111111111111','input_sgst')=45);
select public._chk('opening equity credit 10000', public.bal('11111111-1111-1111-1111-111111111111','opening_equity')=-10000);
select public._chk('category accounts auto-created', (select count(*)=2 from gl_accounts where name in ('Rent','Consulting')) and (select type from gl_accounts where name='Rent')='expense');
select public._chk('uncategorised expense -> general expenses', public.bal('11111111-1111-1111-1111-111111111111','general_expense')=50);
select public._chk('nothing unsynced after setup', (select count(*)=0 from public.ledger_unsynced()));
select public._chk('journal numbers gapless', (select count(*)=max(journal_no) and min(journal_no)=1 from journals where user_id='11111111-1111-1111-1111-111111111111'));
select count(*) as n_after_setup from journals \gset
select public._chk('setup again is idempotent', (public.setup_ledger('2026-04-01')->>'already_set_up')='true' and (select count(*)=:n_after_setup from journals));
select public.resync_ledger() as rs \gset
select public._chk('resync changes nothing', (select count(*)=:n_after_setup from journals));

-- ---------- existing app flows keep working with the ledger on ----------
\if :{?with_p0}
select public.record_payment('00000000-0000-0000-0000-0000000000d2', 1000, '2026-06-01', '00000000-0000-0000-0000-0000000000c1', 'Receipt INV-2') is not null as ok;
select public._chk('payment RPC posts: receivables = subledger', public.bal('11111111-1111-1111-1111-111111111111','receivables')=(select sum(amount-paid) from invoices where kind='sale' and user_id='11111111-1111-1111-1111-111111111111'));
select public.delete_payment((select id from transactions where description='Receipt INV-2'));
select public._chk('payment delete keeps receivables = subledger', public.bal('11111111-1111-1111-1111-111111111111','receivables')=(select sum(amount-paid) from invoices where kind='sale' and user_id='11111111-1111-1111-1111-111111111111'));
\else
insert into transactions(id,date,description,category,type,amount,account_id,invoice_id) values ('00000000-0000-0000-0000-0000000000f1','2026-06-01','Receipt INV-2','Sales','income',1000,'00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000d2');
update invoices set paid=1000 where id='00000000-0000-0000-0000-0000000000d2';
select public._chk('legacy two-step payment posts: receivables = subledger', public.bal('11111111-1111-1111-1111-111111111111','receivables')=(select sum(amount-paid) from invoices where kind='sale' and user_id='11111111-1111-1111-1111-111111111111'));
delete from transactions where id='00000000-0000-0000-0000-0000000000f1'; update invoices set paid=0 where id='00000000-0000-0000-0000-0000000000d2';
\endif
select count(*) as n_before from journals \gset
update invoices set paid = paid where id='00000000-0000-0000-0000-0000000000d1';
update invoices set due_date='2026-12-31' where id='00000000-0000-0000-0000-0000000000d1';
select public._chk('paid/due-date edits post nothing new', (select count(*)=:n_before from journals));
update invoices set taxable=2000,cgst=180,sgst=180,amount=2360 where id='00000000-0000-0000-0000-0000000000d1';
select public._chk('invoice edit: reversal + new, still balanced & in sync', (select count(*)=:n_before+2 from journals) and (select count(*)=0 from public.ledger_unsynced()) and public.bal('11111111-1111-1111-1111-111111111111','sales')=-4000);
update transactions set amount=400 where id='00000000-0000-0000-0000-0000000000e2';
select public._chk('transaction edit reposts', public.bal('11111111-1111-1111-1111-111111111111','general_expense')=50 and (select sum(l.debit) from journal_lines l join gl_accounts a on a.id=l.gl_account_id where a.name='Rent' and l.debit>0)>0 and (select sum(l.debit-l.credit)=400+20 from journal_lines l join gl_accounts a on a.id=l.gl_account_id where a.name='Rent'));
delete from invoices where id='00000000-0000-0000-0000-0000000000d3';
select public._chk('invoice delete reverses it (payables 0)', public.bal('11111111-1111-1111-1111-111111111111','payables')=0 and public.bal('11111111-1111-1111-1111-111111111111','input_cgst')=0);
delete from parties where id='00000000-0000-0000-0000-0000000000a1';
select public._chk('party cascade: invoices reversed, receipt becomes plain income, books balanced',
  (select count(*)=0 from (select journal_id from journal_lines group by 1 having sum(debit)<>sum(credit)) x) and (select count(*)=0 from public.ledger_unsynced())
  and public.bal('11111111-1111-1111-1111-111111111111','receivables')=(select coalesce(sum(amount-paid),0) from invoices where kind='sale' and user_id='11111111-1111-1111-1111-111111111111'));
delete from accounts where id='00000000-0000-0000-0000-0000000000c1';
select public._chk('bank account delete: txns move to cash, opening reversed, still in sync', (select count(*)=0 from public.ledger_unsynced()) and (select sum(l.debit-l.credit)=0 from journal_lines l join gl_accounts a on a.id=l.gl_account_id where a.bank_account_id='00000000-0000-0000-0000-0000000000c1'));

-- ---------- failures inside posting never block normal saving; they are logged ----------
insert into invoices(id,party_id,kind,number,date,amount,cgst) values ('00000000-0000-0000-0000-0000000000d9','00000000-0000-0000-0000-0000000000a2','sale','BAD-1','2026-06-02',100,200);
select public._chk('bad invoice still saved', exists(select 1 from invoices where number='BAD-1'));
select public._chk('posting failure logged', (select count(*)=1 from ledger_errors where source_id='00000000-0000-0000-0000-0000000000d9'));
select public._chk('unsynced lists it', (select count(*)=1 from public.ledger_unsynced() where source_id='00000000-0000-0000-0000-0000000000d9'));
reset role; delete from invoices where number='BAD-1'; set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- ---------- period lock ----------
select public.set_period_lock('2026-05-31');
select count(*) as n_lock from journals \gset
select public._chk('lock blocks new invoice in locked period', pg_temp.err($q$insert into invoices(party_id,kind,number,date,amount) values('00000000-0000-0000-0000-0000000000a2','sale','LK-1','2026-05-15',10)$q$) like '%locked%');
select public._chk('lock blocks editing old invoice, data unchanged', pg_temp.err($q$update invoices set taxable=1,cgst=0,sgst=0,igst=0,amount=1 where id='00000000-0000-0000-0000-0000000000d2'$q$) like '%locked%' and (select amount=2360 from invoices where id='00000000-0000-0000-0000-0000000000d2'));
select public._chk('lock blocks deleting old invoice', pg_temp.fails($q$delete from invoices where id='00000000-0000-0000-0000-0000000000d2'$q$) and exists(select 1 from invoices where id='00000000-0000-0000-0000-0000000000d2'));
select public._chk('nothing partially posted during lock errors', (select count(*)=:n_lock from journals));
select public._chk('open period still works', not pg_temp.fails($q$insert into transactions(date,description,type,amount) values('2026-06-10','after lock','expense',5)$q$));
select public._chk('manual journal in locked period blocked', pg_temp.err(format($q$select public.post_manual_journal('2026-05-20','x','[{"account_id":"%s","debit":1},{"account_id":"%s","credit":1}]')$q$, (select id from gl_accounts where system_key='cash'), (select id from gl_accounts where system_key='sales'))) like '%locked%');
select public.set_period_lock(null);
select public._chk('unlock records history', (select count(*)=2 from ledger_lock_history));

-- ---------- manual journals, reversal, immutability ----------
select id as cash_id from gl_accounts where system_key='cash' \gset
select id as sales_id from gl_accounts where system_key='sales' \gset
select id as rec_id from gl_accounts where system_key='receivables' \gset
select id as gexp_id from gl_accounts where system_key='general_expense' \gset
select public.post_manual_journal('2026-06-15','Bank charges',jsonb_build_array(jsonb_build_object('account_id',:'gexp_id','debit',118.5,'memo','charges'),jsonb_build_object('account_id',:'cash_id','credit',118.5))) as mj \gset
select public._chk('manual journal posted', exists(select 1 from journals where id=:'mj' and kind='manual'));
select public._chk('unbalanced manual rejected', pg_temp.err(format($q$select public.post_manual_journal('2026-06-15','bad','[{"account_id":"%s","debit":10},{"account_id":"%s","credit":9}]')$q$,:'gexp_id',:'cash_id')) like '%must be equal%');
select public._chk('single-line manual rejected', pg_temp.err(format($q$select public.post_manual_journal('2026-06-15','bad','[{"account_id":"%s","debit":10}]')$q$,:'gexp_id')) like '%at least two%');
select public._chk('both sides on one line rejected', pg_temp.err(format($q$select public.post_manual_journal('2026-06-15','bad','[{"account_id":"%s","debit":10,"credit":10},{"account_id":"%s","credit":1}]')$q$,:'gexp_id',:'cash_id')) like '%either a debit or a credit%');
select public._chk('manual to receivables blocked', pg_temp.err(format($q$select public.post_manual_journal('2026-06-15','bad','[{"account_id":"%s","debit":10},{"account_id":"%s","credit":10}]')$q$,:'rec_id',:'cash_id')) like '%through invoices%');
select public._chk('failed manual journals leave no orphan header', (select count(*)=1 from journals where kind='manual'));
select public._chk('direct insert denied', pg_temp.fails($q$insert into journals(entry_date,narration,kind) values('2026-06-01','x','manual')$q$));
select public._chk('direct line insert denied', pg_temp.fails($q$insert into journal_lines(journal_id,user_id,gl_account_id,debit) select id,user_id,gl_account_id,1 from journal_lines limit 1$q$));
select public._chk('update journal denied', pg_temp.fails($q$update journals set narration='x'$q$));
select public._chk('delete journal denied', pg_temp.fails($q$delete from journals$q$));
select public._chk('update line denied', pg_temp.fails($q$update journal_lines set debit=1$q$));
select public._chk('delete line denied', pg_temp.fails($q$delete from journal_lines$q$));
select public._chk('reverse needs reason', pg_temp.err(format($q$select public.reverse_journal('%s','  ','2026-06-20')$q$,:'mj')) like '%reason%');
select public._chk('auto journal cannot be reversed manually', pg_temp.err(format($q$select public.reverse_journal('%s','because','2026-06-20')$q$,(select id from journals where kind='auto' limit 1))) like '%Only manual%');
select public.reverse_journal(:'mj','entered twice','2026-06-20') as rj \gset
select public._chk('reversal nets to zero', (select sum(l.debit-l.credit)=0 from journal_lines l join journals j on j.id=l.journal_id where j.id in (:'mj',:'rj') group by l.gl_account_id having l.gl_account_id=(select id from gl_accounts where system_key='general_expense' )) is not distinct from true or (select coalesce(sum(l.debit-l.credit),0)=0 from journal_lines l where l.journal_id in (:'mj',:'rj')));
select public._chk('cannot reverse twice', pg_temp.err(format($q$select public.reverse_journal('%s','again','2026-06-21')$q$,:'mj')) like '%already reversed%');
select public._chk('whole ledger still balanced', (select sum(debit)=sum(credit) from journal_lines));

-- ---------- chart of accounts ----------
select public._chk('rename allowed', not pg_temp.fails($q$update gl_accounts set name='Revenue from sales' where system_key='sales'$q$));
select public._chk('code change blocked', pg_temp.fails($q$update gl_accounts set code='9999' where system_key='sales'$q$));
select public._chk('type change blocked', pg_temp.fails($q$update gl_accounts set type='expense' where system_key='sales'$q$));
select public._chk('direct account insert denied', pg_temp.fails($q$insert into gl_accounts(code,name,type) values('7777','x','expense')$q$));
select public.add_gl_account('6100','Travel','expense') is not null as ok;
select public._chk('duplicate code message', pg_temp.err($q$select public.add_gl_account('6100','Again','expense')$q$) like '%already exists%');
select public._chk('bad code rejected', pg_temp.err($q$select public.add_gl_account('A1','x','expense')$q$) like '%3 to 6 digits%');

-- ---------- isolation between users ----------
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public._chk('user 2 sees none of user 1 ledger', (select count(*)=0 from journals) and (select count(*)=0 from gl_accounts) and (select count(*)=0 from journal_lines) and (select count(*)=0 from ledger_errors));
select public._chk('user 2 cannot reverse user 1 journal', pg_temp.err(format($q$select public.reverse_journal('%s','x y z','2026-07-01')$q$,:'mj')) like '%not found%');
select public._chk('user 2 cannot post to user 1 account', pg_temp.err(format($q$select public.post_manual_journal('2026-07-01','x','[{"account_id":"%s","debit":1},{"account_id":"%s","credit":1}]')$q$,:'cash_id',:'sales_id')) like '%not found%' or pg_temp.err(format($q$select public.post_manual_journal('2026-07-01','x','[{"account_id":"%s","debit":1},{"account_id":"%s","credit":1}]')$q$,:'cash_id',:'sales_id')) like '%Set up the ledger first%');
select public.setup_ledger('2026-04-01') as r2 \gset
select public._chk('user 2 set up independently', (select count(*)>=2 from journals) and (select min(journal_no)=1 from journals) and public.bal('22222222-2222-2222-2222-222222222222','receivables')=300);
select public._chk('user 2 lock does not affect user 1', true);
reset role;
select public._chk('user 1 unaffected by user 2 setup', (select count(*) from journals where user_id='11111111-1111-1111-1111-111111111111')>0 and (select locked_through is null from ledger_settings where user_id='11111111-1111-1111-1111-111111111111'));

-- ---------- fixes from the independent review ----------
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into invoices(id,party_id,kind,number,date,amount,cgst,sgst) values ('00000000-0000-0000-0000-0000000000d7','00000000-0000-0000-0000-0000000000a2','sale','DEC-1','2026-06-20',118.059,9.0045,9.0045);
select public._chk('3-decimal GST invoice posts a balanced journal', exists(select 1 from journals where source_id='00000000-0000-0000-0000-0000000000d7') and (select sum(debit)=sum(credit) from journal_lines l join journals j on j.id=l.journal_id where j.source_id='00000000-0000-0000-0000-0000000000d7') and (select count(*)=0 from ledger_errors where source_id='00000000-0000-0000-0000-0000000000d7'));
update invoices set number='DEC-1A' where id='00000000-0000-0000-0000-0000000000d7';
select public._chk('renaming an invoice refreshes the journal text', (select count(*)=1 from journals j where j.source_id='00000000-0000-0000-0000-0000000000d7' and j.narration like '%DEC-1A%' and not exists(select 1 from journals r where r.reverses=j.id)) and (select count(*)=0 from public.ledger_unsynced() where source_id='00000000-0000-0000-0000-0000000000d7'));
select public._chk('reserved code rejected', pg_temp.err($q$select public.add_gl_account('1100','x','asset')$q$) like '%reserved%' and pg_temp.err($q$select public.add_gl_account('1055','x','asset')$q$) like '%reserved%');
select public._chk('future lock rejected', pg_temp.err($q$select public.set_period_lock(current_date + 30)$q$) like '%future%');
select public.set_period_lock('2026-06-30');
insert into accounts(id,name,opening) values ('00000000-0000-0000-0000-0000000000c9','New bank after lock',777);
select public._chk('lock does not block creating a bank account', exists(select 1 from accounts where id='00000000-0000-0000-0000-0000000000c9'));
select public._chk('...but the skipped opening balance is logged and listed', exists(select 1 from ledger_errors where source_id='00000000-0000-0000-0000-0000000000c9') and exists(select 1 from public.ledger_unsynced() where source_id='00000000-0000-0000-0000-0000000000c9'));
select public.set_period_lock(null);
select public.resync_ledger(false) as rs2 \gset
select public._chk('after unlock, re-sync posts it', (select count(*)=0 from public.ledger_unsynced()));
reset role;
insert into invoices(id,user_id,party_id,kind,number,date,amount) values ('00000000-0000-0000-0000-0000000000d8','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000b1','sale','XT-1','2026-07-01',50);
select public._chk('other user''s party name never leaks into journal text', (select narration='Invoice XT-1' from journals where source_id='00000000-0000-0000-0000-0000000000d8' and kind='auto'));
insert into transactions(id,user_id,date,description,type,amount,invoice_id) values ('00000000-0000-0000-0000-0000000000f8','11111111-1111-1111-1111-111111111111','2026-07-02','Refund','expense',10,'00000000-0000-0000-0000-0000000000d8');
select public._chk('refund-direction transaction does not credit receivables', (select coalesce(sum(l.credit),0)=0 from journal_lines l join journals j on j.id=l.journal_id join gl_accounts a on a.id=l.gl_account_id where j.source_id='00000000-0000-0000-0000-0000000000f8' and a.system_key='receivables'));
delete from transactions where id='00000000-0000-0000-0000-0000000000f8'; delete from invoices where id in ('00000000-0000-0000-0000-0000000000d7','00000000-0000-0000-0000-0000000000d8');
select public._chk('two ledger edits of the same source never duplicate an active journal', (select count(*)=0 from (select source_id from journals j where kind in ('auto','opening') and not exists(select 1 from journals r where r.reverses=j.id) group by source_id having count(*)>1) x));

-- ---------- superuser cannot bypass balance or immutability either ----------
select public._chk('superuser unbalanced insert rejected at commit', (select pg_temp.fails($q$do $d$ declare j uuid; begin
   insert into journals(user_id,entry_date,narration,kind) values('11111111-1111-1111-1111-111111111111','2026-08-01','x','manual') returning id into j;
   insert into journal_lines(journal_id,user_id,gl_account_id,debit) values(j,'11111111-1111-1111-1111-111111111111',(select id from gl_accounts where system_key='cash' and user_id='11111111-1111-1111-1111-111111111111'),5);
   set constraints all immediate; end $d$$q$)));
select public._chk('superuser delete journal blocked', pg_temp.fails($q$delete from journals$q$));

-- ---------- optional: dump user 1's books so tests/phase2.test.js can cross-check the JavaScript reports against the real database ----------
\if :{?dump}
\pset tuples_only on
\pset format unaligned
\o :dump
select json_build_object(
 'accts',(select coalesce(json_agg(g),'[]') from gl_accounts g where user_id='11111111-1111-1111-1111-111111111111'),
 'lines',(select coalesce(json_agg(json_build_object('id',l.id,'journal_id',l.journal_id,'gl_account_id',l.gl_account_id,'debit',l.debit,'credit',l.credit,'party_id',l.party_id,'memo',l.memo,'entry_date',j.entry_date,'journal_no',j.journal_no,'narration',j.narration,'kind',j.kind,'source_table',j.source_table,'source_id',j.source_id)),'[]') from journal_lines l join journals j on j.id=l.journal_id where l.user_id='11111111-1111-1111-1111-111111111111'),
 'journals',(select coalesce(json_agg(j),'[]') from journals j where user_id='11111111-1111-1111-1111-111111111111'),
 'invoices',(select coalesce(json_agg(i),'[]') from invoices i where user_id='11111111-1111-1111-1111-111111111111'),
 'txns',(select coalesce(json_agg(t),'[]') from transactions t where user_id='11111111-1111-1111-1111-111111111111'),
 'bankAccounts',(select coalesce(json_agg(a),'[]') from accounts a where user_id='11111111-1111-1111-1111-111111111111'));
\o
\pset tuples_only off
\pset format aligned
\endif

-- ---------- reinstall safety: undo leaves source data intact and app working ----------
select count(*) as n_inv_before from invoices \gset
select count(*) as n_tx_before from transactions \gset
\i supabase/undo/012_ledger_down.sql
select public._chk('undo keeps invoices and transactions', (select count(*)=:n_inv_before from invoices) and (select count(*)=:n_tx_before from transactions));
select public._chk('undo removes ledger objects', to_regclass('public.journals') is null and not exists(select 1 from pg_trigger where tgname='tp_post'));
select public._chk('app still works after undo', not pg_temp.fails($q$insert into invoices(user_id,party_id,kind,number,date,amount) values('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-0000000000b1','sale','AFTER-1','2026-09-01',10)$q$));
\i supabase/migrations/010_ledger_core.sql
\i supabase/migrations/011_ledger_posting.sql
\i supabase/migrations/012_ledger_functions.sql
select public._chk('reinstall after undo works', to_regclass('public.journals') is not null);

\echo ---- RESULTS ----
select k, case when ok then 'PASS' else 'FAIL' end as result from public._t where not ok or k like 'zzz%';
select count(*) filter (where not ok) as failures, count(*) as total from public._t;
