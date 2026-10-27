-- 018_notes_tds_itc.sql - GST credit/debit notes, TDS entries on invoices, and "ITC not allowed" purchase bills.
-- Needs 001-003, 010-012, 014, 016 (run them first). Additive: new tables, two new invoice columns (defaults keep every existing row unchanged),
-- and the posting/reporting functions are re-created to ALSO handle the new tables. Existing invoices, payments and journals post exactly as before.
-- Undo: supabase/undo/018_notes_tds_itc_down.sql  (delete any notes / TDS entries first so the ledger and invoices stay in step).
--
-- CREDIT / DEBIT NOTES (GST Sec 34): a credit note is issued against a SALES invoice, a debit note against a purchase BILL (a return or price reduction).
--   Sales credit note   : Dr Sales head (taxable) + Dr Output CGST/SGST/IGST / Cr Debtors.      Debit note on bill: Dr Creditors / Cr Purchases head + Cr Input tax.
--   It reduces what is outstanding on the invoice (invoices.adjusted); the original invoice is never edited. Notes cannot be edited; with the
--   "protect documents" switch (015) they cannot be deleted either. Upward revisions (supplementary invoices) are not covered here.
--   The tax split of a note must match the invoice (IGST vs CGST+SGST) and each tax head cannot exceed what is left on the invoice. Verify filing treatment with your CA.
-- TDS: when a customer deducts TDS the bank receives less than the invoice. Record the deduction here (section is free text: you enter it; no rates are assumed):
--   sales invoice : Dr TDS receivable / Cr Debtors      purchase bill: Dr Creditors / Cr TDS payable (deposit it later with category "TDS deposited").
--   Receipts/payments then plus TDS plus notes settle the invoice.
-- ITC NOT ALLOWED: tick "ITC not allowed" on a purchase bill (blocked credit under Sec 17(5), or ineligible); the GST on it is then part of the cost
--   (Dr purchase/expense head for the full amount) instead of Input CGST/SGST/IGST. Whether a credit is blocked is a legal judgement for you / your CA.

alter table public.invoices add column if not exists itc_blocked boolean not null default false;
alter table public.invoices add column if not exists adjusted numeric(14,2) not null default 0;
alter table public.invoices drop constraint if exists invoices_adjusted_range;
alter table public.invoices add constraint invoices_adjusted_range check (adjusted >= 0 and adjusted <= amount);
alter table public.invoices drop constraint if exists invoices_itc_purchase_only;
alter table public.invoices add constraint invoices_itc_purchase_only check (not itc_blocked or kind = 'purchase');

create table if not exists public.gst_notes(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  kind text not null check (kind in ('credit','debit')),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  number text not null, date date not null,
  taxable numeric(14,2) not null check (taxable > 0),
  cgst numeric(14,2) not null default 0 check (cgst >= 0), sgst numeric(14,2) not null default 0 check (sgst >= 0), igst numeric(14,2) not null default 0 check (igst >= 0),
  amount numeric(14,2) not null check (amount > 0), reason text not null,
  created_at timestamptz not null default now(),
  check (abs(amount - (taxable + cgst + sgst + igst)) < 0.005));
create unique index if not exists gst_notes_no_uq on public.gst_notes(user_id, kind, lower(btrim(number)));
create index if not exists gst_notes_inv_ix on public.gst_notes(invoice_id);

create table if not exists public.tds_entries(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  date date not null, amount numeric(14,2) not null check (amount > 0), section text, note text,
  created_at timestamptz not null default now());
create index if not exists tds_inv_ix on public.tds_entries(invoice_id);

do $$ declare t text; begin
  foreach t in array array['gst_notes','tds_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_%1$s on public.%1$I', t);
    execute format('create policy own_%1$s on public.%1$I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('grant select, insert, delete on public.%I to authenticated', t);
    if to_regproc('public.tp_audit()') is not null then
      execute format('drop trigger if exists tp_audit on public.%I', t);
      execute format('create trigger tp_audit after insert or update or delete on public.%I for each row execute function public.tp_audit()', t);
    end if;
  end loop; end $$;

-- validation ------------------------------------------------------------------------------------------------------------------
create or replace function public.tp_note_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare i public.invoices%rowtype; used_c numeric; used_s numeric; used_i numeric; used_a numeric;
begin
  if tg_op = 'UPDATE' then raise exception 'A credit/debit note cannot be edited. Delete it (if allowed) and issue a new one' using errcode = 'TP006'; end if;
  select * into i from public.invoices where id = new.invoice_id and user_id = new.user_id for update;
  if not found then raise exception 'Invoice not found' using errcode = '22023'; end if;
  if (new.kind = 'credit' and i.kind <> 'sale') or (new.kind = 'debit' and i.kind <> 'purchase') then
    raise exception 'A credit note goes against a sales invoice and a debit note against a purchase bill' using errcode = '22023'; end if;
  if btrim(coalesce(new.number,'')) = '' then raise exception 'Note number is required' using errcode = '22023'; end if;
  if btrim(coalesce(new.reason,'')) = '' then raise exception 'Reason is required' using errcode = '22023'; end if;
  if new.date < i.date then raise exception 'The note cannot be dated before the invoice (%)', i.date using errcode = '22023'; end if;
  if coalesce(i.igst,0) > 0 and (new.cgst > 0 or new.sgst > 0) then raise exception 'This invoice has IGST; the note must use IGST' using errcode = '22023'; end if;
  if (coalesce(i.cgst,0) > 0 or coalesce(i.sgst,0) > 0) and new.igst > 0 then raise exception 'This invoice has CGST/SGST; the note must use CGST/SGST' using errcode = '22023'; end if;
  if new.cgst <> new.sgst then raise exception 'CGST and SGST on a note must be equal' using errcode = '22023'; end if;
  select coalesce(sum(cgst),0), coalesce(sum(sgst),0), coalesce(sum(igst),0), coalesce(sum(amount),0) into used_c, used_s, used_i, used_a from public.gst_notes where invoice_id = i.id;
  if new.cgst + used_c > coalesce(i.cgst,0) or new.sgst + used_s > coalesce(i.sgst,0) or new.igst + used_i > coalesce(i.igst,0) then
    raise exception 'The tax on the note exceeds the tax left on invoice %', i.number using errcode = '22023'; end if;
  if new.amount + used_a > i.amount then raise exception 'Notes would exceed the invoice value (% already credited of %)', used_a, i.amount using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists tp_note_guard on public.gst_notes;
create trigger tp_note_guard before insert or update on public.gst_notes for each row execute function public.tp_note_guard();

create or replace function public.tp_tds_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare i public.invoices%rowtype;
begin
  if tg_op = 'UPDATE' then raise exception 'A TDS entry cannot be edited. Delete it and add it again' using errcode = 'TP006'; end if;
  select * into i from public.invoices where id = new.invoice_id and user_id = new.user_id for update;
  if not found then raise exception 'Invoice not found' using errcode = '22023'; end if;
  if new.date < i.date then raise exception 'The TDS entry cannot be dated before the invoice (%)', i.date using errcode = '22023'; end if;
  if new.amount > round(i.amount - i.paid - i.adjusted, 2) then raise exception 'TDS amount exceeds the balance due on invoice %', i.number using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists tp_tds_guard on public.tds_entries;
create trigger tp_tds_guard before insert or update on public.tds_entries for each row execute function public.tp_tds_guard();

create or replace function public.tp_protect_note_delete() returns trigger language plpgsql security definer set search_path = public as $$
declare prot boolean; on_ boolean;
begin
  select posting_enabled, protect_documents into on_, prot from public.ledger_settings where user_id = old.user_id;
  if coalesce(on_, false) and coalesce(prot, false) and tg_table_name = 'gst_notes' then
    raise exception 'A credit/debit note cannot be deleted. Issue an opposite document instead' using errcode = 'TP005'; end if;
  return old;
end $$;
-- protect_documents exists only after 015; guard so 018 still installs if 015 was skipped
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ledger_settings' and column_name = 'protect_documents') then
    drop trigger if exists tp_protect_note_del on public.gst_notes;
    create trigger tp_protect_note_del before delete on public.gst_notes for each row execute function public.tp_protect_note_delete();
  end if; end $$;

-- keep invoices.adjusted = notes + TDS ---------------------------------------------------------------------------------------------
create or replace function public.tp_adjust_after() returns trigger language plpgsql security definer set search_path = public as $$
declare iid uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end; a numeric;
begin
  select coalesce((select sum(amount) from public.gst_notes where invoice_id = iid), 0) + coalesce((select sum(amount) from public.tds_entries where invoice_id = iid), 0) into a;
  update public.invoices set adjusted = a where id = iid and adjusted <> a;
  return null;
end $$;
drop trigger if exists tp_adjust on public.gst_notes;
create trigger tp_adjust after insert or delete on public.gst_notes for each row execute function public.tp_adjust_after();
drop trigger if exists tp_adjust on public.tds_entries;
create trigger tp_adjust after insert or delete on public.tds_entries for each row execute function public.tp_adjust_after();

-- payments can no longer exceed what is left after notes and TDS (same function as 002 plus "- adjusted")
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
  if v_amt > round(v_inv.amount - v_inv.paid - v_inv.adjusted, 2) then
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

-- posting ---------------------------------------------------------------------------------------------------------------------------
-- invoice: identical to 014 except a purchase bill ticked "ITC not allowed" carries its GST in the cost line
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
  elsif i.itc_blocked then
    ln := ln || public.tp_line(head, tot, 0);
    ln := ln || public.tp_line(public.tp_gl(u,'payables'), 0, tot, i.party_id);
  else
    if base > 0 then ln := ln || public.tp_line(head, base, 0); end if;
    if c > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_cgst'), c, 0); end if;
    if s > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_sgst'), s, 0); end if;
    if g > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_igst'), g, 0); end if;
    ln := ln || public.tp_line(public.tp_gl(u,'payables'), 0, tot, i.party_id);
  end if;
  entry_date := i.date; narration := (case when i.kind = 'sale' then 'Invoice ' else 'Bill ' end) || i.number || coalesce(' - ' || pn, ''); lines := ln; return next;
end $$;

create or replace function public.tp_desired_note(p_id uuid) returns table(entry_date date, narration text, lines jsonb)
language plpgsql security definer set search_path = public as $$
declare n public.gst_notes%rowtype; i public.invoices%rowtype; u uuid; head uuid; ln jsonb := '[]'::jsonb; pn text;
begin
  select * into n from public.gst_notes where id = p_id; if not found then return; end if;
  select * into i from public.invoices where id = n.invoice_id; u := n.user_id;
  select name into pn from public.parties where id = i.party_id and user_id = i.user_id;
  if i.gl_account_id is not null then head := i.gl_account_id;
  else head := public.tp_gl(u, case when i.kind = 'sale' then 'sales' else 'purchases' end); end if;
  if n.kind = 'credit' then
    ln := ln || public.tp_line(head, n.taxable, 0);
    if n.cgst > 0 then ln := ln || public.tp_line(public.tp_gl(u,'output_cgst'), n.cgst, 0); end if;
    if n.sgst > 0 then ln := ln || public.tp_line(public.tp_gl(u,'output_sgst'), n.sgst, 0); end if;
    if n.igst > 0 then ln := ln || public.tp_line(public.tp_gl(u,'output_igst'), n.igst, 0); end if;
    ln := ln || public.tp_line(public.tp_gl(u,'receivables'), 0, n.amount, i.party_id);
  else
    ln := ln || public.tp_line(public.tp_gl(u,'payables'), n.amount, 0, i.party_id);
    if i.itc_blocked then ln := ln || public.tp_line(head, 0, n.amount);
    else
      ln := ln || public.tp_line(head, 0, n.taxable);
      if n.cgst > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_cgst'), 0, n.cgst); end if;
      if n.sgst > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_sgst'), 0, n.sgst); end if;
      if n.igst > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_igst'), 0, n.igst); end if;
    end if;
  end if;
  entry_date := n.date;
  narration := (case when n.kind = 'credit' then 'Credit note ' else 'Debit note ' end) || n.number || ' against ' || i.number || coalesce(' - ' || pn, '');
  lines := ln; return next;
end $$;

create or replace function public.tp_desired_tds(p_id uuid) returns table(entry_date date, narration text, lines jsonb)
language plpgsql security definer set search_path = public as $$
declare t public.tds_entries%rowtype; i public.invoices%rowtype; u uuid; ln jsonb;
begin
  select * into t from public.tds_entries where id = p_id; if not found then return; end if;
  select * into i from public.invoices where id = t.invoice_id; u := t.user_id;
  if i.kind = 'sale' then
    ln := jsonb_build_array(public.tp_line(public.tp_gl(u,'tds_receivable'), t.amount, 0), public.tp_line(public.tp_gl(u,'receivables'), 0, t.amount, i.party_id));
  else
    ln := jsonb_build_array(public.tp_line(public.tp_gl(u,'payables'), t.amount, 0, i.party_id), public.tp_line(public.tp_gl(u,'tds_payable'), 0, t.amount));
  end if;
  entry_date := t.date; narration := 'TDS' || coalesce(' (' || nullif(btrim(t.section),'') || ')', '') || ' on ' || i.number; lines := ln; return next;
end $$;

create or replace function public.tp_sync_one(p_table text, p_id uuid, p_user uuid) returns text language plpgsql security definer set search_path = public as $$
declare r record; kind text := case when p_table = 'accounts' then 'opening' else 'auto' end;
begin
  if p_table = 'invoices' then select * into r from public.tp_desired_invoice(p_id);
  elsif p_table = 'transactions' then select * into r from public.tp_desired_txn(p_id);
  elsif p_table = 'gst_notes' then select * into r from public.tp_desired_note(p_id);
  elsif p_table = 'tds_entries' then select * into r from public.tp_desired_tds(p_id);
  else select * into r from public.tp_desired_opening(p_id); end if;
  if r.lines is null then return public.tp_sync_source(p_user, p_table, p_id, null, null, null, kind); end if;
  return public.tp_sync_source(p_user, p_table, p_id, r.entry_date, r.narration, r.lines, kind);
end $$;

drop trigger if exists tp_post on public.gst_notes;
create trigger tp_post after insert or update or delete on public.gst_notes for each row execute function public.tp_post_trigger();
drop trigger if exists tp_post on public.tds_entries;
create trigger tp_post after insert or update or delete on public.tds_entries for each row execute function public.tp_post_trigger();

-- re-sync and sync-check: same as 012 plus the two new sources
create or replace function public.resync_ledger(p_strict boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r record; res text; posted int := 0; reversed int := 0; errs jsonb := '[]'::jsonb;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select posting_enabled from public.ledger_settings where user_id = u), false) then raise exception 'Set up the ledger first'; end if;
  for r in select 'accounts'::text t, id, name::text lbl, 1 o from public.accounts where user_id = u
           union all select 'invoices', id, number, 2 from public.invoices where user_id = u
           union all select 'transactions', id, description, 3 from public.transactions where user_id = u
           union all select 'gst_notes', id, number, 4 from public.gst_notes where user_id = u
           union all select 'tds_entries', id, coalesce(section, 'TDS'), 5 from public.tds_entries where user_id = u order by o, lbl loop
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
  for r in select 'accounts'::text t, id from public.accounts where user_id = u union all select 'invoices', id from public.invoices where user_id = u union all select 'transactions', id from public.transactions where user_id = u
           union all select 'gst_notes', id from public.gst_notes where user_id = u union all select 'tds_entries', id from public.tds_entries where user_id = u loop
    d := null;
    begin
      if r.t = 'invoices' then select * into d from public.tp_desired_invoice(r.id);
      elsif r.t = 'transactions' then select * into d from public.tp_desired_txn(r.id);
      elsif r.t = 'gst_notes' then select * into d from public.tp_desired_note(r.id);
      elsif r.t = 'tds_entries' then select * into d from public.tp_desired_tds(r.id);
      else select * into d from public.tp_desired_opening(r.id); end if;
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

revoke all on function public.tp_desired_note(uuid), public.tp_desired_tds(uuid), public.tp_sync_one(text,uuid,uuid), public.tp_desired_invoice(uuid) from public, anon, authenticated;
revoke all on function public.resync_ledger(boolean), public.ledger_unsynced() from public, anon;
grant execute on function public.resync_ledger(boolean), public.ledger_unsynced() to authenticated;
revoke all on function public.record_payment(uuid, numeric, date, uuid, text) from public, anon;
grant execute on function public.record_payment(uuid, numeric, date, uuid, text) to authenticated;
