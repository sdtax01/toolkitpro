-- Undo 018: restores the earlier versions of the posting/reporting functions and removes notes, TDS entries and the two invoice columns.
-- DELETE ALL CREDIT/DEBIT NOTES AND TDS ENTRIES IN THE APP FIRST (this reverses their journals and clears invoices.adjusted); otherwise the ledger keeps their effect.
drop trigger if exists tp_post on public.gst_notes;
drop trigger if exists tp_post on public.tds_entries;
drop trigger if exists tp_protect_note_del on public.gst_notes;
drop table if exists public.tds_entries;
drop table if exists public.gst_notes;
drop function if exists public.tp_note_guard();
drop function if exists public.tp_tds_guard();
drop function if exists public.tp_adjust_after();
drop function if exists public.tp_protect_note_delete();
drop function if exists public.tp_desired_note(uuid);
drop function if exists public.tp_desired_tds(uuid);
alter table public.invoices drop constraint if exists invoices_adjusted_range;
alter table public.invoices drop constraint if exists invoices_itc_purchase_only;
create or replace function public.tp_desired_invoice(p_id uuid) returns table(entry_date date, narration text, lines jsonb)
language plpgsql security definer set search_path = public as $$
declare i public.invoices%rowtype; pn text; base numeric; ln jsonb := '[]'::jsonb; u uuid; tot numeric; c numeric; s numeric; g numeric; head uuid;
begin
  select * into i from public.invoices where id = p_id; if not found then return; end if;
  u := i.user_id; select name into pn from public.parties where id = i.party_id and user_id = i.user_id;
  tot := round(i.amount, 2); c := round(coalesce(i.cgst,0), 2); s := round(coalesce(i.sgst,0), 2); g := round(coalesce(i.igst,0), 2);
  base := tot - c - s - g;
  if base < 0 then raise exception 'Invoice % has tax larger than its total', i.number; end if;
  if i.gl_account_id is not null then
    select id into head from public.gl_accounts where id = i.gl_account_id and user_id = u and type = case when i.kind = 'sale' then 'income' else 'expense' end;
    if head is null then raise exception 'Invoice % has an invalid income/expense head', i.number; end if;
  else head := public.tp_gl(u, case when i.kind = 'sale' then 'sales' else 'purchases' end); end if;
  if i.kind = 'sale' then
    ln := ln || public.tp_line(public.tp_gl(u,'receivables'), tot, 0, i.party_id);
    if base > 0 then ln := ln || public.tp_line(head, 0, base); end if;
    if c > 0 then ln := ln || public.tp_line(public.tp_gl(u,'output_cgst'), 0, c); end if;
    if s > 0 then ln := ln || public.tp_line(public.tp_gl(u,'output_sgst'), 0, s); end if;
    if g > 0 then ln := ln || public.tp_line(public.tp_gl(u,'output_igst'), 0, g); end if;
  else
    if base > 0 then ln := ln || public.tp_line(head, base, 0); end if;
    if c > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_cgst'), c, 0); end if;
    if s > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_sgst'), s, 0); end if;
    if g > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_igst'), g, 0); end if;
    ln := ln || public.tp_line(public.tp_gl(u,'payables'), 0, tot, i.party_id);
  end if;
  entry_date := i.date; narration := (case when i.kind = 'sale' then 'Invoice ' else 'Bill ' end) || i.number || coalesce(' - ' || pn, ''); lines := ln; return next;
end $$;

create or replace function public.tp_sync_one(p_table text, p_id uuid, p_user uuid) returns text language plpgsql security definer set search_path = public as $$
declare r record; kind text := case when p_table = 'accounts' then 'opening' else 'auto' end;
begin
  if p_table = 'invoices' then select * into r from public.tp_desired_invoice(p_id);
  elsif p_table = 'transactions' then select * into r from public.tp_desired_txn(p_id);
  else select * into r from public.tp_desired_opening(p_id); end if;
  if r.lines is null then return public.tp_sync_source(p_user, p_table, p_id, null, null, null, kind); end if;
  return public.tp_sync_source(p_user, p_table, p_id, r.entry_date, r.narration, r.lines, kind);
end $$;

create or replace function public.resync_ledger(p_strict boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r record; res text; posted int := 0; reversed int := 0; errs jsonb := '[]'::jsonb;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select posting_enabled from public.ledger_settings where user_id = u), false) then raise exception 'Set up the ledger first'; end if;
  for r in select 'accounts'::text t, id, name::text lbl, 1 o from public.accounts where user_id = u
           union all select 'invoices', id, number, 2 from public.invoices where user_id = u
           union all select 'transactions', id, description, 3 from public.transactions where user_id = u order by o, lbl loop
    begin
      res := public.tp_sync_one(r.t, r.id, u);
      if res = 'posted' then posted := posted + 1; elsif res = 'reversed' then reversed := reversed + 1; end if;
    exception when others then
      if p_strict or sqlstate = 'TP001' then raise exception '% %: %', r.t, r.lbl, sqlerrm; end if;
      errs := errs || jsonb_build_object('table', r.t, 'id', r.id, 'label', r.lbl, 'message', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('posted', posted, 'reversed', reversed, 'errors', errs);
end $$;

create or replace function public.ledger_unsynced() returns table(source_table text, source_id uuid, reason text) language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r record; d record; a record; h text;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  for r in select 'accounts'::text t, id from public.accounts where user_id = u union all select 'invoices', id from public.invoices where user_id = u union all select 'transactions', id from public.transactions where user_id = u loop
    d := null;
    begin
      if r.t = 'invoices' then select * into d from public.tp_desired_invoice(r.id); elsif r.t = 'transactions' then select * into d from public.tp_desired_txn(r.id); else select * into d from public.tp_desired_opening(r.id); end if;
    exception when others then
      source_table := r.t; source_id := r.id; reason := 'cannot be posted: ' || sqlerrm; return next; continue;
    end;
    h := public.tp_hash(d.entry_date, d.narration, d.lines);
    select j.content_hash into a from public.journals j where j.user_id = u and j.source_table = r.t and j.source_id = r.id and j.kind in ('auto','opening') and not exists (select 1 from public.journals x where x.reverses = j.id) order by j.created_at desc, j.journal_no desc limit 1;
    if h is not null and not found then source_table := r.t; source_id := r.id; reason := 'not posted'; return next;
    elsif h is not null and a.content_hash is distinct from h then source_table := r.t; source_id := r.id; reason := 'out of date'; return next;
    elsif h is null and found then source_table := r.t; source_id := r.id; reason := 'should be reversed'; return next; end if;
  end loop;
end $$;

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

alter table public.invoices drop column if exists adjusted, drop column if exists itc_blocked;
