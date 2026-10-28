-- Undo 019_banking_engine.sql. This removes the Banking Engine's party/reference fields.
-- Do not run if you need to retain party-linked advance history or reference numbers.
-- Ledger postings already created are not automatically removed; resync/review the ledger separately.

create or replace function public.tp_desired_txn(p_id uuid)
returns table(entry_date date, narration text, lines jsonb)
language plpgsql security definer set search_path = public as $$
declare t public.transactions%rowtype; i public.invoices%rowtype; bank uuid; ln jsonb; has_inv boolean := false;
begin
  select * into t from public.transactions where id = p_id; if not found then return; end if;
  bank := public.tp_gl_bank(t.user_id, t.account_id);
  if t.invoice_id is not null then
    select * into i from public.invoices where id = t.invoice_id and user_id = t.user_id;
    has_inv := found and ((i.kind = 'sale' and t.type = 'income') or (i.kind = 'purchase' and t.type = 'expense'));
  end if;
  if has_inv and i.kind = 'sale' then
    ln := jsonb_build_array(public.tp_line(bank, t.amount, 0), public.tp_line(public.tp_gl(t.user_id,'receivables'), 0, t.amount, i.party_id));
  elsif has_inv then
    ln := jsonb_build_array(public.tp_line(public.tp_gl(t.user_id,'payables'), t.amount, 0, i.party_id), public.tp_line(bank, 0, t.amount));
  elsif t.type = 'income' then
    ln := jsonb_build_array(public.tp_line(bank, t.amount, 0), public.tp_line(public.tp_gl_cat(t.user_id, t.category, 'income'), 0, t.amount));
  else
    ln := jsonb_build_array(public.tp_line(public.tp_gl_cat(t.user_id, t.category, 'expense'), t.amount, 0), public.tp_line(bank, 0, t.amount));
  end if;
  entry_date := t.date; narration := t.description; lines := ln; return next;
end $$;

drop index if exists public.transactions_party_date_idx;
alter table public.transactions drop column if exists reference_no;
alter table public.transactions drop column if exists party_id;
