-- 023_practice_suite.sql - client master, compliance tracker, recurring fee invoices.
-- Additive and safe to run more than once. Run AFTER 010-022. Staging first, after a backup.
-- Undo: supabase/undo/023_practice_suite_down.sql  (drops the three new tables and their data; invoices already created stay).
-- Nothing existing is altered: three new tables, each with row-level security (user_id = auth.uid()).

-- 1. client_master: practice details of a customer (one row per customer in `parties`).
create table if not exists public.client_master(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  pan text, tan text, cin_llpin text,
  constitution text,                       -- individual, huf, firm, llp, company, trust, aop_boi, other
  dob_incorp date,                         -- date of birth / incorporation
  contact_person text, contact_phone text, contact_email text,
  services text[] not null default '{}',   -- codes: gstr1, gstr3b, gstr9, tds_pay, tds_26q, tds_24q, adv_tax, itr, tax_audit, roc, books
  gst_frequency text not null default 'monthly' check (gst_frequency in ('monthly','qrmp')),
  fee_amount numeric(14,2) check (fee_amount is null or fee_amount >= 0),
  fee_cycle text check (fee_cycle is null or fee_cycle in ('monthly','quarterly','yearly','one_time')),
  assignee text,
  status text not null default 'active' check (status in ('active','on_hold','closed')),
  extra_gstins jsonb not null default '[]'::jsonb,   -- [{gstin, state, label}]
  notes text,
  created_at timestamptz not null default now(), updated_at timestamptz);
create unique index if not exists client_master_party_uq on public.client_master(user_id, party_id);

-- 2. compliance_tasks: one filing / deadline for one client for one period.
create table if not exists public.compliance_tasks(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  party_id uuid references public.parties(id) on delete cascade,   -- null = a firm-level task
  service text not null, period text not null,                      -- e.g. gstr3b / 2026-09
  title text not null,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending','in_progress','docs_awaited','ready','filed','not_applicable')),
  assignee text, filed_on date, ack_no text, remarks text,
  created_at timestamptz not null default now(), updated_at timestamptz);
create unique index if not exists compliance_tasks_uq on public.compliance_tasks(user_id, coalesce(party_id, '00000000-0000-0000-0000-000000000000'::uuid), service, period);
create index if not exists compliance_tasks_due_ix on public.compliance_tasks(user_id, due_date);

-- 3. recurring_invoices: a standing fee (retainer) that creates a sales invoice each period when you press "Create due invoices".
create table if not exists public.recurring_invoices(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  description text not null, hsn_sac text default '998231', unit text,
  amount numeric(14,2) not null check (amount > 0),        -- taxable value per invoice
  gst_rate numeric(5,2) not null default 18 check (gst_rate >= 0),
  frequency text not null check (frequency in ('monthly','quarterly','half_yearly','yearly')),
  next_date date not null, end_date date, anchor_day smallint check (anchor_day is null or anchor_day between 1 and 31),
  due_days integer not null default 15 check (due_days between 0 and 365),
  active boolean not null default true,
  last_date date, last_number text, run_count integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz);
create index if not exists recurring_next_ix on public.recurring_invoices(user_id, next_date) where active;

do $$ declare t text; begin
  foreach t in array array['client_master','compliance_tasks','recurring_invoices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_%1$s on public.%1$I', t);
    execute format('create policy own_%1$s on public.%1$I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    if to_regprocedure('public.tp_touch()') is not null then
      execute format('drop trigger if exists %1$s_touch on public.%1$I', t);
      execute format('create trigger %1$s_touch before update on public.%1$I for each row execute function public.tp_touch()', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
