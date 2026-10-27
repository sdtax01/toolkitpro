\set ON_ERROR_STOP on
\set QUIET on
-- Tests for 018 (credit/debit notes, TDS, ITC not allowed). Run: psql -f tests/sql/phase4c_test.sql
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



create function public.tbal(p_key text) returns numeric language sql as $$ select public.bal('11111111-1111-1111-1111-111111111111', p_key) $$;
grant execute on function public.tbal(text) to authenticated;
insert into parties(id,user_id,name,kind,state) values
 ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','Cust A','client','MH'),
 ('00000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','Supp B','supplier','MH'),
 ('00000000-0000-0000-0000-0000000000a9','22222222-2222-2222-2222-222222222222','Other tenant cust','client','MH');
insert into accounts(id,user_id,name,opening) values ('00000000-0000-0000-0000-0000000000c1','11111111-1111-1111-1111-111111111111','HDFC',100000);
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.setup_ledger('2026-04-01');
insert into invoices(id,party_id,kind,number,date,amount,taxable,cgst,sgst,igst) values
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','sale','INV-1','2026-05-10',1180,1000,90,90,0),
 ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000a1','sale','INV-2','2026-05-11',11800,10000,900,900,0),
 ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000a2','purchase','BILL-1','2026-05-12',11800,10000,900,900,0),
 ('00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-0000000000a1','sale','INV-IG','2026-05-13',1180,1000,0,0,180);
insert into invoices(id,party_id,kind,number,date,amount,taxable,cgst,sgst,igst,itc_blocked) values
 ('00000000-0000-0000-0000-0000000000d5','00000000-0000-0000-0000-0000000000a2','purchase','BILL-BLK','2026-05-14',1180,1000,90,90,0,true);

-- ITC not allowed -------------------------------------------------------------------------------------------------------------
select public._chk('blocked bill: no input credit', public.tbal('input_cgst') = 900 and public.tbal('input_sgst') = 900);  -- only BILL-1's
select public._chk('blocked bill: tax is part of cost (purchases 10000 + 1180)', public.tbal('purchases') = 11180);
select public._chk('normal bill unchanged: payables 11800 + 1180', public.tbal('payables') = -(11800 + 1180));
select public._chk('ITC flag only allowed on purchases', pg_temp.fails($q$insert into invoices(party_id,kind,number,date,amount,taxable,cgst,sgst,igst,itc_blocked) values ('00000000-0000-0000-0000-0000000000a1','sale','INV-X','2026-05-15',100,100,0,0,0,true)$q$));

-- credit note on a sales invoice -----------------------------------------------------------------------------------------------
insert into gst_notes(id,kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values
 ('00000000-0000-0000-0000-0000000000e1','credit','00000000-0000-0000-0000-0000000000d1','CN-1','2026-05-20',500,45,45,0,590,'Goods returned');
select public._chk('credit note reduces debtors by 590', public.tbal('receivables') = (1180 - 590) + 11800 + 1180);
select public._chk('credit note reduces sales and output tax', public.tbal('sales') = -(1000 - 500 + 10000 + 1000) and public.tbal('output_cgst') = -(90 - 45 + 900));
select public._chk('invoice outstanding reduced via adjusted', (select adjusted = 590 from invoices where id = '00000000-0000-0000-0000-0000000000d1'));
select public._chk('original invoice amount untouched', (select amount = 1180 and taxable = 1000 from invoices where id = '00000000-0000-0000-0000-0000000000d1'));
select public._chk('payment above balance after note refused', pg_temp.err($q$select public.record_payment('00000000-0000-0000-0000-0000000000d1', 600, '2026-05-21', '00000000-0000-0000-0000-0000000000c1')$q$) like '%exceeds the balance%');
select public.record_payment('00000000-0000-0000-0000-0000000000d1', 590, '2026-05-21', '00000000-0000-0000-0000-0000000000c1');
select public._chk('invoice fully settled (paid + note)', public.tbal('receivables') = 11800 + 1180);
-- validations
select public._chk('note over the invoice tax refused', pg_temp.err($q$insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('credit','00000000-0000-0000-0000-0000000000d1','CN-2','2026-05-22',500,50,50,0,600,'x')$q$) like '%exceeds the tax left%');
select public._chk('IGST note on an intra-state invoice refused', pg_temp.err($q$insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('credit','00000000-0000-0000-0000-0000000000d1','CN-3','2026-05-22',100,0,0,18,118,'x')$q$) like '%CGST/SGST%');
select public._chk('CGST/SGST note on an IGST invoice refused', pg_temp.err($q$insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('credit','00000000-0000-0000-0000-0000000000d4','CN-4','2026-05-22',100,9,9,0,118,'x')$q$) like '%IGST%');
select public._chk('unequal CGST/SGST refused', pg_temp.err($q$insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('credit','00000000-0000-0000-0000-0000000000d2','CN-5','2026-05-22',100,10,8,0,118,'x')$q$) like '%must be equal%');
select public._chk('note before invoice date refused', pg_temp.err($q$insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('credit','00000000-0000-0000-0000-0000000000d2','CN-6','2026-05-01',100,9,9,0,118,'x')$q$) like '%before the invoice%');
select public._chk('debit note against a sales invoice refused', pg_temp.err($q$insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('debit','00000000-0000-0000-0000-0000000000d2','DN-1','2026-05-22',100,9,9,0,118,'x')$q$) like '%purchase bill%');
select public._chk('duplicate note number refused', pg_temp.fails($q$insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('credit','00000000-0000-0000-0000-0000000000d2','cn-1','2026-05-22',100,9,9,0,118,'x')$q$));
select public._chk('total mismatch refused', pg_temp.fails($q$insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('credit','00000000-0000-0000-0000-0000000000d2','CN-7','2026-05-22',100,9,9,0,999,'x')$q$));
select public._chk('note cannot be edited by the user', pg_temp.fails($q$update gst_notes set reason = 'changed' where number = 'CN-1'$q$));
select public._chk('failed validations left the ledger untouched', (select count(*) from gst_notes) = 1);
-- debit note: normal and ITC-blocked bills
insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('debit','00000000-0000-0000-0000-0000000000d3','DN-1','2026-05-25',1000,90,90,0,1180,'Returned to supplier');
select public._chk('debit note: creditors, purchases and input credit reduced', public.tbal('payables') = -(11800 - 1180 + 1180) and public.tbal('purchases') = 11180 - 1000 and public.tbal('input_cgst') = 900 - 90);
insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('debit','00000000-0000-0000-0000-0000000000d5','DN-2','2026-05-26',500,45,45,0,590,'Part return, ITC blocked');
select public._chk('debit note on blocked bill: no input tax, full cost reversed', public.tbal('input_cgst') = 900 - 90 and public.tbal('purchases') = 11180 - 1000 - 590);

-- TDS --------------------------------------------------------------------------------------------------------------------------
insert into tds_entries(id,invoice_id,date,amount,section,note) values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000d2','2026-06-05',200,'194C','customer deducted');
select public._chk('TDS receivable posted, debtors reduced', public.tbal('tds_receivable') = 200 and public.tbal('receivables') = 11800 + 1180 - 200);
select public.record_payment('00000000-0000-0000-0000-0000000000d2', 11600, '2026-06-06', '00000000-0000-0000-0000-0000000000c1');
select public._chk('receipt net of TDS settles the invoice', public.tbal('receivables') = 1180);
select public._chk('TDS above balance refused', pg_temp.err($q$insert into tds_entries(invoice_id,date,amount,section) values ('00000000-0000-0000-0000-0000000000d2','2026-06-07',1,'x')$q$) like '%exceeds the balance%');
insert into tds_entries(invoice_id,date,amount,section) values ('00000000-0000-0000-0000-0000000000d3','2026-06-08',100,'194J');
select public._chk('TDS on a bill: creditors down, TDS payable up', public.tbal('tds_payable') = -100);
insert into transactions(date,description,category,type,amount,account_id) values ('2026-06-09','TDS challan','TDS deposited','expense',100,'00000000-0000-0000-0000-0000000000c1');
select public._chk('TDS deposit clears TDS payable', public.tbal('tds_payable') = 0);
delete from tds_entries where invoice_id = '00000000-0000-0000-0000-0000000000d3';
select public._chk('deleting a TDS entry reverses it and frees the invoice', public.tbal('tds_payable') = 100 and (select adjusted from invoices where id='00000000-0000-0000-0000-0000000000d3') = 1180);

-- sub-ledger agrees with the ledger -----------------------------------------------------------------------------------------------------
select public._chk('debtors ledger = invoices outstanding', public.tbal('receivables') = (select sum(amount - paid - adjusted) from invoices where kind = 'sale'));
select public._chk('creditors ledger = bills outstanding', -public.tbal('payables') = (select sum(amount - paid - adjusted) from invoices where kind = 'purchase'));
select public._chk('nothing out of sync', (select count(*) = 0 from public.ledger_unsynced()));
select public._chk('re-sync is a no-op (idempotent)', (public.resync_ledger()->>'posted')::int = 0 and (public.resync_ledger()->>'reversed')::int = 0);
select public._chk('trial balance balances', (select sum(debit) = sum(credit) from journal_lines));

-- protection + period lock ----------------------------------------------------------------------------------------------------------
select public.set_ledger_controls(false, true);
select public._chk('protect: note cannot be deleted', pg_temp.err($q$delete from gst_notes where number='CN-1'$q$) like '%cannot be deleted%');
select public.set_ledger_controls(false, false);
select public.set_period_lock('2026-05-31');
select public._chk('lock blocks a note in a locked period, nothing saved', pg_temp.fails($q$insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('credit','00000000-0000-0000-0000-0000000000d2','CN-L','2026-05-30',100,9,9,0,118,'x')$q$)
  and not exists (select 1 from gst_notes where number = 'CN-L'));
select public._chk('lock blocks deleting an old note', pg_temp.fails($q$delete from gst_notes where number='CN-1'$q$) and (select adjusted = 590 from invoices where id = '00000000-0000-0000-0000-0000000000d1'));
select public.set_period_lock(null);
delete from gst_notes where number = 'CN-1';
select public._chk('deleting a note reverses the ledger', (select adjusted = 0 from invoices where id = '00000000-0000-0000-0000-0000000000d1'));
select public._chk('journals only ever grow: reversal rows exist', exists (select 1 from journals where kind = 'reversal' and narration like '%Credit note CN-1%'));

-- tenant isolation --------------------------------------------------------------------------------------------------------------------
reset role; set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public._chk('other user sees no notes or TDS', (select count(*) from gst_notes) + (select count(*) from tds_entries) = 0);
select public._chk('other user cannot raise a note on my invoice', pg_temp.err($q$insert into gst_notes(kind,invoice_id,number,date,taxable,cgst,sgst,igst,amount,reason) values ('credit','00000000-0000-0000-0000-0000000000d2','CN-X','2026-07-01',100,9,9,0,118,'x')$q$) like '%Invoice not found%');
select public._chk('other user cannot add TDS to my invoice', pg_temp.err($q$insert into tds_entries(invoice_id,date,amount) values ('00000000-0000-0000-0000-0000000000d2','2026-07-01',1)$q$) like '%Invoice not found%');
reset role;
select k, case when ok then 'PASS' else 'FAIL' end as result from public._t where not ok;
select count(*) filter (where not ok) as failures, count(*) as total from public._t;
