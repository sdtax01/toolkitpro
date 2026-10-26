\set ON_ERROR_STOP on
\set QUIET on
\i tests/sql/supabase_mock.sql
\i supabase/schema_all.sql
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant usage on schema auth to authenticated;

create function pg_temp.fails(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;
create table public._t(k text, ok boolean); grant all on public._t to authenticated;
create function public._chk(k text, ok boolean) returns void language sql as $$ insert into public._t values(k, ok) $$;
grant execute on function public._chk(text, boolean) to authenticated;

insert into parties(id,user_id,name,kind,state) values
 ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','Cust A','client','MH'),
 ('00000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','Cust B','client','MH');
insert into accounts(id,user_id,name,opening) values
 ('00000000-0000-0000-0000-0000000000c1','11111111-1111-1111-1111-111111111111','HDFC',0),
 ('00000000-0000-0000-0000-0000000000c2','22222222-2222-2222-2222-222222222222','Other',0);
insert into invoices(id,user_id,party_id,kind,number,amount,paid,taxable,gst_rate,cgst,sgst,igst) values
 ('00000000-0000-0000-0000-0000000000d1','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1','sale','INV-0001',1180,0,1000,18,90,90,0),
 ('00000000-0000-0000-0000-0000000000d2','22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-0000000000b1','sale','INV-0001',500,0,null,0,0,0,0);

select public._chk('diag clean', (select count(*)=0 from (
 select 1 from invoices group by user_id,kind,lower(btrim(number)) having count(*)>1
 union all select 1 from invoices where paid<0 or paid>amount) d));

\i supabase/migrations/001_constraints.sql
select public._chk('dup number blocked', pg_temp.fails($q$insert into invoices(user_id,kind,number,amount) values('11111111-1111-1111-1111-111111111111','sale','  inv-0001 ',10)$q$));
select public._chk('same number other user ok', not pg_temp.fails($q$insert into invoices(user_id,kind,number,amount) values('22222222-2222-2222-2222-222222222222','purchase','INV-0001',10)$q$));
select public._chk('paid>amount blocked', pg_temp.fails($q$update invoices set paid=2000 where id='00000000-0000-0000-0000-0000000000d1'$q$));
select public._chk('gst mismatch blocked', pg_temp.fails($q$update invoices set cgst=1 where id='00000000-0000-0000-0000-0000000000d1'$q$));

\i supabase/migrations/002_payment_functions.sql
\i supabase/migrations/003_audit.sql

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.record_payment('00000000-0000-0000-0000-0000000000d1', 500.004, '2026-10-24', '00000000-0000-0000-0000-0000000000c1', 'Receipt INV-0001 - Cust A') is not null as ok;
select public._chk('paid=500', (select paid=500 from invoices where id='00000000-0000-0000-0000-0000000000d1'));
select public._chk('txn linked', (select count(*)=1 and min(type)='income' and min(amount)=500 from transactions where invoice_id='00000000-0000-0000-0000-0000000000d1'));
select public._chk('overpay blocked', pg_temp.fails($q$select public.record_payment('00000000-0000-0000-0000-0000000000d1', 700, null, null)$q$));
select public._chk('zero blocked', pg_temp.fails($q$select public.record_payment('00000000-0000-0000-0000-0000000000d1', 0, null, null)$q$));
select public._chk('state unchanged after failure', (select paid=500 from invoices where id='00000000-0000-0000-0000-0000000000d1') and (select count(*)=1 from transactions));
select public._chk('foreign account blocked', pg_temp.fails($q$select public.record_payment('00000000-0000-0000-0000-0000000000d1', 10, null, '00000000-0000-0000-0000-0000000000c2')$q$));
select public.record_payment('00000000-0000-0000-0000-0000000000d1', 680, null, null) is not null as ok;
select public._chk('fully paid', (select paid=amount from invoices where id='00000000-0000-0000-0000-0000000000d1'));
select public.delete_payment((select id from transactions where amount=680));
select public._chk('delete reverses', (select paid=500 from invoices where id='00000000-0000-0000-0000-0000000000d1') and (select count(*)=1 from transactions));
select public._chk('audit own visible', (select count(*)>0 from audit_log));
select public._chk('audit insert denied', pg_temp.fails($q$insert into audit_log(table_name,action) values('x','y')$q$));
select public._chk('audit update denied', pg_temp.fails($q$update audit_log set action='z'$q$));
select public._chk('audit delete denied', pg_temp.fails($q$delete from audit_log$q$));
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public._chk('other user cannot pay my invoice', pg_temp.fails($q$select public.record_payment('00000000-0000-0000-0000-0000000000d1', 10, null, null)$q$));
select public._chk('other user sees none of my audit', (select count(*)=0 from audit_log where user_id='11111111-1111-1111-1111-111111111111'));
reset role;
select public._chk('updated_at set', (select updated_at is not null from invoices where id='00000000-0000-0000-0000-0000000000d1'));
select public._chk('audit has UPDATE row', (select count(*)>0 from audit_log where action='UPDATE' and table_name='invoices'));

\i supabase/migrations/optional/005_money_scale.sql
select public._chk('scale applied', (select numeric_scale=2 from information_schema.columns where table_name='invoices' and column_name='amount'));
\i supabase/undo/005_money_scale_down.sql
\i supabase/migrations/optional/004_fk_restrict.sql
select public._chk('party delete restricted', pg_temp.fails($q$delete from parties where id='00000000-0000-0000-0000-0000000000a1'$q$));
\i supabase/undo/004_fk_restrict_down.sql

\i supabase/undo/003_audit_down.sql
\i supabase/undo/002_payment_functions_down.sql
\i supabase/undo/001_constraints_down.sql
select public._chk('down: dup allowed again', not pg_temp.fails($q$insert into invoices(user_id,kind,number,amount) values('11111111-1111-1111-1111-111111111111','sale','INV-0001',10)$q$));
delete from parties where id='00000000-0000-0000-0000-0000000000a1';
select public._chk('down: cascade restored', (select count(*)=0 from invoices where party_id='00000000-0000-0000-0000-0000000000a1'));
\echo ---- RESULTS ----
select k, case when ok then 'PASS' else 'FAIL' end as result from public._t;
select count(*) filter (where not ok) as failures, count(*) as total from public._t;
