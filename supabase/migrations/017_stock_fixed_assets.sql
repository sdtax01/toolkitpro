-- 017_stock_fixed_assets.sql - closing stock (inventory) and a fixed-asset register with depreciation.
-- Needs 010-012 and 016. Additive: new tables and functions only; no existing screen, posting or report changes.
-- Undo: supabase/undo/017_stock_fixed_assets_down.sql
--
-- STOCK (periodic method): Purchases stay in the Purchases account as now. At period end you enter the closing stock value for a date.
--   The function posts the DIFFERENCE from the current Inventory balance:  stock up -> Dr Inventory / Cr Change in inventories (reduces expense);
--   stock down -> Dr Change in inventories / Cr Inventory.  Cost of goods consumed = Purchases + Change in inventories, and the balance sheet shows Inventory.
--   Valuation basis (FIFO / weighted average / other) is recorded with each entry. Ind AS 2 / AS 2: lower of cost and net realisable value is for you / your CA to confirm.
--   Enter valuations in date order. To undo one, reverse its journal from Journal Entry.
-- FIXED ASSETS: add an asset (posts Dr Fixed assets at cost / Cr the account you pick: bank, Purchases (to reclassify a bill you already booked as a purchase),
--   Opening balance equity (assets you already owned), etc.). Depreciation is posted once per FINISHED financial year (1 Apr to 31 Mar), one journal per year:
--   Dr Depreciation / Cr Accumulated depreciation. Method and rate/life are YOUR inputs per asset (straight line over life, or written-down value at a rate);
--   the system does not look up statutory rates. It charges from the date put to use, in days. Income-tax block depreciation is a separate computation (not here).
--   Disposal of an asset is not automated yet: record it with a manual journal.

create or replace function public.tp_fy_start(d date) returns date language sql immutable as $$
  select case when extract(month from d) >= 4 then make_date(extract(year from d)::int, 4, 1) else make_date(extract(year from d)::int - 1, 4, 1) end $$;

create table if not exists public.stock_valuations(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  as_on date not null, value numeric(14,2) not null check (value >= 0),
  method text not null check (method in ('fifo','weighted_average','other')), note text,
  journal_id uuid references public.journals(id), created_at timestamptz not null default now());
create index if not exists stock_val_ix on public.stock_valuations(user_id, as_on);

create table if not exists public.fixed_assets(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  name text not null, asset_class text, put_to_use date not null,
  cost numeric(14,2) not null check (cost > 0), residual numeric(14,2) not null default 0,
  opening_acc_dep numeric(14,2) not null default 0 check (opening_acc_dep >= 0), dep_from date not null,
  method text not null check (method in ('slm','wdv')), life_years numeric(6,2), rate_pct numeric(6,3),
  purchase_journal uuid references public.journals(id), voided boolean not null default false, note text,
  created_at timestamptz not null default now(),
  check (residual >= 0 and residual < cost and opening_acc_dep <= cost - residual),
  check ((method = 'slm' and life_years > 0) or (method = 'wdv' and rate_pct > 0 and rate_pct <= 100)));
create table if not exists public.fixed_asset_dep(
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  asset_id uuid not null references public.fixed_assets(id), fy_start date not null, fy_end date not null,
  amount numeric(14,2) not null check (amount >= 0), journal_id uuid references public.journals(id),
  created_at timestamptz not null default now(), unique (asset_id, fy_start));
create index if not exists fa_dep_ix on public.fixed_asset_dep(user_id, fy_start);

-- history is kept: depreciation and stock rows are never edited or deleted (correct them by reversing the journal)
create or replace function public.tp_fa_immutable() returns trigger language plpgsql as $$
begin raise exception 'This record cannot be changed or deleted. Post a reversal journal instead.' using errcode = 'TP002'; end $$;
drop trigger if exists tp_fa_dep_imm on public.fixed_asset_dep;
create trigger tp_fa_dep_imm before update or delete on public.fixed_asset_dep for each row execute function public.tp_fa_immutable();
drop trigger if exists tp_stock_imm on public.stock_valuations;
create trigger tp_stock_imm before update or delete on public.stock_valuations for each row execute function public.tp_fa_immutable();
drop trigger if exists tp_fa_imm on public.fixed_assets;
create trigger tp_fa_imm before delete on public.fixed_assets for each row execute function public.tp_fa_immutable();

do $$ declare t text; begin
  foreach t in array array['stock_valuations','fixed_assets','fixed_asset_dep'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_read on public.%I', t);
    execute format('create policy own_read on public.%I for select using (user_id = auth.uid())', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    if to_regproc('public.tp_audit()') is not null then
      execute format('drop trigger if exists tp_audit on public.%I', t);
      execute format('create trigger tp_audit after insert or update or delete on public.%I for each row execute function public.tp_audit()', t);
    end if;
  end loop; end $$;

-- closing stock ------------------------------------------------------------------------------------------------------------------
create or replace function public.set_closing_stock(p_date date, p_value numeric, p_method text default 'weighted_average', p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); v numeric(14,2) := round(p_value, 2); cur numeric; adj numeric; jid uuid; inv uuid; adjacc uuid; vid uuid;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select posting_enabled from public.ledger_settings where user_id = u), false) then raise exception 'Set up the ledger first'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if v is null or v < 0 then raise exception 'Closing stock value cannot be negative'; end if;
  if p_method not in ('fifo','weighted_average','other') then raise exception 'Valuation basis must be fifo, weighted_average or other'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text || 'stock', 0));
  if exists (select 1 from public.stock_valuations s where s.user_id = u and s.as_on > p_date
             and (s.journal_id is null or not exists (select 1 from public.journals r where r.reverses = s.journal_id))) then
    raise exception 'A later closing stock entry exists. Enter valuations in date order (or reverse the later one first)'; end if;
  inv := public.tp_gl(u, 'inventory'); adjacc := public.tp_gl(u, 'stock_adjust');
  cur := public.tp_gl_bal(u, 'inventory', p_date); adj := v - cur;
  if adj <> 0 then
    insert into public.journals(user_id, entry_date, narration, kind)
    values (u, p_date, 'Closing stock as on ' || p_date || ' (' || replace(p_method, '_', ' ') || ')' || coalesce(' - ' || nullif(btrim(coalesce(p_note,'')), ''), ''), 'manual') returning id into jid;
    insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, memo)
    values (jid, u, case when adj > 0 then inv else adjacc end, abs(adj), 0, null),
           (jid, u, case when adj > 0 then adjacc else inv end, 0, abs(adj), null);
  end if;
  insert into public.stock_valuations(user_id, as_on, value, method, note, journal_id) values (u, p_date, v, p_method, nullif(btrim(coalesce(p_note,'')), ''), jid) returning id into vid;
  return jsonb_build_object('valuation_id', vid, 'journal_id', jid, 'previous_inventory', cur, 'adjustment', adj);
end $$;

-- fixed assets ------------------------------------------------------------------------------------------------------------------
create or replace function public.add_fixed_asset(p_name text, p_class text, p_put_to_use date, p_cost numeric, p_residual numeric, p_method text,
  p_life numeric, p_rate numeric, p_credit_account uuid, p_note text default null, p_date date default null,
  p_opening_acc_dep numeric default 0, p_dep_from date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); cost numeric(14,2) := round(p_cost, 2); res numeric(14,2) := round(coalesce(p_residual, 0), 2); acc public.gl_accounts%rowtype; jid uuid; fid uuid; fa uuid; d date; oad numeric(14,2) := round(coalesce(p_opening_acc_dep, 0), 2); df date;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select posting_enabled from public.ledger_settings where user_id = u), false) then raise exception 'Set up the ledger first'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Asset name is required'; end if;
  if p_put_to_use is null then raise exception 'Date put to use is required'; end if;
  if cost is null or cost <= 0 then raise exception 'Cost must be greater than zero'; end if;
  if cost - oad <= 0 then raise exception 'Cost must be greater than the opening accumulated depreciation'; end if;
  if res < 0 or res >= cost then raise exception 'Residual value must be zero or more and less than the cost'; end if;
  if oad < 0 or oad > cost - res then raise exception 'Opening accumulated depreciation must be between zero and cost less residual value'; end if;
  df := public.tp_fy_start(coalesce(p_dep_from, p_put_to_use));
  if df < public.tp_fy_start(p_put_to_use) then raise exception 'Depreciation cannot start before the financial year the asset was put to use'; end if;
  if p_method not in ('slm','wdv') then raise exception 'Method must be slm (straight line) or wdv (written down value)'; end if;
  if p_method = 'slm' and coalesce(p_life, 0) <= 0 then raise exception 'Enter the useful life in years for straight-line depreciation'; end if;
  if p_method = 'wdv' and (coalesce(p_rate, 0) <= 0 or p_rate > 100) then raise exception 'Enter a depreciation rate between 0 and 100 for written-down-value'; end if;
  select * into acc from public.gl_accounts where id = p_credit_account and user_id = u;
  if not found then raise exception 'Choose the account the asset was paid from'; end if;
  if not acc.is_active then raise exception 'Account % is inactive', acc.name; end if;
  if acc.system_key in ('receivables','payables','fixed_assets','acc_dep') then raise exception 'Choose a bank, cash, Purchases, equity or other liability account (not %)', acc.name; end if;
  fa := public.tp_gl(u, 'fixed_assets'); d := coalesce(p_date, p_put_to_use);
  insert into public.journals(user_id, entry_date, narration, kind) values (u, d, 'Fixed asset purchased - ' || btrim(p_name), 'manual') returning id into jid;
  insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, memo) values (jid, u, fa, cost, 0, btrim(p_name)), (jid, u, acc.id, 0, cost - oad, null);
  if oad > 0 then insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, memo) values (jid, u, public.tp_gl(u, 'acc_dep'), 0, oad, 'Depreciation already charged before this ledger'); end if;
  insert into public.fixed_assets(user_id, name, asset_class, put_to_use, cost, residual, opening_acc_dep, dep_from, method, life_years, rate_pct, purchase_journal, note)
  values (u, btrim(p_name), nullif(btrim(coalesce(p_class,'')), ''), p_put_to_use, cost, res, oad, df, p_method,
          case when p_method = 'slm' then p_life end, case when p_method = 'wdv' then p_rate end, jid, nullif(btrim(coalesce(p_note,'')), '')) returning id into fid;
  return fid;
end $$;

-- depreciation for one asset in one financial year, given what has already been posted for earlier years
create or replace function public.tp_fa_dep_calc(p_asset uuid, p_fy date) returns numeric language plpgsql security definer set search_path = public as $$
declare a public.fixed_assets%rowtype; fy_end date := (p_fy + interval '1 year')::date - 1; s date; days int; yd int; prior numeric; amt numeric;
begin
  select * into a from public.fixed_assets where id = p_asset;
  if not found or a.voided or a.put_to_use > fy_end then return 0; end if;
  s := greatest(a.put_to_use, p_fy); days := fy_end - s + 1; yd := fy_end - p_fy + 1;
  if p_fy < a.dep_from then return 0; end if;
  select a.opening_acc_dep + coalesce(sum(amount), 0) into prior from public.fixed_asset_dep where asset_id = a.id and fy_start < p_fy;
  if a.method = 'slm' then amt := (a.cost - a.residual) / a.life_years * days / yd;
  else amt := (a.cost - prior) * a.rate_pct / 100 * days / yd; end if;
  amt := least(amt, a.cost - a.residual - prior);
  return round(greatest(amt, 0), 2);
end $$;
revoke all on function public.tp_fa_dep_calc(uuid, date) from public, anon, authenticated;

create or replace function public.preview_depreciation(p_fy_start date) returns table(asset_id uuid, name text, amount numeric)
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_fy_start is null or p_fy_start <> public.tp_fy_start(p_fy_start) then raise exception 'Give the first day of a financial year (1 April)'; end if;
  return query select a.id, a.name, public.tp_fa_dep_calc(a.id, p_fy_start) from public.fixed_assets a
    where a.user_id = u and not a.voided and a.put_to_use <= (p_fy_start + interval '1 year')::date - 1 and a.dep_from <= p_fy_start
      and not exists (select 1 from public.fixed_asset_dep d where d.asset_id = a.id and d.fy_start = p_fy_start) order by a.name;
end $$;

create or replace function public.post_depreciation(p_fy_start date) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); fy_end date; a record; amt numeric; total numeric := 0; n int := 0; jid uuid; dep uuid; acd uuid; missing int; rows jsonb := '[]'::jsonb;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select posting_enabled from public.ledger_settings where user_id = u), false) then raise exception 'Set up the ledger first'; end if;
  if p_fy_start is null or p_fy_start <> public.tp_fy_start(p_fy_start) then raise exception 'Give the first day of a financial year (1 April)'; end if;
  fy_end := (p_fy_start + interval '1 year')::date - 1;
  if fy_end > current_date then raise exception 'Financial year % has not ended yet. Depreciation is posted for finished years', to_char(p_fy_start, 'YYYY') || '-' || to_char(fy_end, 'YY'); end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text || 'depreciation', 0));
  -- every earlier year the asset was in use must already be posted (written-down value depends on it)
  for a in select * from public.fixed_assets f where f.user_id = u and not f.voided and f.put_to_use <= fy_end and f.dep_from <= p_fy_start
             and not exists (select 1 from public.fixed_asset_dep d where d.asset_id = f.id and d.fy_start = p_fy_start) order by f.name loop
    select ((extract(year from p_fy_start)::int - extract(year from a.dep_from)::int)) - count(*)::int into missing
      from public.fixed_asset_dep d where d.asset_id = a.id and d.fy_start < p_fy_start;
    if missing > 0 then raise exception 'Post depreciation for the earlier year(s) first (asset "%" has % year(s) pending before FY %)', a.name, missing, to_char(p_fy_start, 'YYYY') || '-' || to_char(fy_end, 'YY'); end if;
  end loop;
  dep := public.tp_gl(u, 'depreciation'); acd := public.tp_gl(u, 'acc_dep');
  for a in select * from public.fixed_assets f where f.user_id = u and not f.voided and f.put_to_use <= fy_end and f.dep_from <= p_fy_start
             and not exists (select 1 from public.fixed_asset_dep d where d.asset_id = f.id and d.fy_start = p_fy_start) order by f.name loop
    amt := public.tp_fa_dep_calc(a.id, p_fy_start); total := total + amt; n := n + 1;
    rows := rows || jsonb_build_object('asset', a.id, 'amount', amt);
  end loop;
  if n = 0 then return jsonb_build_object('journal_id', null, 'total', 0, 'assets', 0, 'message', 'Nothing to post for this year'); end if;
  if total > 0 then
    insert into public.journals(user_id, entry_date, narration, kind)
    values (u, fy_end, 'Depreciation for FY ' || to_char(p_fy_start, 'YYYY') || '-' || to_char(fy_end, 'YY'), 'manual') returning id into jid;
    insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, memo) values (jid, u, dep, total, 0, null), (jid, u, acd, 0, total, null);
  end if;
  insert into public.fixed_asset_dep(user_id, asset_id, fy_start, fy_end, amount, journal_id)
  select u, (r->>'asset')::uuid, p_fy_start, fy_end, (r->>'amount')::numeric, case when (r->>'amount')::numeric > 0 then jid end from jsonb_array_elements(rows) r;
  return jsonb_build_object('journal_id', jid, 'total', total, 'assets', n);
end $$;

create or replace function public.void_fixed_asset(p_id uuid, p_reason text, p_date date) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); a public.fixed_assets%rowtype;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into a from public.fixed_assets where id = p_id and user_id = u for update;
  if not found then raise exception 'Asset not found'; end if;
  if a.voided then raise exception 'This asset is already cancelled'; end if;
  if exists (select 1 from public.fixed_asset_dep where asset_id = a.id) then raise exception 'Depreciation has been posted for this asset. Reverse it first, or record a disposal by manual journal'; end if;
  perform public.reverse_journal(a.purchase_journal, p_reason, p_date);
  update public.fixed_assets set voided = true where id = a.id;
end $$;

revoke all on function public.set_closing_stock(date, numeric, text, text), public.add_fixed_asset(text, text, date, numeric, numeric, text, numeric, numeric, uuid, text, date, numeric, date),
  public.preview_depreciation(date), public.post_depreciation(date), public.void_fixed_asset(uuid, text, date) from public, anon;
grant execute on function public.set_closing_stock(date, numeric, text, text), public.add_fixed_asset(text, text, date, numeric, numeric, text, numeric, numeric, uuid, text, date, numeric, date),
  public.preview_depreciation(date), public.post_depreciation(date), public.void_fixed_asset(uuid, text, date) to authenticated;
