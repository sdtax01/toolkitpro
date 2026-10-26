-- 002_payment_functions.sql - record / delete a payment in ONE database transaction.
-- SECURITY INVOKER: row-level security still applies, so users only touch their own rows.
-- The app calls these when present and falls back to its old two-step save when absent.
-- Undo: supabase/undo/002_payment_functions_down.sql
create or replace function public.record_payment(
  p_invoice uuid, p_amount numeric, p_date date, p_account uuid, p_description text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
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
end $$;

create or replace function public.delete_payment(p_txn uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_t public.transactions%rowtype;
begin
  select * into v_t from public.transactions where id = p_txn for update;
  if not found then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if v_t.invoice_id is not null then
    perform 1 from public.invoices where id = v_t.invoice_id for update;
    update public.invoices set paid = greatest(0, round(paid - v_t.amount, 2)) where id = v_t.invoice_id;
  end if;
  delete from public.transactions where id = p_txn;
end $$;

revoke all on function public.record_payment(uuid, numeric, date, uuid, text) from public, anon;
revoke all on function public.delete_payment(uuid) from public, anon;
grant execute on function public.record_payment(uuid, numeric, date, uuid, text) to authenticated;
grant execute on function public.delete_payment(uuid) to authenticated;
