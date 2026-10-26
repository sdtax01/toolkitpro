-- Undo 014. Restores the Phase 2 posting rule (all sales to Sales, all bills to Purchases) and removes sub-accounts and invoice heads.
-- Journals already posted are not changed. If you later press Re-sync, invoices that used a custom head are re-posted to Sales / Purchases.
begin;
drop trigger if exists tp_invoice_head on public.invoices;
drop function if exists public.tp_invoice_head_guard();
create or replace function public.tp_desired_invoice(p_id uuid) returns table(entry_date date, narration text, lines jsonb)
language plpgsql security definer set search_path = public as $$
declare i public.invoices%rowtype; pn text; base numeric; ln jsonb := '[]'::jsonb; u uuid; tot numeric; c numeric; s numeric; g numeric;
begin
  select * into i from public.invoices where id = p_id; if not found then return; end if;
  u := i.user_id; select name into pn from public.parties where id = i.party_id and user_id = i.user_id;
  tot := round(i.amount, 2); c := round(coalesce(i.cgst,0), 2); s := round(coalesce(i.sgst,0), 2); g := round(coalesce(i.igst,0), 2);
  base := tot - c - s - g;
  if base < 0 then raise exception 'Invoice % has tax larger than its total', i.number; end if;
  if i.kind = 'sale' then
    ln := ln || public.tp_line(public.tp_gl(u,'receivables'), tot, 0, i.party_id);
    if base > 0 then ln := ln || public.tp_line(public.tp_gl(u,'sales'), 0, base); end if;
    if c > 0 then ln := ln || public.tp_line(public.tp_gl(u,'output_cgst'), 0, c); end if;
    if s > 0 then ln := ln || public.tp_line(public.tp_gl(u,'output_sgst'), 0, s); end if;
    if g > 0 then ln := ln || public.tp_line(public.tp_gl(u,'output_igst'), 0, g); end if;
  else
    if base > 0 then ln := ln || public.tp_line(public.tp_gl(u,'purchases'), base, 0); end if;
    if c > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_cgst'), c, 0); end if;
    if s > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_sgst'), s, 0); end if;
    if g > 0 then ln := ln || public.tp_line(public.tp_gl(u,'input_igst'), g, 0); end if;
    ln := ln || public.tp_line(public.tp_gl(u,'payables'), 0, tot, i.party_id);
  end if;
  entry_date := i.date; narration := (case when i.kind = 'sale' then 'Invoice ' else 'Bill ' end) || i.number || coalesce(' - ' || pn, ''); lines := ln; return next;
end $$;
drop function if exists public.add_gl_subledger(text, uuid, text);
drop trigger if exists tp_gl_parent on public.gl_accounts;
drop function if exists public.tp_gl_parent_guard();
alter table public.invoices drop column if exists gl_account_id;
alter table public.gl_accounts drop column if exists parent_id;
commit;
