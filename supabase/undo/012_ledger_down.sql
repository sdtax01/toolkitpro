-- Undo 010 + 011 + 012. WARNING: permanently deletes the ledger (journals, chart of accounts, lock history).
-- Your invoices, transactions, accounts and parties are NOT touched. Export the ledger first if you need it.
begin;
-- 015-018 extras (only if you installed them): removed first because they depend on the ledger. Their journals go with the ledger below.
drop table if exists public.tds_entries, public.gst_notes, public.fixed_asset_dep, public.fixed_assets, public.stock_valuations;
drop trigger if exists tp_protect_del on public.invoices;
drop trigger if exists tp_invoice_head on public.invoices;   -- 014 head guard (it reads the ledger tables)
drop trigger if exists tp_gl_parent on public.gl_accounts;
drop trigger if exists tp_gl_reserved on public.gl_accounts;
drop function if exists public.tp_invoice_head_guard(), public.tp_gl_parent_guard(), public.add_gl_subledger(text, uuid, text);
drop function if exists public.set_ledger_controls(boolean, boolean), public.tp_protect_delete(), public.tp_protect_note_delete(), public.tp_gl_reserved_guard(),
  public.tp_gl_bal(uuid, text, date), public.post_gst_setoff(date, text), public.set_closing_stock(date, numeric, text, text),
  public.add_fixed_asset(text, text, date, numeric, numeric, text, numeric, numeric, uuid, text, date, numeric, date), public.tp_fa_dep_calc(uuid, date),
  public.preview_depreciation(date), public.post_depreciation(date), public.void_fixed_asset(uuid, text, date), public.tp_fa_immutable(), public.tp_fy_start(date),
  public.tp_note_guard(), public.tp_tds_guard(), public.tp_adjust_after(), public.tp_desired_note(uuid), public.tp_desired_tds(uuid);
alter table if exists public.invoices drop column if exists adjusted, drop column if exists itc_blocked;
do $rp$ begin if to_regproc('public.record_payment(uuid,numeric,date,uuid,text)') is not null then
 execute $f$create or replace function public.record_payment(
  p_invoice uuid, p_amount numeric, p_date date, p_account uuid, p_description text default null)
returns uuid language plpgsql security invoker set search_path = public as $b$
declare v_inv public.invoices%rowtype; v_id uuid; v_amt numeric(14,2);
begin
  v_amt := round(p_amount, 2);
  if v_amt is null or v_amt <= 0 then
    raise exception 'Amount must be greater than zero' using errcode = '22023'; end if;
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  if v_amt > round(v_inv.amount - v_inv.paid, 2) then
    raise exception 'Amount exceeds the balance due' using errcode = '22023'; end if;
  if p_account is not null and not exists (select 1 from public.accounts where id = p_account) then
    raise exception 'Account not found' using errcode = 'P0002'; end if;
  insert into public.transactions (date, description, category, type, amount, account_id, invoice_id)
  values (coalesce(p_date, current_date),
          coalesce(p_description, (case when v_inv.kind = 'sale' then 'Receipt ' else 'Payment ' end) || v_inv.number),
          case when v_inv.kind = 'sale' then 'Sales' else 'Purchases' end,
          case when v_inv.kind = 'sale' then 'income' else 'expense' end,
          v_amt, p_account, v_inv.id)
  returning id into v_id;
  update public.invoices set paid = round(paid + v_amt, 2) where id = v_inv.id;
  return v_id;
end $b$;
$f$; end if; end $rp$;
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
