\set ON_ERROR_STOP on
\set QUIET on
-- Tests for undo scripts 018 -> 015 (everything installed, then removed again). Run: psql -f tests/sql/undo_test.sql
\i tests/sql/supabase_mock.sql
\i supabase/schema_all.sql
grant usage on schema public to anon, authenticated; grant all on all tables in schema public to authenticated; grant usage on schema auth to authenticated;
create function pg_temp.fails(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create table public._t(k text, ok boolean); grant all on public._t to authenticated;
create function public._chk(k text, ok boolean) returns void language sql as $$ insert into public._t values(k, ok) $$; grant execute on function public._chk(text, boolean) to authenticated;
\i supabase/migrations/001_constraints.sql
\i supabase/migrations/002_payment_functions.sql
\i supabase/migrations/003_audit.sql
\i supabase/migrations/010_ledger_core.sql
\i supabase/migrations/011_ledger_posting.sql
\i supabase/migrations/012_ledger_functions.sql
\i supabase/migrations/014_heads_subledgers.sql
\i supabase/migrations/015_posting_controls.sql
\i supabase/migrations/016_accounts_gst_setoff.sql
\i supabase/migrations/017_stock_fixed_assets.sql
\i supabase/migrations/018_notes_tds_itc.sql
create function public.bal(p_user uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit),0) from journal_lines l join gl_accounts a on a.id = l.gl_account_id where l.user_id = p_user and a.system_key = p_key $$;
grant execute on function public.bal(uuid, text) to authenticated;




insert into parties(id,user_id,name,kind,state) values ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','Cust A','client','MH');
insert into accounts(id,user_id,name,opening) values ('00000000-0000-0000-0000-0000000000c1','11111111-1111-1111-1111-111111111111','HDFC',100000);
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.setup_ledger('2026-04-01');
insert into invoices(id,party_id,kind,number,date,amount,taxable,cgst,sgst,igst) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','sale','INV-1','2026-05-10',1180,1000,90,90,0);
insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('credit','00000000-0000-0000-0000-0000000000d1','CN-1','2026-05-20',500,45,45,0,590,'r');
delete from gst_notes where number = 'CN-1';
reset role;
\i supabase/undo/018_notes_tds_itc_down.sql
\i supabase/undo/017_stock_fixed_assets_down.sql
\i supabase/undo/016_accounts_gst_setoff_down.sql
\i supabase/undo/015_posting_controls_down.sql
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into invoices(id,party_id,kind,number,date,amount,taxable,cgst,sgst,igst) values ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000a1','sale','INV-2','2026-05-11',1180,1000,90,90,0);
select public._chk('after undo: new invoice still posts', public.bal('11111111-1111-1111-1111-111111111111','receivables') = 2360);
select public._chk('after undo: resync clean', (public.resync_ledger()->>'posted')::int = 0);
select public._chk('after undo: nothing out of sync', (select count(*) = 0 from public.ledger_unsynced()));
select public._chk('after undo: payment function works', public.record_payment('00000000-0000-0000-0000-0000000000d2', 100, '2026-05-12', '00000000-0000-0000-0000-0000000000c1') is not null);
select public._chk('after undo: columns gone', not exists (select 1 from information_schema.columns where table_name='invoices' and column_name in ('adjusted','itc_blocked')));
reset role;
select k, case when ok then 'PASS' else 'FAIL' end as result from public._t where not ok;
select count(*) filter (where not ok) as failures, count(*) as total from public._t;
