-- 013_bank_reconciliation.sql - bank statement lines and saved reconciliations. Undo: supabase/undo/013_bank_reconciliation_down.sql
-- Independent of the ledger (010-012): it works with the Transactions you already have. Only adds new tables.
create table if not exists public.bank_statement_lines(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  stmt_date date not null, description text, reference text,
  amount numeric(14,2) not null check (amount <> 0),            -- + money in (deposit), - money out (withdrawal)
  dedupe_key text not null,                                      -- stops the same statement row being imported twice
  matched_txn_id uuid references public.transactions(id) on delete set null,
  matched_at timestamptz, created_at timestamptz not null default now(),
  unique (user_id, account_id, dedupe_key));
create unique index if not exists bank_stmt_one_match on public.bank_statement_lines(matched_txn_id) where matched_txn_id is not null;
create index if not exists bank_stmt_acc_date on public.bank_statement_lines(user_id, account_id, stmt_date);

create table if not exists public.bank_reconciliations(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  account_id uuid not null references public.accounts(id) on delete restrict,   -- a bank account with saved reconciliations cannot be deleted
  as_on date not null, statement_balance numeric(14,2) not null, book_balance numeric(14,2) not null,
  difference numeric(14,2) not null, note text, created_at timestamptz not null default now(), created_by uuid default auth.uid());

create or replace function public.tp_stmt_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.matched_txn_id is not null then
    if not exists (select 1 from public.transactions t where t.id = new.matched_txn_id and t.user_id = new.user_id and t.account_id = new.account_id
                   and ((new.amount > 0 and t.type = 'income') or (new.amount < 0 and t.type = 'expense')) and t.amount = abs(new.amount)) then
      raise exception 'The matched entry must be in the same bank account, in the same direction, for the same amount' using errcode = '22023'; end if;
    new.matched_at := coalesce(new.matched_at, now());
  else new.matched_at := null; end if;
  if tg_op = 'UPDATE' and (new.amount <> old.amount or new.account_id <> old.account_id or new.stmt_date <> old.stmt_date or new.dedupe_key <> old.dedupe_key) then
    raise exception 'Imported statement lines cannot be edited. Delete the line (if unmatched) and import again' using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists tp_stmt_guard on public.bank_statement_lines;
create trigger tp_stmt_guard before insert or update on public.bank_statement_lines for each row execute function public.tp_stmt_guard();

alter table public.bank_statement_lines enable row level security;
alter table public.bank_reconciliations enable row level security;
drop policy if exists own_rw on public.bank_statement_lines;
create policy own_rw on public.bank_statement_lines for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_read on public.bank_reconciliations;
create policy own_read on public.bank_reconciliations for select using (user_id = auth.uid());
drop policy if exists own_add on public.bank_reconciliations;
create policy own_add on public.bank_reconciliations for insert with check (user_id = auth.uid());
revoke all on public.bank_statement_lines, public.bank_reconciliations from anon, authenticated;
grant select, insert, update, delete on public.bank_statement_lines to authenticated;
grant select, insert on public.bank_reconciliations to authenticated;   -- saved reconciliations are a permanent record
