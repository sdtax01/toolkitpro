-- Undo 013. Deletes imported statement lines and saved reconciliations only. Your transactions are not touched.
begin;
drop trigger if exists tp_stmt_guard on public.bank_statement_lines;
drop function if exists public.tp_stmt_guard();
drop table if exists public.bank_reconciliations;
drop table if exists public.bank_statement_lines;
commit;
