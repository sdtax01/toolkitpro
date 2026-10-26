-- 010_ledger_core.sql - double-entry ledger tables. Undo: supabase/undo/012_ledger_down.sql (drops 010-012 together).
-- SAFE TO INSTALL: it only creates new tables and rules. Nothing posts to the ledger until you press
-- "Set up ledger" in the app (which calls setup_ledger()). Your existing tables and screens are unchanged.
-- Money: numeric(14,2) INR. Posted entries can never be edited or deleted, only reversed.

create table if not exists public.ledger_settings(
  user_id uuid primary key default auth.uid(),
  posting_enabled boolean not null default false,
  opening_date date, locked_through date, next_journal_no bigint not null default 1, setup_at timestamptz);
create table if not exists public.ledger_lock_history(
  id bigint generated always as identity primary key, user_id uuid not null default auth.uid(),
  locked_through date, changed_at timestamptz not null default now(), actor uuid default auth.uid());
create table if not exists public.ledger_errors(
  id bigint generated always as identity primary key, user_id uuid, at timestamptz not null default now(),
  source_table text, source_id uuid, message text);

create table if not exists public.gl_accounts(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  code text not null, name text not null,
  type text not null check (type in ('asset','liability','equity','income','expense')),
  system_key text, bank_account_id uuid, is_active boolean not null default true, created_at timestamptz not null default now(),
  unique (user_id, code));
create unique index if not exists gl_accounts_sys_uq  on public.gl_accounts(user_id, system_key) where system_key is not null;
create unique index if not exists gl_accounts_bank_uq on public.gl_accounts(user_id, bank_account_id) where bank_account_id is not null;

create table if not exists public.journals(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  journal_no bigint not null, entry_date date not null, narration text not null,
  kind text not null check (kind in ('auto','manual','reversal','opening')),
  source_table text, source_id uuid, reverses uuid references public.journals(id), reason text, content_hash text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (user_id, journal_no));
create unique index if not exists journals_reverses_uq on public.journals(reverses) where reverses is not null;
create index if not exists journals_source_ix on public.journals(user_id, source_table, source_id);
create index if not exists journals_date_ix   on public.journals(user_id, entry_date);

create table if not exists public.journal_lines(
  id uuid primary key default gen_random_uuid(), journal_id uuid not null references public.journals(id),
  user_id uuid not null, gl_account_id uuid not null references public.gl_accounts(id),
  debit numeric(14,2) not null default 0, credit numeric(14,2) not null default 0, party_id uuid, memo text,
  check (debit >= 0 and credit >= 0 and (debit = 0 or credit = 0) and debit + credit > 0));
create index if not exists journal_lines_j_ix on public.journal_lines(journal_id);
create index if not exists journal_lines_a_ix on public.journal_lines(user_id, gl_account_id);

-- rules ------------------------------------------------------------------------------------------
create or replace function public.tp_journal_before_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare v_lock date; v_no bigint;
begin
  insert into public.ledger_settings(user_id) values (new.user_id) on conflict do nothing;
  select locked_through into v_lock from public.ledger_settings where user_id = new.user_id;
  if v_lock is not null and new.entry_date <= v_lock then
    raise exception 'The period up to % is locked. Change the date or ask the owner to unlock it.', v_lock using errcode = 'TP001'; end if;
  update public.ledger_settings set next_journal_no = next_journal_no + 1 where user_id = new.user_id returning next_journal_no - 1 into v_no;
  new.journal_no := v_no;
  return new;
end $$;
drop trigger if exists tp_journal_bi on public.journals;
create trigger tp_journal_bi before insert on public.journals for each row execute function public.tp_journal_before_insert();

create or replace function public.tp_immutable() returns trigger language plpgsql as $$
begin raise exception 'Posted journal entries cannot be changed or deleted. Post a reversal instead.' using errcode = 'TP002'; end $$;
drop trigger if exists tp_journals_imm on public.journals;
create trigger tp_journals_imm before update or delete on public.journals for each row execute function public.tp_immutable();
drop trigger if exists tp_lines_imm on public.journal_lines;
create trigger tp_lines_imm before update or delete on public.journal_lines for each row execute function public.tp_immutable();

create or replace function public.tp_check_balanced() returns trigger language plpgsql as $$
declare d numeric; c numeric; n int;
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) into d, c, n from public.journal_lines where journal_id = new.journal_id;
  if d <> c then raise exception 'Journal does not balance: debit % vs credit %', d, c using errcode = 'TP003'; end if;
  if n < 2 then raise exception 'A journal needs at least two lines' using errcode = 'TP003'; end if;
  return null;
end $$;
drop trigger if exists tp_lines_bal on public.journal_lines;
create constraint trigger tp_lines_bal after insert on public.journal_lines deferrable initially deferred for each row execute function public.tp_check_balanced();

create or replace function public.tp_gl_account_guard() returns trigger language plpgsql as $$
begin
  if new.code <> old.code or new.type <> old.type or new.system_key is distinct from old.system_key
     or new.bank_account_id is distinct from old.bank_account_id or new.user_id <> old.user_id then
    raise exception 'Only the name and active flag of a ledger account can be changed' using errcode = 'TP004'; end if;
  return new;
end $$;
drop trigger if exists tp_gl_guard on public.gl_accounts;
create trigger tp_gl_guard before update on public.gl_accounts for each row execute function public.tp_gl_account_guard();

-- access: read-only for users; all writes go through the functions in 011/012 ----------------------
alter table public.ledger_settings enable row level security;
alter table public.ledger_lock_history enable row level security;
alter table public.ledger_errors enable row level security;
alter table public.gl_accounts enable row level security;
alter table public.journals enable row level security;
alter table public.journal_lines enable row level security;
do $$ declare t text; begin
  foreach t in array array['ledger_settings','ledger_lock_history','ledger_errors','gl_accounts','journals','journal_lines'] loop
    execute format('drop policy if exists own_read on public.%I', t);
    execute format('create policy own_read on public.%I for select using (user_id = auth.uid())', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop; end $$;
drop policy if exists own_rename on public.gl_accounts;
create policy own_rename on public.gl_accounts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
grant update (name, is_active) on public.gl_accounts to authenticated;
