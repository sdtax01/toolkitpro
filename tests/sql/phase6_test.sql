\set ON_ERROR_STOP on
\set QUIET on
-- Practice suite (migration 023). Run from the repo root on an empty local database:
--   createdb tp6 && psql -d tp6 -v ON_ERROR_STOP=1 -f tests/sql/phase6_test.sql
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
\i supabase/migrations/023_practice_suite.sql
\i supabase/migrations/023_practice_suite.sql
grant all on all tables in schema public to authenticated;

insert into parties(id,user_id,name,kind) values
 ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','Cust A','client'),
 ('00000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','Other co','client');

set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into client_master(party_id,pan,tan,constitution,services,gst_frequency,fee_amount,fee_cycle) values ('00000000-0000-0000-0000-0000000000a1','ABCDE1234F','PUNA12345B','firm','{gstr1,gstr3b,itr}','qrmp',5000,'monthly');
select public._chk('client master saved for own client and user_id defaults to the caller', (select user_id from client_master) = '11111111-1111-1111-1111-111111111111');
select public._chk('one master row per client', pg_temp.err($q$insert into client_master(party_id) values ('00000000-0000-0000-0000-0000000000a1')$q$) is not null);
select public._chk('bad status rejected', pg_temp.err($q$update client_master set status='x'$q$) is not null);
select public._chk('bad frequency rejected', pg_temp.err($q$update client_master set gst_frequency='weekly'$q$) is not null);
insert into compliance_tasks(party_id,service,period,title,due_date) values ('00000000-0000-0000-0000-0000000000a1','gstr3b','2026-09','GSTR-3B Sep 2026','2026-10-20');
select public._chk('duplicate task for same client, service and period rejected', pg_temp.err($q$insert into compliance_tasks(party_id,service,period,title,due_date) values ('00000000-0000-0000-0000-0000000000a1','gstr3b','2026-09','dup','2026-10-20')$q$) is not null);
insert into compliance_tasks(party_id,service,period,title,due_date) values (null,'firm_x','2026-09','Firm task','2026-10-20');
select public._chk('firm-level duplicate rejected too (null party)', pg_temp.err($q$insert into compliance_tasks(party_id,service,period,title,due_date) values (null,'firm_x','2026-09','dup','2026-10-20')$q$) is not null);
select public._chk('bad task status rejected', pg_temp.err($q$update compliance_tasks set status='done'$q$) is not null);
update compliance_tasks set status='filed', filed_on='2026-10-18', ack_no='AA270926123456' where service='gstr3b';
select public._chk('update stamps updated_at', (select updated_at from compliance_tasks where service='gstr3b') is not null);
insert into recurring_invoices(party_id,description,amount,gst_rate,frequency,next_date) values ('00000000-0000-0000-0000-0000000000a1','Monthly retainer',5000,18,'monthly','2026-11-01');
select public._chk('amount must be positive', pg_temp.err($q$update recurring_invoices set amount=0$q$) is not null);
select public._chk('frequency checked', pg_temp.err($q$update recurring_invoices set frequency='daily'$q$) is not null);
reset role;

set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public._chk('other user sees none of it', (select count(*) from client_master)+(select count(*) from compliance_tasks)+(select count(*) from recurring_invoices) = 0);
select public._chk('other user cannot insert rows as someone else', pg_temp.err($q$insert into client_master(user_id,party_id) values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000b1')$q$) is not null);
with u as (update compliance_tasks set remarks='x' returning 1), d as (delete from recurring_invoices returning 1) select public._chk('other user cannot update or delete', (select count(*) from u)+(select count(*) from d) = 0);
reset role;

set role anon;
select pg_temp.err($q$select * from client_master$q$) as anon_err \gset
reset role;
select public._chk('anon has no access', :'anon_err' <> '');

-- deleting the client removes its practice rows
delete from parties where id='00000000-0000-0000-0000-0000000000a1';
select public._chk('deleting a customer removes its master, tasks and recurring setups', (select count(*) from client_master where user_id='11111111-1111-1111-1111-111111111111')=0 and (select count(*) from recurring_invoices where user_id='11111111-1111-1111-1111-111111111111')=0 and (select count(*) from compliance_tasks where party_id is not null and user_id='11111111-1111-1111-1111-111111111111')=0);
\i supabase/undo/023_practice_suite_down.sql
select public._chk('undo drops the three tables', to_regclass('public.client_master') is null and to_regclass('public.compliance_tasks') is null and to_regclass('public.recurring_invoices') is null);
select public._chk('undo leaves customers and invoices alone', to_regclass('public.parties') is not null and to_regclass('public.invoices') is not null);

\echo ---- results
select k, ok from public._t where not ok;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from public._t;
