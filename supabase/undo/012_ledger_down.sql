-- Undo 010 + 011 + 012. WARNING: permanently deletes the ledger (journals, chart of accounts, lock history).
-- Your invoices, transactions, accounts and parties are NOT touched. Export the ledger first if you need it.
begin;
drop trigger if exists tp_post on public.invoices;
drop trigger if exists tp_post on public.transactions;
drop trigger if exists tp_post on public.accounts;
drop function if exists public.tp_post_trigger();
drop function if exists public.resync_ledger(boolean), public.setup_ledger(date), public.ledger_unsynced(), public.add_gl_account(text,text,text),
  public.post_manual_journal(date,text,jsonb), public.reverse_journal(uuid,text,date), public.set_period_lock(date);
drop function if exists public.tp_sync_one(text,uuid,uuid), public.tp_sync_source(uuid,text,uuid,date,text,jsonb,text),
  public.tp_desired_opening(uuid), public.tp_desired_txn(uuid), public.tp_desired_invoice(uuid),
  public.tp_line(uuid,numeric,numeric,uuid), public.tp_gl_cat(uuid,text,text), public.tp_gl_bank(uuid,uuid), public.tp_gl(uuid,text);
-- the "immutable" rules would block dropping rows, so remove them before the tables
drop trigger if exists tp_lines_imm on public.journal_lines;
drop trigger if exists tp_journals_imm on public.journals;
alter table if exists public.invoices drop column if exists gl_account_id;   -- added by 014, if installed
drop table if exists public.journal_lines;
drop table if exists public.journals;
drop table if exists public.gl_accounts;
drop table if exists public.ledger_errors;
drop table if exists public.ledger_lock_history;
drop table if exists public.ledger_settings;
drop function if exists public.tp_journal_before_insert(), public.tp_immutable(), public.tp_check_balanced(), public.tp_gl_account_guard();
commit;
