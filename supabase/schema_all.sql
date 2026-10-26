-- Toolkit Pro: complete schema. Paste into Supabase > SQL Editor and click Run once.

create table accounts(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), name text not null, opening numeric not null default 0);
create table transactions(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), date date not null default current_date, description text not null, category text, type text not null check (type in ('income','expense')), account_id uuid references accounts(id) on delete set null, amount numeric not null check (amount>0), created_at timestamptz default now());
alter table accounts enable row level security;
alter table transactions enable row level security;
create policy own_accounts on accounts for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy own_tx on transactions for all using (user_id=auth.uid()) with check (user_id=auth.uid());
alter publication supabase_realtime add table accounts, transactions;

create table parties(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), name text not null, kind text not null check (kind in ('client','supplier')), email text, phone text, gstin text);
create table invoices(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), party_id uuid references parties(id) on delete cascade, kind text not null check (kind in ('sale','purchase')), number text not null, date date not null default current_date, due_date date, amount numeric not null check (amount>0), paid numeric not null default 0);
create table reminders(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), title text not null, due_date date not null, done boolean not null default false);
create table assets(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), name text not null, category text not null, value numeric not null default 0);
alter table transactions add column invoice_id uuid references invoices(id) on delete set null;
do $$ declare t text; begin foreach t in array array['parties','invoices','reminders','assets'] loop
 execute format('alter table %I enable row level security',t);
 execute format('create policy own_%1$s on %1$s for all using (user_id=auth.uid()) with check (user_id=auth.uid())',t);
end loop; end $$;
alter publication supabase_realtime add table parties, invoices, reminders, assets;

create table settings(id uuid primary key default gen_random_uuid(), user_id uuid not null unique default auth.uid(), business_name text, gstin text, state text, address text, phone text, email text, default_gst numeric default 18);
create table budgets(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), category text not null, monthly_limit numeric not null);
create table goals(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), name text not null, target numeric not null check (target>0), saved numeric not null default 0, target_date date);
create table documents(id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), name text not null, category text, path text not null, size bigint);
alter table parties add column state text;
alter table invoices add column taxable numeric, add column gst_rate numeric default 0, add column cgst numeric default 0, add column sgst numeric default 0, add column igst numeric default 0;
do $$ declare t text; begin foreach t in array array['settings','budgets','goals','documents'] loop
 execute format('alter table %I enable row level security',t);
 execute format('create policy own_%1$s on %1$s for all using (user_id=auth.uid()) with check (user_id=auth.uid())',t);
end loop; end $$;
insert into storage.buckets(id,name,public) values('documents','documents',false) on conflict do nothing;
create policy docs_rw on storage.objects for all to authenticated using (bucket_id='documents' and (storage.foldername(name))[1]=auth.uid()::text) with check (bucket_id='documents' and (storage.foldername(name))[1]=auth.uid()::text);
alter publication supabase_realtime add table settings, budgets, goals, documents;
