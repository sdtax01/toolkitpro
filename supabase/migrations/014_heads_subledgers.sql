-- 014_heads_subledgers.sql - sub-accounts under any head, and a chosen Income/Expense head on each invoice or bill.
-- Needs 010-012. Additive: two new nullable columns and new functions. Existing invoices keep posting to Sales / Purchases exactly as before.
-- Undo: supabase/undo/014_heads_subledgers_down.sql

alter table public.gl_accounts add column if not exists parent_id uuid references public.gl_accounts(id);
create index if not exists gl_accounts_parent on public.gl_accounts(user_id, parent_id) where parent_id is not null;
alter table public.invoices add column if not exists gl_account_id uuid references public.gl_accounts(id);

-- a sub-account must sit under an account of the same user and the same type, and not under Debtors, Creditors or a bank account
create or replace function public.tp_gl_parent_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare p public.gl_accounts%rowtype;
begin
  if new.parent_id is null then return new; end if;
  select * into p from public.gl_accounts where id = new.parent_id;
  if not found or p.user_id <> new.user_id then raise exception 'Parent account not found' using errcode = '22023'; end if;
  if p.type <> new.type then raise exception 'A sub-account must have the same type as its parent' using errcode = '22023'; end if;
  if p.system_key in ('receivables','payables') or p.bank_account_id is not null then raise exception 'Sub-accounts cannot be added under Debtors, Creditors or a bank account' using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists tp_gl_parent on public.gl_accounts;
create trigger tp_gl_parent before insert on public.gl_accounts for each row execute function public.tp_gl_parent_guard();

create or replace function public.add_gl_subledger(p_name text, p_parent uuid, p_code text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p public.gl_accounts%rowtype; v uuid; cd text := nullif(btrim(coalesce(p_code,'')), ''); n int;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Name is required'; end if;
  select * into p from public.gl_accounts where id = p_parent and user_id = u;
  if not found then raise exception 'Parent account not found'; end if;
  if p.system_key in ('receivables','payables') or p.bank_account_id is not null then raise exception 'Sub-accounts cannot be added under Debtors, Creditors or a bank account'; end if;
  if exists (select 1 from public.gl_accounts where user_id = u and parent_id = p.id and lower(name) = lower(btrim(p_name))) then raise exception '% already has a sub-account named %', p.name, btrim(p_name); end if;
  if cd is not null then
    if cd !~ '^[0-9]{3,6}$' then raise exception 'Account code must be 3 to 6 digits'; end if;
    if cd in ('1010','1100','1210','1220','1230','2100','2210','2220','2230','3100','4100','4900','5100','5900') or cd ~ '^10[2-9][0-9]$' then raise exception 'Code % is reserved for built-in accounts', cd; end if;
  else
    if p.code !~ '^[0-9]+$' then raise exception 'Enter a code for this sub-account'; end if;
    select greatest(p.code::int, coalesce(max(code::int), 0)) + 1 into n from public.gl_accounts where user_id = u and parent_id = p.id and code ~ '^[0-9]+$';
    while n <= 999999 and (exists (select 1 from public.gl_accounts where user_id = u and code = n::text)
          or n::text in ('1010','1100','1210','1220','1230','2100','2210','2220','2230','3100','4100','4900','5100','5900') or n::text ~ '^10[2-9][0-9]$') loop n := n + 1; end loop;
    if n > 999999 then raise exception 'No free account code left under %', p.code; end if;
    cd := n::text;
  end if;
  insert into public.gl_accounts(user_id, code, name, type, parent_id) values (u, cd, btrim(p_name), p.type, p.id) returning id into v;
  return v;
exception when unique_violation then raise exception 'Account code % already exists', cd;
end $$;
revoke all on function public.add_gl_subledger(text, uuid, text) from public, anon;
grant execute on function public.add_gl_subledger(text, uuid, text) to authenticated;

-- the head chosen on an invoice: Income account for a sale, Expense account for a bill
create or replace function public.tp_invoice_head_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare a public.gl_accounts%rowtype;
begin
  if new.gl_account_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.gl_account_id is not distinct from old.gl_account_id and new.kind = old.kind then return new; end if;
  select * into a from public.gl_accounts where id = new.gl_account_id and user_id = new.user_id;
  if not found then raise exception 'That income/expense head does not exist' using errcode = '22023'; end if;
  if a.type <> (case when new.kind = 'sale' then 'income' else 'expense' end) then
    if new.kind = 'sale' then raise exception 'A sales invoice must use an Income account' using errcode = '22023';
    else raise exception 'A purchase bill must use an Expense account' using errcode = '22023'; end if;
  end if;
  if not a.is_active then raise exception 'The head "%" is inactive. Activate it or choose another', a.name using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists tp_invoice_head on public.invoices;
create trigger tp_invoice_head before insert or update on public.invoices for each row execute function public.tp_invoice_head_guard();

-- posting: identical to 011 except the Sales / Purchases line uses the chosen head when there is one
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
