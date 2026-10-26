-- 011_ledger_posting.sql - turns invoices, payments/transactions and bank opening balances into balanced journals.
-- Triggers are installed now but do NOTHING until ledger_settings.posting_enabled = true (set by setup_ledger()).
-- Posting rules (INR):
--   Sale     : Dr Accounts receivable (total) / Cr Sales (taxable) + Cr Output CGST/SGST/IGST
--   Purchase : Dr Purchases (taxable) + Dr Input CGST/SGST/IGST / Cr Accounts payable (total)
--   Receipt  : Dr Bank or Cash / Cr Accounts receivable      Payment: Dr Accounts payable / Cr Bank or Cash
--   Income/expense not linked to an invoice: Dr Bank / Cr Income category  |  Dr Expense category / Cr Bank
--   Bank opening balance: Dr Bank / Cr Opening balance equity
-- Editing or deleting a source document posts a reversal of the old journal and a fresh journal (nothing is rewritten).

create or replace function public.tp_gl(p_user uuid, p_key text) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; d record;
begin
  select id into v from public.gl_accounts where user_id = p_user and system_key = p_key;
  if found then return v; end if;
  select * into d from (values
    ('cash','1010','Cash in hand','asset'),('receivables','1100','Accounts receivable (debtors)','asset'),
    ('input_cgst','1210','Input CGST','asset'),('input_sgst','1220','Input SGST','asset'),('input_igst','1230','Input IGST','asset'),
    ('payables','2100','Accounts payable (creditors)','liability'),
    ('output_cgst','2210','Output CGST','liability'),('output_sgst','2220','Output SGST','liability'),('output_igst','2230','Output IGST','liability'),
    ('opening_equity','3100','Opening balance equity','equity'),
    ('sales','4100','Sales','income'),('other_income','4900','Other income','income'),
    ('purchases','5100','Purchases','expense'),('general_expense','5900','General expenses','expense')
  ) x(k, code, name, type) where k = p_key;
  if not found then raise exception 'Unknown ledger account key %', p_key; end if;
  insert into public.gl_accounts(user_id, code, name, type, system_key) values (p_user, d.code, d.name, d.type, p_key) on conflict do nothing;
  select id into v from public.gl_accounts where user_id = p_user and system_key = p_key;
  if v is null then raise exception 'Ledger account code % is already used; rename that account first', d.code; end if;
  return v;
end $$;

create or replace function public.tp_gl_bank(p_user uuid, p_account uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; nm text; cd text;
begin
  if p_account is null then return public.tp_gl(p_user, 'cash'); end if;
  select id into v from public.gl_accounts where user_id = p_user and bank_account_id = p_account;
  if found then return v; end if;
  select name into nm from public.accounts where id = p_account and user_id = p_user;
  if not found then return public.tp_gl(p_user, 'cash'); end if;
  select (coalesce(max(code::int), 1019) + 1)::text into cd from public.gl_accounts where user_id = p_user and code ~ '^10[2-9][0-9]$';
  if cd::int > 1099 then raise exception 'Too many bank accounts for the ledger (limit 80)'; end if;
  insert into public.gl_accounts(user_id, code, name, type, bank_account_id) values (p_user, cd, nm, 'asset', p_account) returning id into v;
  return v;
end $$;

create or replace function public.tp_gl_cat(p_user uuid, p_cat text, p_type text) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; c text := nullif(btrim(coalesce(p_cat,'')), ''); lo int; hi int; cd text;
begin
  if c is null then return public.tp_gl(p_user, case when p_type = 'income' then 'other_income' else 'general_expense' end); end if;
  if lower(c) = 'sales' and p_type = 'income' then return public.tp_gl(p_user, 'sales'); end if;
  if lower(c) = 'purchases' and p_type = 'expense' then return public.tp_gl(p_user, 'purchases'); end if;
  select id into v from public.gl_accounts where user_id = p_user and type = p_type and lower(name) = lower(c) and system_key is null and bank_account_id is null;
  if found then return v; end if;
  if p_type = 'income' then lo := 4200; hi := 4899; else lo := 5200; hi := 5899; end if;
  select (coalesce(max(code::int), lo - 1) + 1)::text into cd from public.gl_accounts where user_id = p_user and code ~ '^[0-9]+$' and code::int between lo and hi;
  if cd::int > hi then raise exception 'Too many % categories for the ledger. Merge some categories.', p_type; end if;
  insert into public.gl_accounts(user_id, code, name, type) values (p_user, cd, c, p_type) returning id into v;
  return v;
end $$;

create or replace function public.tp_hash(p_date date, p_narr text, p_lines jsonb) returns text language sql immutable as $$
  select case when p_lines is null then null else md5(p_date::text || '|' || coalesce(p_narr,'') || '|' || p_lines::text) end $$;

create or replace function public.tp_line(p_acc uuid, p_dr numeric, p_cr numeric, p_party uuid default null) returns jsonb language sql immutable as $$
  select jsonb_build_object('acc', p_acc, 'dr', round(coalesce(p_dr,0),2), 'cr', round(coalesce(p_cr,0),2), 'party', p_party) $$;

-- what the ledger SHOULD contain for one source row (no rows = nothing should be posted) -----------
create or replace function public.tp_desired_invoice(p_id uuid) returns table(entry_date date, narration text, lines jsonb)
language plpgsql security definer set search_path = public as $$
declare i public.invoices%rowtype; pn text; base numeric; ln jsonb := '[]'::jsonb; u uuid; tot numeric; c numeric; s numeric; g numeric;
begin
  select * into i from public.invoices where id = p_id; if not found then return; end if;
  u := i.user_id; select name into pn from public.parties where id = i.party_id and user_id = i.user_id;
  tot := round(i.amount, 2); c := round(coalesce(i.cgst,0), 2); s := round(coalesce(i.sgst,0), 2); g := round(coalesce(i.igst,0), 2);
  base := tot - c - s - g;
  if base < 0 then raise exception 'Invoice % has tax larger than its total', i.number; end if;
  if i.kind = 'sale' then
    ln := ln || public.tp_line(public.tp_gl(u,'receivables'), tot, 0, i.party_id);
    if base > 0 then ln := ln || public.tp_line(public.tp_gl(u,'sales'), 0, base); end if;
    if c > 0 then ln := ln || public.tp_line(public.tp_gl(u,'output_cgst'), 0, c); end if;
    if s > 0 then ln := ln || public.tp_line(public.tp_gl(u,'output_sgst'), 0, s); end if;
    if g > 0 then ln := ln || public.tp_line(public.tp_gl(u,'output_igst'), 0, g); end if;
  else
    if base > 0 then ln := ln || public.tp_line(public.tp_gl(u,'purchases'), base, 0); end if;
    if c > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_cgst'), c, 0); end if;
    if s > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_sgst'), s, 0); end if;
    if g > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_igst'), g, 0); end if;
    ln := ln || public.tp_line(public.tp_gl(u,'payables'), 0, tot, i.party_id);
  end if;
  entry_date := i.date; narration := (case when i.kind = 'sale' then 'Invoice ' else 'Bill ' end) || i.number || coalesce(' - ' || pn, ''); lines := ln; return next;
end $$;

create or replace function public.tp_desired_txn(p_id uuid) returns table(entry_date date, narration text, lines jsonb)
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

create or replace function public.tp_desired_opening(p_id uuid) returns table(entry_date date, narration text, lines jsonb)
language plpgsql security definer set search_path = public as $$
declare a public.accounts%rowtype; od date; bank uuid; eq uuid;
begin
  select * into a from public.accounts where id = p_id; if not found or a.opening = 0 then return; end if;
  select opening_date into od from public.ledger_settings where user_id = a.user_id; if od is null then return; end if;
  bank := public.tp_gl_bank(a.user_id, a.id); eq := public.tp_gl(a.user_id, 'opening_equity');
  entry_date := od; narration := 'Opening balance - ' || a.name;
  lines := case when a.opening > 0 then jsonb_build_array(public.tp_line(bank, a.opening, 0), public.tp_line(eq, 0, a.opening))
                else jsonb_build_array(public.tp_line(eq, -a.opening, 0), public.tp_line(bank, 0, -a.opening)) end;
  return next;
end $$;

-- write the difference between "what should be there" and "what is there" -------------------------
create or replace function public.tp_sync_source(p_user uuid, p_table text, p_id uuid, p_date date, p_narr text, p_lines jsonb, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare act public.journals%rowtype; h text; nid uuid; rid uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || p_table || p_id::text, 0));
  h := public.tp_hash(p_date, p_narr, p_lines);
  select j.* into act from public.journals j
   where j.user_id = p_user and j.source_table = p_table and j.source_id = p_id and j.kind in ('auto','opening')
     and not exists (select 1 from public.journals r where r.reverses = j.id)
   order by j.created_at desc, j.journal_no desc limit 1;
  if found and act.content_hash is not distinct from h then return 'unchanged'; end if;
  if not found and p_lines is null then return 'unchanged'; end if;
  if found then
    insert into public.journals(user_id, entry_date, narration, kind, source_table, source_id, reverses, reason)
    values (p_user, act.entry_date, 'Reversal of JV-' || act.journal_no || ': ' || act.narration, 'reversal', p_table, p_id, act.id, 'Source document changed or deleted')
    returning id into rid;
    insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, party_id, memo)
    select rid, p_user, gl_account_id, credit, debit, party_id, memo from public.journal_lines where journal_id = act.id;
  end if;
  if p_lines is not null then
    insert into public.journals(user_id, entry_date, narration, kind, source_table, source_id, content_hash)
    values (p_user, p_date, p_narr, p_kind, p_table, p_id, h) returning id into nid;
    insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, party_id)
    select nid, p_user, (l->>'acc')::uuid, (l->>'dr')::numeric, (l->>'cr')::numeric, nullif(l->>'party','')::uuid
      from jsonb_array_elements(p_lines) l where (l->>'dr')::numeric + (l->>'cr')::numeric > 0;
  end if;
  return case when found and p_lines is null then 'reversed' else 'posted' end;
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

-- triggers on the existing tables (no-ops until posting is enabled) --------------------------------
create or replace function public.tp_post_trigger() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; rid uuid; on_ boolean;
begin
  u := case when tg_op = 'DELETE' then old.user_id else new.user_id end; rid := case when tg_op = 'DELETE' then old.id else new.id end;
  select posting_enabled into on_ from public.ledger_settings where user_id = u;
  if not coalesce(on_, false) then return coalesce(new, old); end if;
  begin
    if tg_op = 'DELETE' then perform public.tp_sync_source(u, tg_table_name, rid, null, null, null, case when tg_table_name = 'accounts' then 'opening' else 'auto' end);
    else perform public.tp_sync_one(tg_table_name, rid, u); end if;
    if tg_table_name = 'accounts' and tg_op = 'UPDATE' then update public.gl_accounts set name = new.name where user_id = u and bank_account_id = new.id and name <> new.name; end if;
  exception
    when sqlstate 'TP001' then
      if tg_table_name = 'accounts' then
        insert into public.ledger_errors(user_id, source_table, source_id, message) values (u, tg_table_name, rid, sqlerrm || ' (opening balance not posted; unlock and use Re-sync)');
      else raise; end if;
    when others then
      insert into public.ledger_errors(user_id, source_table, source_id, message) values (u, tg_table_name, rid, sqlerrm);
  end;
  return coalesce(new, old);
end $$;
drop trigger if exists tp_post on public.invoices;     create trigger tp_post after insert or update or delete on public.invoices     for each row execute function public.tp_post_trigger();
drop trigger if exists tp_post on public.transactions; create trigger tp_post after insert or update or delete on public.transactions for each row execute function public.tp_post_trigger();
drop trigger if exists tp_post on public.accounts;     create trigger tp_post after insert or update or delete on public.accounts     for each row execute function public.tp_post_trigger();

revoke all on function public.tp_gl(uuid,text), public.tp_gl_bank(uuid,uuid), public.tp_gl_cat(uuid,text,text), public.tp_line(uuid,numeric,numeric,uuid),
  public.tp_hash(date,text,jsonb), public.tp_desired_invoice(uuid), public.tp_desired_txn(uuid), public.tp_desired_opening(uuid),
  public.tp_sync_source(uuid,text,uuid,date,text,jsonb,text), public.tp_sync_one(text,uuid,uuid) from public, anon, authenticated;
