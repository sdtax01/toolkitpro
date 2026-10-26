\set ON_ERROR_STOP on
\set QUIET on
\i tests/sql/supabase_mock.sql
\i supabase/schema_all.sql
grant usage on schema public to anon, authenticated; grant all on all tables in schema public to authenticated; grant usage on schema auth to authenticated;
create function pg_temp.fails(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create table public._t(k text, ok boolean); grant all on public._t to authenticated;
create function public._chk(k text, ok boolean) returns void language sql as $$ insert into public._t values(k, ok) $$; grant execute on function public._chk(text, boolean) to authenticated;
\i supabase/migrations/010_ledger_core.sql
\i supabase/migrations/011_ledger_posting.sql
\i supabase/migrations/012_ledger_functions.sql
create function public.bal(p_user uuid, p_acc uuid) returns numeric language sql as $$ select coalesce(sum(l.debit - l.credit),0) from journal_lines l where l.user_id = p_user and l.gl_account_id = p_acc $$;
grant execute on function public.bal(uuid, uuid) to authenticated;
insert into parties(id,user_id,name,kind,state) values ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','Cust A','client','MH'),('00000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','Supp C','supplier','MH'),('00000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','Other co','client','MH');
insert into invoices(id,user_id,party_id,kind,number,date,amount,paid,taxable,gst_rate,cgst,sgst,igst) values
 ('00000000-0000-0000-0000-0000000000d1','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1','sale','INV-1','2026-04-10',1180,0,1000,18,90,90,0);
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.setup_ledger('2026-04-01') as s \gset
select count(*) as n_before from journals \gset
reset role;
\i supabase/migrations/014_heads_subledgers.sql
grant all on all tables in schema public to authenticated;
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public._chk('installing 014 changes no journal', (select count(*)=:n_before from journals));
select public.resync_ledger() as rs \gset
select public._chk('resync after 014 changes nothing (old invoices keep Sales)', (select count(*)=:n_before from journals));
select id as sales_id from gl_accounts where system_key='sales' and user_id='11111111-1111-1111-1111-111111111111' \gset
select id as purch_id from gl_accounts where system_key='purchases' and user_id='11111111-1111-1111-1111-111111111111' \gset
select public.add_gl_subledger('Software sales', :'sales_id') as sw \gset
select public.add_gl_subledger('Training income', :'sales_id') as tr \gset
select public._chk('auto codes follow the parent', (select string_agg(code,',' order by code)='4101,4102' from gl_accounts where parent_id=:'sales_id'));
select public._chk('sub-account takes the parent type', (select type='income' from gl_accounts where id=:'sw'));
select public._chk('duplicate sub-account name refused', pg_temp.fails($q$select public.add_gl_subledger('software SALES','$q$||:'sales_id'||$q$')$q$));
select public._chk('manual code works and reserved code refused', public.add_gl_subledger('Export sales', :'sales_id', '4150') is not null and pg_temp.fails($q$select public.add_gl_subledger('X','$q$||:'sales_id'||$q$','4900')$q$));
select id as rec_id from gl_accounts where system_key='receivables' and user_id='11111111-1111-1111-1111-111111111111' \gset
select public._chk('no sub-account under Debtors', pg_temp.fails($q$select public.add_gl_subledger('X','$q$||:'rec_id'||$q$')$q$));
select public.add_gl_subledger('Raw material', :'purch_id') as rm \gset
-- invoices with a head
insert into invoices(id,user_id,party_id,kind,number,date,amount,paid,taxable,gst_rate,cgst,sgst,igst,gl_account_id) values
 ('00000000-0000-0000-0000-0000000000d2','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1','sale','INV-2','2026-05-02',2360,0,2000,18,180,180,0,:'sw'),
 ('00000000-0000-0000-0000-0000000000d3','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a3','purchase','BILL-1','2026-05-05',590,0,500,18,45,45,0,:'rm');
select public._chk('sale with head credits that head (2000)', public.bal('11111111-1111-1111-1111-111111111111',:'sw')=-2000);
select public._chk('default sale still credits Sales (1000 only)', public.bal('11111111-1111-1111-1111-111111111111',:'sales_id')=-1000);
select public._chk('purchase with head debits that head (500)', public.bal('11111111-1111-1111-1111-111111111111',:'rm')=500);
select public._chk('purchases default untouched', public.bal('11111111-1111-1111-1111-111111111111',:'purch_id')=0);
select public._chk('debtors still get the full total', (select sum(l.debit-l.credit)=3540 from journal_lines l join gl_accounts a on a.id=l.gl_account_id where a.system_key='receivables' and l.user_id='11111111-1111-1111-1111-111111111111'));
select public._chk('all journals balance', (select count(*)=0 from (select journal_id from journal_lines group by 1 having sum(debit)<>sum(credit)) x));
-- guards
select public._chk('sale cannot use an expense head', pg_temp.fails($q$update invoices set gl_account_id='$q$||:'rm'||$q$' where id='00000000-0000-0000-0000-0000000000d1'$q$));
select public._chk('bill cannot use an income head', pg_temp.fails($q$update invoices set gl_account_id='$q$||:'sw'||$q$' where id='00000000-0000-0000-0000-0000000000d3'$q$));
select public._chk('sale cannot use a liability account', pg_temp.fails($q$update invoices set gl_account_id='$q$||:'rec_id'||$q$' where id='00000000-0000-0000-0000-0000000000d1'$q$));
-- change the head: reversal + repost, nothing rewritten
select count(*) as n1 from journals \gset
update invoices set gl_account_id=:'tr' where id='00000000-0000-0000-0000-0000000000d2';
select public._chk('changing the head reverses and reposts (2 new journals)', (select count(*)=:n1+2 from journals));
select public._chk('old head cleared, new head credited', public.bal('11111111-1111-1111-1111-111111111111',:'sw')=0 and public.bal('11111111-1111-1111-1111-111111111111',:'tr')=-2000);
update invoices set gl_account_id=null where id='00000000-0000-0000-0000-0000000000d2';
select public._chk('clearing the head returns it to Sales', public.bal('11111111-1111-1111-1111-111111111111',:'sales_id')=-3000);
select public._chk('no ledger errors logged', (select count(*)=0 from ledger_errors));
update invoices set gl_account_id=:'sw' where id='00000000-0000-0000-0000-0000000000d2';
-- deactivated head cannot be newly chosen, but old invoices keep working
update gl_accounts set is_active=false where id=:'tr';
select public._chk('inactive head refused for new use', pg_temp.fails($q$update invoices set gl_account_id='$q$||:'tr'||$q$' where id='00000000-0000-0000-0000-0000000000d2'$q$));
update invoices set number='INV-2A' where id='00000000-0000-0000-0000-0000000000d2';
select public._chk('editing an invoice keeps its head', public.bal('11111111-1111-1111-1111-111111111111',:'sw')=-2000);
-- user 2 cannot use user 1's head, cannot see it
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public._chk('user 2 cannot use user 1 head', pg_temp.fails($q$insert into invoices(user_id,party_id,kind,number,date,amount,taxable,gst_rate,cgst,sgst,igst,gl_account_id) values('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-0000000000b1','sale','X','2026-05-01',100,100,0,0,0,0,'$q$||:'sw'||$q$')$q$));
select public._chk('user 2 cannot add under user 1 account', pg_temp.fails($q$select public.add_gl_subledger('Spy','$q$||:'sales_id'||$q$')$q$));
select public._chk('user 2 sees no sub-accounts', (select count(*)=0 from gl_accounts where parent_id is not null));
-- undo
reset role;
update invoices set gl_account_id=null where id='00000000-0000-0000-0000-0000000000d2';
\i supabase/undo/014_heads_subledgers_down.sql
select public._chk('undo removes the columns and keeps invoices', not exists(select 1 from information_schema.columns where table_name='invoices' and column_name='gl_account_id') and (select count(*)=3 from invoices where user_id='11111111-1111-1111-1111-111111111111'));
select public._chk('undo restores original posting function', pg_get_functiondef('public.tp_desired_invoice(uuid)'::regprocedure) not like '%gl_account_id%');
\echo ---- RESULTS ----
select k from public._t where not ok;
select count(*) filter (where not ok) as failures, count(*) as total from public._t;
