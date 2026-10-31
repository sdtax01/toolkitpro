-- 022_series_import_reset.sql - document numbering series, expense voucher numbers, and "Reset posted entries".
-- Additive and safe to run more than once. Run AFTER 010-020 (and 021 if you have it). Staging first, after a backup.
-- Undo: supabase/undo/022_series_import_reset_down.sql
--
-- 1. settings.doc_series (jsonb): the numbering series chosen in Settings > Document numbering.
-- 2. transactions.voucher_no: number of an expense voucher (series "expense"). Receipts/payments against invoices keep their own references.
-- 3. reset_posted_entries(): deletes ONLY posted entries, in one database transaction, and keeps everything else:
--      erased : sales invoices, purchase bills (and their line items), receipts / payments / expenses (transactions), credit and debit notes,
--               TDS entries, closing-stock valuations, depreciation postings, and every journal that came from them (including manual journals).
--      kept   : customers and suppliers, cash / bank accounts and their opening balances (and the opening-balance journals), chart of accounts,
--               fixed-asset register (and each asset's purchase journal), settings, budgets, goals, reminders, documents, other assets,
--               imported bank-statement lines, saved bank reconciliations, the audit log, the period lock and ledger switches.
--    It refuses while a period lock is set (unlock first in Ledger Setup) and needs the word RESET as confirmation.
--    p_dry_run => true only counts. Posted journals are normally immutable: this function is the single, explicit exception
--    (it sets a transaction-local flag that only it can set; the immutability triggers honour it for the signed-in owner's own rows).

alter table public.settings     add column if not exists doc_series jsonb;
alter table public.transactions add column if not exists voucher_no text;
create unique index if not exists transactions_voucher_uq on public.transactions(user_id, lower(btrim(voucher_no))) where voucher_no is not null;

-- immutability guards: identical to 010 / 017 except for the reset flag ---------------------------------------------------------
do $$ begin
  if to_regprocedure('public.tp_immutable()') is not null then
    execute $f$
      create or replace function public.tp_immutable() returns trigger language plpgsql as $b$
      begin
        if tg_op = 'DELETE' and current_setting('tp.reset_user', true) = old.user_id::text then return old; end if;
        raise exception 'Posted journal entries cannot be changed or deleted. Post a reversal instead.' using errcode = 'TP002';
      end $b$ $f$;
  end if;
  if to_regprocedure('public.tp_fa_immutable()') is not null then
    execute $f$
      create or replace function public.tp_fa_immutable() returns trigger language plpgsql as $b$
      begin
        if tg_op = 'DELETE' and tg_table_name in ('fixed_asset_dep','stock_valuations') and current_setting('tp.reset_user', true) = old.user_id::text then return old; end if;
        raise exception 'This record cannot be changed or deleted. Post a reversal journal instead.' using errcode = 'TP002';
      end $b$ $f$;
  end if;
end $$;

create or replace function public.reset_posted_entries(p_confirm text default '', p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid(); n bigint; res jsonb := '{}'::jsonb; lk date; on_ boolean; keep uuid[]; nextno bigint;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('tp_reset' || u::text, 0));
  if to_regclass('public.ledger_settings') is not null then
    execute 'select posting_enabled, locked_through from public.ledger_settings where user_id = $1' into on_, lk using u;
  end if;
  if lk is not null then
    raise exception 'Your books are locked up to %. Unlock the period in Ledger Setup first, then reset.', lk using errcode = 'TP001'; end if;
  if not p_dry_run and coalesce(p_confirm, '') <> 'RESET' then
    raise exception 'Type RESET to confirm' using errcode = '22023'; end if;

  -- journals that stay: bank opening balances (and their reversals) and the purchase journal of every fixed asset (and its reversal)
  keep := '{}';
  if to_regclass('public.journals') is not null then
    if to_regclass('public.fixed_assets') is not null then
      execute $q$ select coalesce(array_agg(id), '{}') from public.journals j where j.user_id = $1 and (
          (j.source_table = 'accounts')
          or j.id in (select purchase_journal from public.fixed_assets where user_id = $1 and purchase_journal is not null)
          or j.reverses in (select purchase_journal from public.fixed_assets where user_id = $1 and purchase_journal is not null)) $q$
        into keep using u;
    else
      execute $q$ select coalesce(array_agg(id), '{}') from public.journals where user_id = $1 and source_table = 'accounts' $q$ into keep using u;
    end if;
  end if;

  if p_dry_run then
    select res || jsonb_build_object('sales_invoices', count(*) filter (where kind = 'sale'), 'purchase_bills', count(*) filter (where kind = 'purchase')) into res from public.invoices where user_id = u;
    select res || jsonb_build_object('transactions', count(*)) into res from public.transactions where user_id = u;
    if to_regclass('public.gst_notes') is not null then execute 'select count(*) from public.gst_notes where user_id = $1' into n using u; res := res || jsonb_build_object('notes', n); end if;
    if to_regclass('public.tds_entries') is not null then execute 'select count(*) from public.tds_entries where user_id = $1' into n using u; res := res || jsonb_build_object('tds_entries', n); end if;
    if to_regclass('public.stock_valuations') is not null then execute 'select count(*) from public.stock_valuations where user_id = $1' into n using u; res := res || jsonb_build_object('stock_entries', n); end if;
    if to_regclass('public.fixed_asset_dep') is not null then execute 'select count(*) from public.fixed_asset_dep where user_id = $1' into n using u; res := res || jsonb_build_object('depreciation_entries', n); end if;
    if to_regclass('public.journals') is not null then execute 'select count(*) from public.journals where user_id = $1 and not (id = any($2))' into n using u, keep; res := res || jsonb_build_object('journals', n); end if;
    return res || jsonb_build_object('dry_run', true);
  end if;

  -- from here on this transaction may delete the owner's own posted rows, and the ledger must not post reversals for them
  perform set_config('tp.reset_user', u::text, true);
  if on_ is not null then execute 'update public.ledger_settings set posting_enabled = false where user_id = $1' using u; end if;

  if to_regclass('public.gst_notes') is not null then execute 'delete from public.gst_notes where user_id = $1' using u; get diagnostics n = row_count; res := res || jsonb_build_object('notes', n); end if;
  if to_regclass('public.tds_entries') is not null then execute 'delete from public.tds_entries where user_id = $1' using u; get diagnostics n = row_count; res := res || jsonb_build_object('tds_entries', n); end if;
  delete from public.transactions where user_id = u; get diagnostics n = row_count; res := res || jsonb_build_object('transactions', n);
  if to_regclass('public.invoice_items') is not null then
    execute 'delete from public.invoice_items where invoice_id in (select id from public.invoices where user_id = $1)' using u; end if;
  delete from public.invoices where user_id = u and kind = 'sale'; get diagnostics n = row_count; res := res || jsonb_build_object('sales_invoices', n);
  delete from public.invoices where user_id = u and kind = 'purchase'; get diagnostics n = row_count; res := res || jsonb_build_object('purchase_bills', n);
  if to_regclass('public.fixed_asset_dep') is not null then execute 'delete from public.fixed_asset_dep where user_id = $1' using u; get diagnostics n = row_count; res := res || jsonb_build_object('depreciation_entries', n); end if;
  if to_regclass('public.stock_valuations') is not null then execute 'delete from public.stock_valuations where user_id = $1' using u; get diagnostics n = row_count; res := res || jsonb_build_object('stock_entries', n); end if;
  if to_regclass('public.journals') is not null then
    execute 'delete from public.journal_lines where user_id = $1 and not (journal_id = any($2))' using u, keep;
    execute 'delete from public.journals where user_id = $1 and not (id = any($2))' using u, keep; get diagnostics n = row_count; res := res || jsonb_build_object('journals', n);
    execute 'select coalesce(max(journal_no), 0) + 1 from public.journals where user_id = $1' into nextno using u;
    execute 'update public.ledger_settings set next_journal_no = $2 where user_id = $1' using u, nextno;
    if to_regclass('public.ledger_errors') is not null then
      execute $q$ delete from public.ledger_errors where user_id = $1 and source_table in ('invoices','transactions','gst_notes','tds_entries') $q$ using u; end if;
  end if;
  if on_ is not null then execute 'update public.ledger_settings set posting_enabled = $2 where user_id = $1' using u, on_; end if;
  perform set_config('tp.reset_user', '', true);

  if to_regclass('public.audit_log') is not null then
    insert into public.audit_log(user_id, actor, table_name, row_id, action, new_row) values (u, u, 'ALL POSTED ENTRIES', null, 'RESET', res);
  end if;
  return res;
end $$;
revoke all on function public.reset_posted_entries(text, boolean) from public, anon;
grant execute on function public.reset_posted_entries(text, boolean) to authenticated;

notify pgrst, 'reload schema';
