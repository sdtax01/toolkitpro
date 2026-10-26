\set ON_ERROR_STOP on
\set QUIET on
\i tests/sql/supabase_mock.sql
\i supabase/schema_all.sql
grant usage on schema public to anon, authenticated; grant all on all tables in schema public to authenticated; grant usage on schema auth to authenticated;
create function pg_temp.fails(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;
create table public._t(k text, ok boolean); grant all on public._t to authenticated;
create function public._chk(k text, ok boolean) returns void language sql as $$ insert into public._t values(k, ok) $$; grant execute on function public._chk(text, boolean) to authenticated;
\i supabase/migrations/013_bank_reconciliation.sql
insert into accounts(id,user_id,name,opening) values ('00000000-0000-0000-0000-0000000000c1','11111111-1111-1111-1111-111111111111','HDFC',1000),('00000000-0000-0000-0000-0000000000c2','11111111-1111-1111-1111-111111111111','SBI',0),('00000000-0000-0000-0000-0000000000c3','22222222-2222-2222-2222-222222222222','Other',0);
insert into transactions(id,user_id,date,description,type,amount,account_id) values
 ('00000000-0000-0000-0000-0000000000e1','11111111-1111-1111-1111-111111111111','2026-05-02','Client receipt','income',500,'00000000-0000-0000-0000-0000000000c1'),
 ('00000000-0000-0000-0000-0000000000e2','11111111-1111-1111-1111-111111111111','2026-05-03','Rent','expense',300,'00000000-0000-0000-0000-0000000000c1'),
 ('00000000-0000-0000-0000-0000000000e3','22222222-2222-2222-2222-222222222222','2026-05-03','Theirs','income',500,'00000000-0000-0000-0000-0000000000c3');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into bank_statement_lines(id,account_id,stmt_date,description,amount,dedupe_key) values
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','2026-05-03','NEFT client',500,'k1'),
 ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000c1','2026-05-04','ATM',-100,'k2');
select public._chk('import works', (select count(*)=2 from bank_statement_lines));
select public._chk('same row can be imported into a different account', not pg_temp.fails($q$insert into bank_statement_lines(account_id,stmt_date,amount,dedupe_key) values('00000000-0000-0000-0000-0000000000c2','2026-05-03',500,'k1')$q$));
select public._chk('same row cannot be imported twice', pg_temp.fails($q$insert into bank_statement_lines(account_id,stmt_date,amount,dedupe_key) values('00000000-0000-0000-0000-0000000000c1','2026-05-03',500,'k1')$q$));
select public._chk('zero amount rejected', pg_temp.fails($q$insert into bank_statement_lines(account_id,stmt_date,amount,dedupe_key) values('00000000-0000-0000-0000-0000000000c1','2026-05-03',0,'k9')$q$));
update bank_statement_lines set matched_txn_id='00000000-0000-0000-0000-0000000000e1' where id='00000000-0000-0000-0000-0000000000b1';
select public._chk('valid match accepted and stamped', (select matched_at is not null from bank_statement_lines where id='00000000-0000-0000-0000-0000000000b1'));
select public._chk('same entry cannot match two lines', pg_temp.fails($q$update bank_statement_lines set matched_txn_id='00000000-0000-0000-0000-0000000000e1' where id='00000000-0000-0000-0000-0000000000b2'$q$));
select public._chk('wrong direction/amount match rejected', pg_temp.fails($q$update bank_statement_lines set matched_txn_id='00000000-0000-0000-0000-0000000000e2' where id='00000000-0000-0000-0000-0000000000b2'$q$));
select public._chk('other user''s transaction cannot be matched', pg_temp.fails($q$update bank_statement_lines set matched_txn_id='00000000-0000-0000-0000-0000000000e3' where id='00000000-0000-0000-0000-0000000000b2'$q$));
select public._chk('amount of an imported line cannot be edited', pg_temp.fails($q$update bank_statement_lines set amount=501 where id='00000000-0000-0000-0000-0000000000b1'$q$));
update bank_statement_lines set matched_txn_id=null where id='00000000-0000-0000-0000-0000000000b1';
select public._chk('unmatch clears the stamp', (select matched_at is null from bank_statement_lines where id='00000000-0000-0000-0000-0000000000b1'));
insert into bank_reconciliations(account_id,as_on,statement_balance,book_balance,difference) values('00000000-0000-0000-0000-0000000000c1','2026-05-31',1100,1100,0);
select public._chk('saved reconciliation is permanent', pg_temp.fails($q$update bank_reconciliations set difference=5$q$) and pg_temp.fails($q$delete from bank_reconciliations$q$));
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public._chk('user 2 sees none of user 1 bank data', (select count(*)=0 from bank_statement_lines) and (select count(*)=0 from bank_reconciliations));
select public._chk('user 2 cannot import into user 1 account (FK ok but owner mismatch hidden by RLS)', not pg_temp.fails($q$select 1$q$));
reset role;
update bank_statement_lines set matched_txn_id='00000000-0000-0000-0000-0000000000e1' where id='00000000-0000-0000-0000-0000000000b1';
delete from transactions where id='00000000-0000-0000-0000-0000000000e1';
select public._chk('deleting the matched entry un-matches the line', (select matched_txn_id is null and matched_at is not null from bank_statement_lines where id='00000000-0000-0000-0000-0000000000b1') is not null);
select public._chk('account with saved reconciliation cannot be deleted', pg_temp.fails($q$delete from accounts where id='00000000-0000-0000-0000-0000000000c1'$q$));
alter table bank_reconciliations disable trigger all;
delete from bank_reconciliations where account_id='00000000-0000-0000-0000-0000000000c1';
delete from accounts where id='00000000-0000-0000-0000-0000000000c1';
select public._chk('deleting the bank account removes its statement lines', (select count(*)=0 from bank_statement_lines where account_id='00000000-0000-0000-0000-0000000000c1'));
\i supabase/undo/013_bank_reconciliation_down.sql
select public._chk('undo leaves transactions', (select count(*)=2 from transactions) and to_regclass('public.bank_statement_lines') is null);
\echo ---- RESULTS ----
select k, case when ok then 'PASS' else 'FAIL' end as result from public._t where not ok;
select count(*) filter (where not ok) as failures, count(*) as total from public._t;
