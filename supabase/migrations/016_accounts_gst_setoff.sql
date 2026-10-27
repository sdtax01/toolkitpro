-- 016_accounts_gst_setoff.sql - extra built-in ledger accounts, a few special transaction categories, and a GST set-off journal.
-- Needs 010-012. Additive: new accounts are created only when first used; existing postings are unchanged.
-- Undo: supabase/undo/016_accounts_gst_setoff_down.sql
--
-- New built-in accounts (created on first use):
--   1240 GST paid (cash ledger)      1300 Inventory (closing stock)     1310 Advances to suppliers     1400 TDS receivable
--   1500 Fixed assets (at cost)      1590 Accumulated depreciation       2300 Advances from customers   2400 TDS payable
--   3000 Capital account             3200 Drawings                       5150 Change in inventories     5190 Depreciation
--   5195 Loss on disposal / write-off
-- Special categories on Transactions (type must match; the text is not case sensitive). Nothing else about Transactions changes:
--   Income : "Advance received"  -> Cr Advances from customers (a liability until you invoice; link the receipt to the invoice later)
--            "Capital introduced"-> Cr Capital account
--   Expense: "Advance paid"      -> Dr Advances to suppliers
--            "GST payment"       -> Dr GST paid (cash ledger)  (NOT an expense; use GST set-off below to clear output tax)
--            "TDS deposited"     -> Dr TDS payable
--            "Drawings"          -> Dr Drawings
-- The existing category "Taxes" still posts to General expenses exactly as before.
-- An existing transaction that already uses one of these category names moves to the new account the next time the ledger re-syncs
-- (Ledger Setup > Re-sync); it is a reversal plus a fresh entry, never an overwrite.

create or replace function public.tp_gl(p_user uuid, p_key text) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; d record;
begin
  select id into v from public.gl_accounts where user_id = p_user and system_key = p_key;
  if found then return v; end if;
  select * into d from (values
    ('cash','1010','Cash in hand','asset'),('receivables','1100','Accounts receivable (debtors)','asset'),
    ('input_cgst','1210','Input CGST','asset'),('input_sgst','1220','Input SGST','asset'),('input_igst','1230','Input IGST','asset'),
    ('gst_cash','1240','GST paid (cash ledger)','asset'),
    ('inventory','1300','Inventory (closing stock)','asset'),('supplier_advances','1310','Advances to suppliers','asset'),
    ('tds_receivable','1400','TDS receivable','asset'),
    ('fixed_assets','1500','Fixed assets (at cost)','asset'),('acc_dep','1590','Accumulated depreciation','asset'),
    ('payables','2100','Accounts payable (creditors)','liability'),
    ('output_cgst','2210','Output CGST','liability'),('output_sgst','2220','Output SGST','liability'),('output_igst','2230','Output IGST','liability'),
    ('customer_advances','2300','Advances from customers','liability'),('tds_payable','2400','TDS payable','liability'),
    ('capital','3000','Capital account','equity'),('opening_equity','3100','Opening balance equity','equity'),('drawings','3200','Drawings','equity'),
    ('sales','4100','Sales','income'),('other_income','4900','Other income','income'),
    ('purchases','5100','Purchases','expense'),('stock_adjust','5150','Change in inventories','expense'),
    ('depreciation','5190','Depreciation','expense'),('disposal_loss','5195','Loss on disposal / write-off','expense'),
    ('general_expense','5900','General expenses','expense')
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
  if p_type = 'income' and lower(c) = 'advance received' then return public.tp_gl(p_user, 'customer_advances'); end if;
  if p_type = 'income' and lower(c) = 'capital introduced' then return public.tp_gl(p_user, 'capital'); end if;
  if p_type = 'expense' and lower(c) = 'advance paid' then return public.tp_gl(p_user, 'supplier_advances'); end if;
  if p_type = 'expense' and lower(c) = 'gst payment' then return public.tp_gl(p_user, 'gst_cash'); end if;
  if p_type = 'expense' and lower(c) = 'tds deposited' then return public.tp_gl(p_user, 'tds_payable'); end if;
  if p_type = 'expense' and lower(c) = 'drawings' then return public.tp_gl(p_user, 'drawings'); end if;
  select id into v from public.gl_accounts where user_id = p_user and type = p_type and lower(name) = lower(c) and system_key is null and bank_account_id is null;
  if found then return v; end if;
  if p_type = 'income' then lo := 4200; hi := 4899; else lo := 5200; hi := 5899; end if;
  select (coalesce(max(code::int), lo - 1) + 1)::text into cd from public.gl_accounts where user_id = p_user and code ~ '^[0-9]+$' and code::int between lo and hi;
  if cd::int > hi then raise exception 'Too many % categories for the ledger. Merge some categories.', p_type; end if;
  insert into public.gl_accounts(user_id, code, name, type) values (p_user, cd, c, p_type) returning id into v;
  return v;
end $$;

-- the new built-in codes belong to the built-in accounts: a hand-made account cannot take them
create or replace function public.tp_gl_reserved_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.system_key is null and new.bank_account_id is null
     and new.code in ('1240','1300','1310','1400','1500','1590','2300','2400','3000','3200','5150','5190','5195') then
    raise exception 'Code % is reserved for a built-in account. Choose another code', new.code using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists tp_gl_reserved on public.gl_accounts;
create trigger tp_gl_reserved before insert on public.gl_accounts for each row execute function public.tp_gl_reserved_guard();

-- tp_gl_bal: balance (debit minus credit) of one built-in account as on a date
create or replace function public.tp_gl_bal(p_user uuid, p_key text, p_date date) returns numeric language sql security definer set search_path = public as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.journal_lines l join public.journals j on j.id = l.journal_id
   join public.gl_accounts a on a.id = l.gl_account_id
  where l.user_id = p_user and a.system_key = p_key and j.entry_date <= p_date $$;
revoke all on function public.tp_gl_bal(uuid, text, date) from public, anon, authenticated;

-- GST set-off: ONE balanced manual journal that clears output GST using input credit (statutory order) and the GST paid account.
--   IGST credit -> IGST, then CGST, then SGST liability.   CGST credit -> CGST, then IGST.   SGST credit -> SGST, then IGST.
--   Liability still left is paid from "GST paid (cash ledger)" up to its balance (this ledger keeps one combined GST-paid balance;
--   the head-wise electronic cash ledger is a simplification). Balances are taken as on p_date. Reverse it from Journal Entry like any manual journal.
--   Professional check: agree the result with the filed GSTR-3B before relying on it.
create or replace function public.post_gst_setoff(p_date date, p_narration text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); jid uuid; r record; d numeric := 0; c numeric := 0; x numeric; used numeric := 0; pay numeric; paid numeric; uses jsonb := '[]'::jsonb;
  oc numeric; os numeric; oi numeric; ic numeric; isg numeric; ii numeric; cash numeric;
  acc_oc uuid; acc_os uuid; acc_oi uuid; acc_ic uuid; acc_is uuid; acc_ii uuid; acc_cash uuid;
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select posting_enabled from public.ledger_settings where user_id = u), false) then raise exception 'Set up the ledger first'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text || 'gst_setoff', 0));
  acc_oc := public.tp_gl(u,'output_cgst'); acc_os := public.tp_gl(u,'output_sgst'); acc_oi := public.tp_gl(u,'output_igst');
  acc_ic := public.tp_gl(u,'input_cgst');  acc_is := public.tp_gl(u,'input_sgst');  acc_ii := public.tp_gl(u,'input_igst'); acc_cash := public.tp_gl(u,'gst_cash');
  oc := greatest(-public.tp_gl_bal(u,'output_cgst',p_date), 0); os := greatest(-public.tp_gl_bal(u,'output_sgst',p_date), 0); oi := greatest(-public.tp_gl_bal(u,'output_igst',p_date), 0);
  ic := greatest(public.tp_gl_bal(u,'input_cgst',p_date), 0);   isg := greatest(public.tp_gl_bal(u,'input_sgst',p_date), 0); ii := greatest(public.tp_gl_bal(u,'input_igst',p_date), 0);
  cash := greatest(public.tp_gl_bal(u,'gst_cash',p_date), 0);
  -- IGST input first
  x := least(ii, oi); if x > 0 then uses := uses || jsonb_build_object('i', acc_ii, 'o', acc_oi, 'a', x); ii := ii - x; oi := oi - x; end if;
  x := least(ii, oc); if x > 0 then uses := uses || jsonb_build_object('i', acc_ii, 'o', acc_oc, 'a', x); ii := ii - x; oc := oc - x; end if;
  x := least(ii, os); if x > 0 then uses := uses || jsonb_build_object('i', acc_ii, 'o', acc_os, 'a', x); ii := ii - x; os := os - x; end if;
  -- CGST input: CGST, then IGST
  x := least(ic, oc); if x > 0 then uses := uses || jsonb_build_object('i', acc_ic, 'o', acc_oc, 'a', x); ic := ic - x; oc := oc - x; end if;
  x := least(ic, oi); if x > 0 then uses := uses || jsonb_build_object('i', acc_ic, 'o', acc_oi, 'a', x); ic := ic - x; oi := oi - x; end if;
  -- SGST input: SGST, then IGST
  x := least(isg, os); if x > 0 then uses := uses || jsonb_build_object('i', acc_is, 'o', acc_os, 'a', x); isg := isg - x; os := os - x; end if;
  x := least(isg, oi); if x > 0 then uses := uses || jsonb_build_object('i', acc_is, 'o', acc_oi, 'a', x); isg := isg - x; oi := oi - x; end if;
  pay := least(cash, oi + oc + os);
  select coalesce(sum(a), 0) into used from jsonb_to_recordset(uses) as t(i uuid, o uuid, a numeric);
  if used = 0 and pay <= 0 then return jsonb_build_object('journal_id', null, 'message', 'Nothing to set off'); end if;
  insert into public.journals(user_id, entry_date, narration, kind)
  values (u, p_date, coalesce(nullif(btrim(coalesce(p_narration,'')), ''), 'GST set-off and payment as on ' || p_date), 'manual') returning id into jid;
  for r in select o, sum(a) as a from jsonb_to_recordset(uses) as t(i uuid, o uuid, a numeric) group by o loop
    insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, memo) values (jid, u, r.o, r.a, 0, 'Set off against input credit'); d := d + r.a; end loop;
  for r in select i, sum(a) as a from jsonb_to_recordset(uses) as t(i uuid, o uuid, a numeric) group by i loop
    insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, memo) values (jid, u, r.i, 0, r.a, 'Input credit utilised'); c := c + r.a; end loop;
  x := pay;
  if x > 0 and oi > 0 then paid := least(x, oi); insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, memo) values (jid, u, acc_oi, paid, 0, 'Paid from GST paid account'); d := d + paid; x := x - paid; end if;
  if x > 0 and oc > 0 then paid := least(x, oc); insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, memo) values (jid, u, acc_oc, paid, 0, 'Paid from GST paid account'); d := d + paid; x := x - paid; end if;
  if x > 0 and os > 0 then paid := least(x, os); insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, memo) values (jid, u, acc_os, paid, 0, 'Paid from GST paid account'); d := d + paid; x := x - paid; end if;
  if pay - x > 0 then insert into public.journal_lines(journal_id, user_id, gl_account_id, debit, credit, memo) values (jid, u, acc_cash, 0, pay - x, 'GST paid account utilised'); c := c + (pay - x); end if;
  return jsonb_build_object('journal_id', jid, 'set_off', used, 'paid_from_gst_paid_account', pay - x, 'debit', d, 'credit', c);
end $$;
revoke all on function public.post_gst_setoff(date, text) from public, anon;
grant execute on function public.post_gst_setoff(date, text) to authenticated;
