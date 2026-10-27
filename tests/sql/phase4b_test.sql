\set ON_ERROR_STOP on
\set QUIET on
-- Tests for 017 (closing stock, fixed assets, depreciation). Run: psql -f tests/sql/phase4b_test.sql
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
create function public.bal(p_user uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit),0) from journal_lines l join gl_accounts a on a.id = l.gl_account_id where l.user_id = p_user and a.system_key = p_key $$;
grant execute on function public.bal(uuid, text) to authenticated;


insert into accounts(id,user_id,name,opening) values ('00000000-0000-0000-0000-0000000000c1','11111111-1111-1111-1111-111111111111','HDFC',500000);

set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.setup_ledger('2025-04-01');
select a.id as bank_gl from gl_accounts a where a.bank_account_id = '00000000-0000-0000-0000-0000000000c1' \gset
select a.id as eq_gl from gl_accounts a where a.system_key = 'opening_equity' \gset

-- stock ------------------------------------------------------------------------------------------------------------------
select public.set_closing_stock('2026-03-31', 50000, 'fifo', 'year end count');
select public._chk('stock up: inventory 50000', public.bal('11111111-1111-1111-1111-111111111111','inventory') = 50000);
select public._chk('stock up: change in inventories credit 50000', public.bal('11111111-1111-1111-1111-111111111111','stock_adjust') = -50000);
select public.set_closing_stock('2026-09-30', 30000, 'weighted_average');
select public._chk('stock down posts the difference only', public.bal('11111111-1111-1111-1111-111111111111','inventory') = 30000 and public.bal('11111111-1111-1111-1111-111111111111','stock_adjust') = -30000);
select (public.set_closing_stock('2026-10-15', 30000, 'weighted_average')->>'journal_id') is null as nojrnl \gset
select public._chk('same value posts no journal', :'nojrnl');
select public._chk('earlier date after a later one is refused', pg_temp.err($q$select public.set_closing_stock('2026-06-30', 10000, 'fifo')$q$) like '%date order%');
select public._chk('negative stock refused', pg_temp.err($q$select public.set_closing_stock('2026-10-20', -1, 'fifo')$q$) like '%negative%');
select public._chk('bad method refused', pg_temp.err($q$select public.set_closing_stock('2026-10-20', 5, 'lifo')$q$) like '%basis%');

-- fixed assets -----------------------------------------------------------------------------------------------------------
select public.add_fixed_asset('Lathe machine','Plant', '2025-10-01', 120000, 0, 'slm', 10, null, :'bank_gl'::uuid) as a1 \gset
select public._chk('asset posted at cost', public.bal('11111111-1111-1111-1111-111111111111','fixed_assets') = 120000);
select public.add_fixed_asset('Computer','IT', '2025-04-01', 50000, 5000, 'wdv', null, 15, :'bank_gl'::uuid) as a2 \gset
select public._chk('bad residual refused', pg_temp.err(format($q$select public.add_fixed_asset('X','', '2025-04-01', 100, 100, 'slm', 5, null, %L)$q$, :'bank_gl')) like '%Residual%');
select public._chk('debtors account refused as credit side', pg_temp.err(format($q$select public.add_fixed_asset('X','', '2025-04-01', 100, 0, 'slm', 5, null, %L)$q$, (select id from gl_accounts where system_key='receivables'))) like '%not Accounts receivable%');
select public._chk('slm needs life', pg_temp.err(format($q$select public.add_fixed_asset('X','', '2025-04-01', 100, 0, 'slm', null, null, %L)$q$, :'bank_gl')) like '%useful life%');
select public._chk('wdv needs rate', pg_temp.err(format($q$select public.add_fixed_asset('X','', '2025-04-01', 100, 0, 'wdv', null, null, %L)$q$, :'bank_gl')) like '%rate%');
-- existing asset with depreciation already charged before the ledger began
select public.add_fixed_asset('Old press','Plant', '2022-04-01', 100000, 0, 'slm', 10, null, :'eq_gl'::uuid, null, null, 40000, '2025-04-01') as a3 \gset
select public._chk('opening accumulated depreciation credited', public.bal('11111111-1111-1111-1111-111111111111','acc_dep') = -40000);
select public._chk('asset journals balance', (select sum(debit) = sum(credit) from journal_lines));

select public._chk('preview: slm pro-rata by days (182/365)', (select amount from public.preview_depreciation('2025-04-01') where asset_id = :'a1'::uuid) = round(12000.00 * 182 / 365, 2));
select public._chk('preview: wdv full year 15% of 50000', (select amount from public.preview_depreciation('2025-04-01') where asset_id = :'a2'::uuid) = 7500.00);
select public._chk('preview: old press 10% of cost', (select amount from public.preview_depreciation('2025-04-01') where asset_id = :'a3'::uuid) = 10000.00);
select public._chk('mid-year date refused', pg_temp.err($q$select public.post_depreciation('2025-05-01')$q$) like '%1 April%');
select public._chk('unfinished year refused', pg_temp.err($q$select public.post_depreciation('2026-04-01')$q$) like '%not ended%');
select public.post_depreciation('2025-04-01') as r1 \gset
select public._chk('depreciation posted', public.bal('11111111-1111-1111-1111-111111111111','depreciation') = round(12000.00*182/365,2) + 7500 + 10000);
select public._chk('accumulated depreciation credited', public.bal('11111111-1111-1111-1111-111111111111','acc_dep') = -(40000 + round(12000.00*182/365,2) + 7500 + 10000));
select (public.post_depreciation('2025-04-01')->>'journal_id') is null as again \gset
select public._chk('second run for same year posts nothing (idempotent)', :'again');
select public._chk('one depreciation journal for the year', (select count(*) = 1 from journals where narration like 'Depreciation for FY 2025-26'));
select public._chk('depreciation rows cannot be edited', pg_temp.fails($q$update fixed_asset_dep set amount = 1$q$));
select public._chk('depreciation journal dated 31 March', (select entry_date = '2026-03-31' from journals where narration like 'Depreciation for FY 2025-26'));
-- a year cannot be skipped
select public.add_fixed_asset('Older tool','Plant', '2024-04-01', 10000, 0, 'wdv', null, 20, :'bank_gl'::uuid) as a4 \gset
select public._chk('earlier year must be posted first', pg_temp.err($q$select public.post_depreciation('2025-04-01')$q$) like '%earlier year%');
-- cancel an asset that has no depreciation
select public.void_fixed_asset(:'a4'::uuid, 'Entered by mistake', '2026-10-27');
select public._chk('voided asset reversed', (select voided from fixed_assets where id = :'a4'::uuid) and public.bal('11111111-1111-1111-1111-111111111111','fixed_assets') = 120000 + 50000 + 100000);
select public._chk('asset with depreciation cannot be cancelled', pg_temp.err(format($q$select public.void_fixed_asset(%L,'x','2026-10-27')$q$, :'a1')) like '%Depreciation has been posted%');
select public._chk('trial balance balances', (select sum(debit) = sum(credit) from journal_lines));
select public._chk('direct insert into fixed_assets denied', pg_temp.fails($q$insert into fixed_assets(name,put_to_use,cost,method,life_years,dep_from) values ('x','2025-04-01',1,'slm',1,'2025-04-01')$q$));

-- tenant isolation ---------------------------------------------------------------------------------------------------------
reset role; set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public._chk('other user sees no assets, stock or depreciation', (select count(*) from fixed_assets) + (select count(*) from stock_valuations) + (select count(*) from fixed_asset_dep) = 0);
select public._chk('other user cannot cancel my asset', pg_temp.err(format($q$select public.void_fixed_asset(%L,'x','2026-10-27')$q$, :'a1')) like '%Asset not found%');
reset role;
select k, case when ok then 'PASS' else 'FAIL' end as result from public._t where not ok;
select count(*) filter (where not ok) as failures, count(*) as total from public._t;
