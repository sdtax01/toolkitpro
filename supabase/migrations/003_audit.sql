-- 003_audit.sql - who changed what and when. Undo: supabase/undo/003_audit_down.sql
-- Adds updated_at columns and an append-only audit_log (users can read their own, nobody can edit it).
alter table public.invoices     add column if not exists updated_at timestamptz;
alter table public.transactions add column if not exists updated_at timestamptz;
alter table public.parties      add column if not exists updated_at timestamptz;
alter table public.accounts     add column if not exists updated_at timestamptz;

create table if not exists public.audit_log(
  id bigint generated always as identity primary key,
  user_id uuid, actor uuid default auth.uid(),
  table_name text not null, row_id uuid, action text not null,
  old_row jsonb, new_row jsonb, at timestamptz not null default now());
create index if not exists audit_log_user_at on public.audit_log (user_id, at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select using (user_id = auth.uid());
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create or replace function public.tp_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.tp_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log(user_id, actor, table_name, row_id, action, old_row)
    values (old.user_id, auth.uid(), tg_table_name, old.id, 'DELETE', to_jsonb(old)); return old;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log(user_id, actor, table_name, row_id, action, old_row, new_row)
    values (new.user_id, auth.uid(), tg_table_name, new.id, 'UPDATE', to_jsonb(old), to_jsonb(new)); return new;
  else
    insert into public.audit_log(user_id, actor, table_name, row_id, action, new_row)
    values (new.user_id, auth.uid(), tg_table_name, new.id, 'INSERT', to_jsonb(new)); return new;
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['invoices','transactions','parties','accounts'] loop
    execute format('drop trigger if exists tp_touch on public.%I', t);
    execute format('create trigger tp_touch before update on public.%I for each row execute function public.tp_touch()', t);
    execute format('drop trigger if exists tp_audit on public.%I', t);
    execute format('create trigger tp_audit after insert or update or delete on public.%I for each row execute function public.tp_audit()', t);
  end loop; end $$;
