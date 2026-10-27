-- Undo 016: puts back the 011 versions of tp_gl and tp_gl_cat and removes the GST set-off function.
drop function if exists public.post_gst_setoff(date, text);
drop function if exists public.tp_gl_bal(uuid, text, date);
drop trigger if exists tp_gl_reserved on public.gl_accounts;
drop function if exists public.tp_gl_reserved_guard();

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

