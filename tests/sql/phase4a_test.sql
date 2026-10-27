\set ON_ERROR_STOP on
\set QUIET on
-- Tests for 015 (posting controls) and 016 (accounts, categories, GST set-off). Run: psql -f tests/sql/phase4a_test.sql
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
create function public.bal(p_user uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit),0) from journal_lines l join gl_accounts a on a.id = l.gl_account_id where l.user_id = p_user and a.system_key = p_key $$;
grant execute on function public.bal(uuid, text) to authenticated;

insert into parties(id,user_id,name,kind,state) values
 ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','Cust A','client','MH'),
 ('00000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','Supp B','supplier','MH');
insert into accounts(id,user_id,name,opening) values ('00000000-0000-0000-0000-0000000000c1','11111111-1111-1111-1111-111111111111','HDFC',100000);
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.setup_ledger('2026-04-01');

-- 015 controls -------------------------------------------------------------------------------------------------------
select public._chk('controls default off', (select not strict_posting and not protect_documents from ledger_settings));
-- default behaviour unchanged: a failing posting is logged and the invoice still saves
insert into invoices(id,party_id,kind,number,date,amount,taxable,cgst,sgst,igst) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','sale','INV-1','2026-05-10',1180,1000,90,90,0);
select public._chk('sale posted', public.bal('11111111-1111-1111-1111-111111111111','receivables') = 1180);
select public._chk('delete allowed when protection off', not pg_temp.fails($q$delete from invoices where id='00000000-0000-0000-0000-0000000000d1'$q$));
select public._chk('delete reversed ledger', public.bal('11111111-1111-1111-1111-111111111111','receivables') = 0);
select public.set_ledger_controls(true, true);
select public._chk('controls on', (select strict_posting and protect_documents from ledger_settings));
insert into invoices(id,party_id,kind,number,date,amount,taxable,cgst,sgst,igst) values ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000a1','sale','INV-2','2026-05-11',1180,1000,90,90,0);
select public._chk('protect: sales invoice cannot be deleted', pg_temp.err($q$delete from invoices where id='00000000-0000-0000-0000-0000000000d2'$q$) like '%credit note%');
insert into invoices(id,party_id,kind,number,date,amount,taxable,cgst,sgst,igst) values ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000a2','purchase','BILL-1','2026-05-12',590,500,45,45,0);
select public.record_payment('00000000-0000-0000-0000-0000000000d3', 100, '2026-05-13', '00000000-0000-0000-0000-0000000000c1');
select public._chk('protect: bill with payment cannot be deleted', pg_temp.err($q$delete from invoices where id='00000000-0000-0000-0000-0000000000d3'$q$) like '%recorded payments%');
-- strict: unexpected posting error rolls back the whole save (tax > total)
select public._chk('strict: bad invoice not saved', pg_temp.fails($q$insert into invoices(party_id,kind,number,date,amount,taxable,cgst,sgst,igst) values ('00000000-0000-0000-0000-0000000000a1','sale','BAD-1','2026-05-14',100,null,90,90,0)$q$)
   and not exists (select 1 from invoices where number='BAD-1'));
select public.set_ledger_controls(false, false);
insert into invoices(party_id,kind,number,date,amount,taxable,cgst,sgst,igst) values ('00000000-0000-0000-0000-0000000000a1','sale','BAD-2','2026-05-14',100,null,90,90,0);
select public._chk('non-strict: bad invoice still saved', exists (select 1 from invoices where number='BAD-2'));
select public._chk('non-strict: failure is logged', exists (select 1 from ledger_errors where message like '%tax larger%'));
delete from invoices where number = 'BAD-2';

-- 016 categories ------------------------------------------------------------------------------------------------------
insert into transactions(date,description,category,type,amount,account_id) values
 ('2026-06-01','Customer advance','Advance received','income',5000,'00000000-0000-0000-0000-0000000000c1'),
 ('2026-06-02','Owner capital','Capital introduced','income',20000,'00000000-0000-0000-0000-0000000000c1'),
 ('2026-06-03','Supplier advance','Advance paid','expense',3000,'00000000-0000-0000-0000-0000000000c1'),
 ('2026-06-04','GST challan','GST payment','expense',700,'00000000-0000-0000-0000-0000000000c1'),
 ('2026-06-05','TDS challan','TDS deposited','expense',200,'00000000-0000-0000-0000-0000000000c1'),
 ('2026-06-06','Owner withdrawal','Drawings','expense',1500,'00000000-0000-0000-0000-0000000000c1'),
 ('2026-06-07','Old style tax','Taxes','expense',50,'00000000-0000-0000-0000-0000000000c1');
select public._chk('advance received -> liability', public.bal('11111111-1111-1111-1111-111111111111','customer_advances') = -5000);
select public._chk('capital -> equity', public.bal('11111111-1111-1111-1111-111111111111','capital') = -20000);
select public._chk('advance paid -> asset', public.bal('11111111-1111-1111-1111-111111111111','supplier_advances') = 3000);
select public._chk('GST payment -> GST paid account', public.bal('11111111-1111-1111-1111-111111111111','gst_cash') = 700);
select public._chk('TDS deposited -> TDS payable debit', public.bal('11111111-1111-1111-1111-111111111111','tds_payable') = 200);
select public._chk('drawings -> equity debit', public.bal('11111111-1111-1111-1111-111111111111','drawings') = 1500);
select public._chk('Taxes category unchanged (its own expense account)', (select coalesce(sum(l.debit-l.credit),0) from journal_lines l join gl_accounts a on a.id=l.gl_account_id where a.name='Taxes' and a.type='expense' and a.system_key is null) = 50);
select public._chk('trial balance still balances', (select sum(debit) = sum(credit) from journal_lines));
select public._chk('hand-made account cannot take reserved code', pg_temp.err($q$select public.add_gl_account('1300','My stock','asset')$q$) like '%reserved%');

-- 016 GST set-off ---------------------------------------------------------------------------------------------------
-- output: CGST 90 SGST 90 (INV-2). input: CGST 45 SGST 45 (BILL-1). GST paid account holds 700.
select (public.post_gst_setoff('2026-06-30')->>'journal_id') is not null as made \gset
select public._chk('set-off created', :'made');
select public._chk('set-off cleared CGST output', public.bal('11111111-1111-1111-1111-111111111111','output_cgst') = 0);
select public._chk('set-off cleared SGST output', public.bal('11111111-1111-1111-1111-111111111111','output_sgst') = 0);
select public._chk('input credit fully used', public.bal('11111111-1111-1111-1111-111111111111','input_cgst') = 0 and public.bal('11111111-1111-1111-1111-111111111111','input_sgst') = 0);
select public._chk('GST paid account used for the remaining 90', public.bal('11111111-1111-1111-1111-111111111111','gst_cash') = 700 - 90);
select public._chk('set-off is one balanced journal', (select sum(debit) = sum(credit) from journal_lines where journal_id = (select id from journals where kind='manual' and narration like 'GST set-off%')));
select (public.post_gst_setoff('2026-06-30')->>'journal_id') is null as again \gset
select public._chk('second set-off is a no-op (idempotent)', :'again');
-- IGST credit used against CGST when IGST liability is nil
insert into parties(id,user_id,name,kind,state) values ('00000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','Out of state supp','supplier','KA');
insert into invoices(party_id,kind,number,date,amount,taxable,cgst,sgst,igst) values ('00000000-0000-0000-0000-0000000000a3','purchase','BILL-IG','2026-07-02',1180,1000,0,0,180);
insert into invoices(party_id,kind,number,date,amount,taxable,cgst,sgst,igst) values ('00000000-0000-0000-0000-0000000000a1','sale','INV-3','2026-07-03',1180,1000,90,90,0);
select public.post_gst_setoff('2026-07-31');
select public._chk('IGST credit offsets CGST then SGST', public.bal('11111111-1111-1111-1111-111111111111','output_cgst') = 0 and public.bal('11111111-1111-1111-1111-111111111111','output_sgst') = 0 and public.bal('11111111-1111-1111-1111-111111111111','input_igst') = 0);
-- other tenant isolation
reset role; set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public._chk('other user sees no journals', (select count(*) = 0 from journals));
select public._chk('other user cannot set controls without ledger', pg_temp.err($q$select public.set_ledger_controls(true,true)$q$) like '%Set up the ledger%');
reset role;
select k, case when ok then 'PASS' else 'FAIL' end as result from public._t where not ok or k like 'x%';
select count(*) filter (where not ok) as failures, count(*) as total from public._t;
