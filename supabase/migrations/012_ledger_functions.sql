-- 012_ledger_functions.sql - the only ways to write to the ledger. Undo everything in 010-012: 012_ledger_down.sql
-- All are SECURITY DEFINER but always act on auth.uid() only.

create or replace function public.resync_ledger(p_strict boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r record; res text; posted int := 0; reversed int := 0; errs jsonb := '[]'::jsonb;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select posting_enabled from public.ledger_settings where user_id = u), false) then raise exception 'Set up the ledger first'; end if;
  for r in select 'accounts'::text t, id, name::text lbl, 1 o from public.accounts where user_id = u
           union all select 'invoices', id, number, 2 from public.invoices where user_id = u
           union all select 'transactions', id, description, 3 from public.transactions where user_id = u order by o, lbl loop
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

create or replace function public.setup_ledger(p_opening_date date) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); od date; k text; r record; res jsonb;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_opening_date is null then raise exception 'Choose the date your books start from'; end if;
  insert into public.ledger_settings(user_id) values (u) on conflict do nothing;
  if coalesce((select posting_enabled from public.ledger_settings where user_id = u), false) then return public.resync_ledger(false) || jsonb_build_object('already_set_up', true); end if;
  od := least(p_opening_date, (select min(date) from public.transactions where user_id = u), (select min(date) from public.invoices where user_id = u));
  foreach k in array array['cash','receivables','payables','input_cgst','input_sgst','input_igst','output_cgst','output_sgst','output_igst','opening_equity','sales','other_income','purchases','general_expense'] loop perform public.tp_gl(u, k); end loop;
  for r in select id from public.accounts where user_id = u loop perform public.tp_gl_bank(u, r.id); end loop;
  update public.ledger_settings set opening_date = od, posting_enabled = true, setup_at = now() where user_id = u;
  res := public.resync_ledger(true);
  return res || jsonb_build_object('opening_date', od);
end $$;

create or replace function public.ledger_unsynced() returns table(source_table text, source_id uuid, reason text) language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r record; d record; a record; h text;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  for r in select 'accounts'::text t, id from public.accounts where user_id = u union all select 'invoices', id from public.invoices where user_id = u union all select 'transactions', id from public.transactions where user_id = u loop
    d := null;
    begin
      if r.t = 'invoices' then select * into d from public.tp_desired_invoice(r.id); elsif r.t = 'transactions' then select * into d from public.tp_desired_txn(r.id); else select * into d from public.tp_desired_opening(r.id); end if;
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

create or replace function public.add_gl_account(p_code text, p_name text, p_type text) returns uuid language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); v uuid;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_code is null or p_code !~ '^[0-9]{3,6}$' then raise exception 'Account code must be 3 to 6 digits'; end if;
  if p_code in ('1010','1100','1210','1220','1230','2100','2210','2220','2230','3100','4100','4900','5100','5900') or p_code ~ '^10[2-9][0-9]$' then raise exception 'Code % is reserved for built-in accounts. Choose another code', p_code; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Account name is required'; end if;
  if p_type not in ('asset','liability','equity','income','expense') then raise exception 'Invalid account type'; end if;
  insert into public.gl_accounts(user_id, code, name, type) values (u, p_code, btrim(p_name), p_type) returning id into v;
  return v;
exception when unique_violation then raise exception 'Account code % already exists', p_code;
end $$;

create or replace function public.post_manual_journal(p_date date, p_narration text, p_lines jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); jid uuid; l jsonb; d numeric := 0; c numeric := 0; n int := 0; acc record; dr numeric; cr numeric;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select posting_enabled from public.ledger_settings where user_id = u), false) then raise exception 'Set up the ledger first'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if btrim(coalesce(p_narration,'')) = '' then raise exception 'Narration is required'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Lines must be a list'; end if;
  insert into public.journals(user_id, entry_date, narration, kind) values (u, p_date, btrim(p_narration), 'manual') returning id into jid;
  for l in select * from jsonb_array_elements(p_lines) loop
    dr := round(coalesce((l->>'debit')::numeric, 0), 2); cr := round(coalesce((l->>'credit')::numeric, 0), 2);
    if dr < 0 or cr < 0 or (dr > 0 and cr > 0) or dr + cr = 0 then raise exception 'Each line needs either a debit or a credit amount'; end if;
    select * into acc from public.gl_accounts where id = (l->>'account_id')::uuid and user_id = u;
    if not found then raise exception 'Ledger account not found'; end if;
    if not acc.is_active then raise exception 'Account % is inactive', acc.name; end if;
    if acc.system_key in ('receivables','payables') then raise exception 'Post % through invoices and payments, not by manual journal', acc.name; end if;
    insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, memo) values (jid, u, acc.id, dr, cr, nullif(btrim(coalesce(l->>'memo','')), ''));
    d := d + dr; c := c + cr; n := n + 1;
  end loop;
  if n < 2 then raise exception 'A journal needs at least two lines'; end if;
  if d <> c then raise exception 'Debit (%) and credit (%) must be equal', d, c; end if;
  return jid;
end $$;

create or replace function public.reverse_journal(p_journal uuid, p_reason text, p_date date) returns uuid language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); j public.journals%rowtype; rid uuid;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'Give a reason for the reversal'; end if;
  if p_date is null then raise exception 'Reversal date is required'; end if;
  select * into j from public.journals where id = p_journal and user_id = u;
  if not found then raise exception 'Journal not found'; end if;
  if j.kind <> 'manual' then raise exception 'Only manual journals can be reversed here. Edit or delete the source invoice or transaction instead.'; end if;
  if exists (select 1 from public.journals where reverses = j.id) then raise exception 'This journal is already reversed'; end if;
  insert into public.journals(user_id, entry_date, narration, kind, reverses, reason)
  values (u, p_date, 'Reversal of JV-' || j.journal_no || ': ' || j.narration, 'reversal', j.id, btrim(p_reason)) returning id into rid;
  insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, party_id, memo)
  select rid, u, gl_account_id, credit, debit, party_id, memo from public.journal_lines where journal_id = j.id;
  return rid;
end $$;

create or replace function public.set_period_lock(p_date date) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_date is not null and p_date > current_date + 1 then raise exception 'You cannot lock a date in the future'; end if;
  insert into public.ledger_settings(user_id) values (u) on conflict do nothing;
  update public.ledger_settings set locked_through = p_date where user_id = u;
  insert into public.ledger_lock_history(user_id, locked_through) values (u, p_date);
end $$;

revoke all on function public.resync_ledger(boolean), public.setup_ledger(date), public.ledger_unsynced(), public.add_gl_account(text,text,text),
  public.post_manual_journal(date,text,jsonb), public.reverse_journal(uuid,text,date), public.set_period_lock(date) from public, anon;
grant execute on function public.resync_ledger(boolean), public.setup_ledger(date), public.ledger_unsynced(), public.add_gl_account(text,text,text),
  public.post_manual_journal(date,text,jsonb), public.reverse_journal(uuid,text,date), public.set_period_lock(date) to authenticated;
