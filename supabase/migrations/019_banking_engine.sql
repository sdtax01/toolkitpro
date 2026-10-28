-- 019_banking_engine.sql — unified Banking receipts/payments support.
-- Apply after 016_accounts_gst_setoff.sql and the ledger migrations 010-018.
-- Additive: preserves existing transactions and invoice-linked payment workflows.
-- The app can still display existing rows, but this migration is required for party-linked advances and references.

alter table public.transactions
  add column if not exists party_id uuid references public.parties(id) on delete set null,
  add column if not exists reference_no text;

create index if not exists transactions_party_date_idx
  on public.transactions(user_id, party_id, date desc);

-- Preserve the existing posting logic while assigning advances to party subledgers
-- and treating TDS refunds as recovery of a TDS receivable (not as income).
create or replace function public.tp_desired_txn(p_id uuid)
returns table(entry_date date, narration text, lines jsonb)
language plpgsql security definer set search_path = public as $$
declare
  t public.transactions%rowtype;
  i public.invoices%rowtype;
  bank uuid;
  contra uuid;
  ln jsonb;
  has_inv boolean := false;
begin
  select * into t from public.transactions where id = p_id;
  if not found then return; end if;
  bank := public.tp_gl_bank(t.user_id, t.account_id);

  if t.invoice_id is not null then
    select * into i from public.invoices where id = t.invoice_id and user_id = t.user_id;
    has_inv := found and ((i.kind = 'sale' and t.type = 'income') or (i.kind = 'purchase' and t.type = 'expense'));
  end if;

  if has_inv and i.kind = 'sale' then
    -- Receipt against a sales invoice: Dr Bank/Cash, Cr Debtors (party subledger).
    ln := jsonb_build_array(public.tp_line(bank, t.amount, 0), public.tp_line(public.tp_gl(t.user_id,'receivables'), 0, t.amount, i.party_id));
  elsif has_inv then
    -- Payment against a purchase bill: Dr Creditors (party subledger), Cr Bank/Cash.
    ln := jsonb_build_array(public.tp_line(public.tp_gl(t.user_id,'payables'), t.amount, 0, i.party_id), public.tp_line(bank, 0, t.amount));
  elsif t.type = 'income' and lower(btrim(coalesce(t.category,''))) = 'advance received' then
    -- Customer advance is a liability until it is applied to an invoice.
    ln := jsonb_build_array(public.tp_line(bank, t.amount, 0), public.tp_line(public.tp_gl(t.user_id,'customer_advances'), 0, t.amount, t.party_id));
  elsif t.type = 'expense' and lower(btrim(coalesce(t.category,''))) = 'advance paid' then
    -- Supplier advance is an asset until it is applied to a bill.
    ln := jsonb_build_array(public.tp_line(public.tp_gl(t.user_id,'supplier_advances'), t.amount, 0, t.party_id), public.tp_line(bank, 0, t.amount));
  elsif t.type = 'income' and lower(btrim(coalesce(t.category,''))) = 'tds refund' then
    -- Refund received reduces the TDS receivable balance; it is not a second income.
    ln := jsonb_build_array(public.tp_line(bank, t.amount, 0), public.tp_line(public.tp_gl(t.user_id,'tds_receivable'), 0, t.amount));
  elsif t.type = 'income' then
    ln := jsonb_build_array(public.tp_line(bank, t.amount, 0), public.tp_line(public.tp_gl_cat(t.user_id, t.category, 'income'), 0, t.amount));
  else
    ln := jsonb_build_array(public.tp_line(public.tp_gl_cat(t.user_id, t.category, 'expense'), t.amount, 0), public.tp_line(bank, 0, t.amount));
  end if;

  entry_date := t.date;
  narration := t.description;
  lines := ln;
  return next;
end $$;

-- Function remains internal; the ledger trigger calls it under its existing security-definer context.
revoke all on function public.tp_desired_txn(uuid) from public, anon, authenticated;
