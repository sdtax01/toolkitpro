\set ON_ERROR_STOP on
\set QUIET on
-- Reset posted entries (migration 022). Run from the repo root, on an empty local database:
--   createdb tp5 && psql -d tp5 -v ON_ERROR_STOP=1 -f tests/sql/phase5_test.sql
\i tests/sql/supabase_mock.sql
\i supabase/schema_all.sql
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant usage on schema auth to authenticated;
\i supabase/migrations/001_constraints.sql
\i supabase/migrations/002_payment_functions.sql
\i supabase/migrations/003_audit.sql
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create table public._t(k text, ok boolean); grant all on public._t to authenticated;
create function public._chk(k text, ok boolean) returns void language sql as $$ insert into public._t values(k, ok) $$;
grant execute on function public._chk(text, boolean) to authenticated;
\i supabase/migrations/010_ledger_core.sql
\i supabase/migrations/011_ledger_posting.sql
\i supabase/migrations/012_ledger_functions.sql
\i supabase/migrations/014_heads_subledgers.sql
\i supabase/migrations/015_posting_controls.sql
\i supabase/migrations/016_accounts_gst_setoff.sql
\i supabase/migrations/017_stock_fixed_assets.sql
\i supabase/migrations/018_notes_tds_itc.sql
\i supabase/migrations/019_banking_engine.sql
\i supabase/migrations/020_invoice_pdf_fields.sql
\i supabase/migrations/022_series_import_reset.sql
grant all on all tables in schema public to authenticated;
create function public.bal(p_user uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit),0) from journal_lines l join gl_accounts a on a.id = l.gl_account_id where l.user_id = p_user and a.system_key = p_key $$;
grant execute on function public.bal(uuid, text) to authenticated;

insert into parties(id,user_id,name,kind,state) values
 ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','Cust A','client','Maharashtra'),
 ('00000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','Supp C','supplier','Maharashtra'),
 ('00000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','Other co','client','Maharashtra');
insert into accounts(id,user_id,name,opening) values
 ('00000000-0000-0000-0000-0000000000c1','11111111-1111-1111-1111-111111111111','HDFC',10000),
 ('00000000-0000-0000-0000-0000000000c2','22222222-2222-2222-2222-222222222222','Other bank',500);
insert into invoices(id,user_id,party_id,kind,number,date,due_date,amount,paid,taxable,gst_rate,cgst,sgst,igst) values
 ('00000000-0000-0000-0000-0000000000f1','22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-0000000000b1','sale','INV-1','2026-04-10','2026-04-25',1180,0,1000,18,90,90,0);
-- user 2 also has a ledger, so we can prove it is untouched
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.setup_ledger('2026-04-01');
reset role;

-- ===== user 1: build a realistic book =====
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.setup_ledger('2026-04-01');
insert into invoices(id,party_id,kind,number,date,due_date,amount,taxable,gst_rate,cgst,sgst,igst) values
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','sale','INV-0001','2026-05-02','2026-05-17',1180,1000,18,90,90,0),
 ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000a3','purchase','BILL-0001','2026-05-05','2026-05-20',590,500,18,45,45,0);
select public.record_payment('00000000-0000-0000-0000-0000000000d1', 400, '2026-05-10', '00000000-0000-0000-0000-0000000000c1', 'part receipt');
insert into transactions(date,description,category,type,amount,account_id) values ('2026-05-11','Bank charges','Bank charges','expense',50,'00000000-0000-0000-0000-0000000000c1');
insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('credit','00000000-0000-0000-0000-0000000000d1','CN-0001','2026-05-20',100,9,9,0,118,'return');
insert into tds_entries(invoice_id,date,amount,section,note) values ('00000000-0000-0000-0000-0000000000d1','2026-05-25',10,'194J','x');
select public.set_closing_stock('2026-09-30', 30000, 'fifo', 'count');
select id as bank_gl from gl_accounts where bank_account_id = '00000000-0000-0000-0000-0000000000c1' \gset
select public.add_fixed_asset('Laptop','IT','2025-04-01', 50000, 5000, 'wdv', null, 15, :'bank_gl'::uuid) as fa1 \gset
select public.post_depreciation('2025-04-01');
select public.post_manual_journal('2026-06-01','manual test', jsonb_build_array(
  jsonb_build_object('account_id', (select id from gl_accounts where system_key='general_expense'), 'debit', 10, 'credit', 0),
  jsonb_build_object('account_id', :'bank_gl'::uuid, 'debit', 0, 'credit', 10)));
select count(*) as j_before from journals \gset
select public._chk('journals exist before reset', :j_before > 8);

-- ===== dry run changes nothing =====
select public.reset_posted_entries('', true)->>'sales_invoices' as dr_sales \gset
select public._chk('dry run counts the sales invoice', :'dr_sales' = '1');
select count(*) as j_dry from journals \gset
select public._chk('dry run deletes nothing', :j_dry = :j_before);
select public._chk('wrong confirmation refused', pg_temp.err($q$select public.reset_posted_entries('reset')$q$) like '%RESET%');
select public._chk('still intact after refusal', (select count(*) from invoices) = 2);

-- ===== period lock blocks it =====
select public.set_period_lock('2026-04-30');
select public._chk('period lock blocks reset', pg_temp.err($q$select public.reset_posted_entries('RESET')$q$) like '%locked%');
select public.set_period_lock(null);

-- ===== real reset =====
select public.reset_posted_entries('RESET')->>'journals' as jdel \gset
select public._chk('journals were deleted', :'jdel'::int > 0);
select public._chk('invoices gone', (select count(*) from invoices) = 0);
select public._chk('transactions gone', (select count(*) from transactions) = 0);
select public._chk('notes gone', (select count(*) from gst_notes) = 0);
select public._chk('tds gone', (select count(*) from tds_entries) = 0);
select public._chk('stock entries gone', (select count(*) from stock_valuations) = 0);
select public._chk('depreciation gone', (select count(*) from fixed_asset_dep) = 0);
select public._chk('parties kept', (select count(*) from parties) = 2);
select public._chk('bank account + opening kept', (select opening from accounts where id='00000000-0000-0000-0000-0000000000c1') = 10000);
select public._chk('fixed asset kept', (select count(*) from fixed_assets) = 1);
select public._chk('chart of accounts kept', (select count(*) from gl_accounts) >= 14);
select public._chk('ledger still switched on', (select posting_enabled from ledger_settings));
select public._chk('only opening + asset purchase journals remain', (select count(*) from journals) = 2);
select public._chk('journal counter continues after the kept ones', (select next_journal_no from ledger_settings) = (select max(journal_no)+1 from journals));
select public._chk('opening-balance equity still carries the 10000 bank opening', public.bal('11111111-1111-1111-1111-111111111111','opening_equity') = -10000);
select public._chk('trial balance still balances', (select sum(debit)-sum(credit) from journal_lines) = 0);

-- ===== the book works normally afterwards =====
insert into invoices(party_id,kind,number,date,due_date,amount,taxable,gst_rate,cgst,sgst,igst) values
 ('00000000-0000-0000-0000-0000000000a1','sale','INV-0001','2026-06-02','2026-06-17',1180,1000,18,90,90,0);
select public._chk('new invoice posts again and number INV-0001 is reusable', (select count(*) from journals where source_table='invoices') = 1);
select public._chk('immutability is back for normal users', pg_temp.err($q$delete from journal_lines$q$) like '%cannot be changed%');
select public._chk('reset flag is not left on', coalesce(current_setting('tp.reset_user', true),'') = '');

-- ===== audit trail recorded the reset =====
reset role;
select public._chk('audit log has the reset record', (select count(*) from audit_log where action='RESET' and user_id='11111111-1111-1111-1111-111111111111') = 1);
-- ===== user 2 untouched =====
select public._chk('other user invoice untouched', (select count(*) from invoices where user_id='22222222-2222-2222-2222-222222222222') = 1);
select public._chk('other user journals untouched', (select count(*) from journals where user_id='22222222-2222-2222-2222-222222222222') >= 2);

-- ===== a user without the ledger switched on =====
insert into parties(id,user_id,name,kind) values ('00000000-0000-0000-0000-0000000000e1','33333333-3333-3333-3333-333333333333','P','client');
insert into invoices(user_id,party_id,kind,number,date,amount) values ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-0000000000e1','sale','X-1','2026-06-02',100);
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select public.reset_posted_entries('RESET');
reset role;
select public._chk('works with the ledger off', (select count(*) from invoices where user_id='33333333-3333-3333-3333-333333333333') = 0 and (select count(*) from parties where user_id='33333333-3333-3333-3333-333333333333') = 1);

\echo ---- results
select k, ok from public._t where not ok;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from public._t;
