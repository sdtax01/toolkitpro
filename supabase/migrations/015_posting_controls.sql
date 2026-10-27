-- 015_posting_controls.sql - two OPTIONAL safety switches for the ledger. Both are OFF by default, so nothing changes until you turn them on.
-- Needs 010-012. Undo: supabase/undo/015_posting_controls_down.sql
--   strict_posting    : if a ledger posting fails for any reason, the invoice/payment that caused it is NOT saved either
--                       (today the document is saved and the failure is only written to ledger_errors, so books can drift).
--   protect_documents : with the ledger on, a sales invoice can no longer be deleted (issue a credit note instead, GST Sec 34 / Rule 46),
--                       and no invoice or bill that has recorded payments can be deleted (stops orphan receipts posting to Sales).
-- Single-user: the same signed-in owner switches these; there are no roles or approvals.

alter table public.ledger_settings add column if not exists strict_posting boolean not null default false;
alter table public.ledger_settings add column if not exists protect_documents boolean not null default false;

-- identical to 011 except: when strict_posting is on, an unexpected posting error is re-raised (the whole save rolls back)
create or replace function public.tp_post_trigger() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; rid uuid; on_ boolean; strict_ boolean;
begin
  u := case when tg_op = 'DELETE' then old.user_id else new.user_id end; rid := case when tg_op = 'DELETE' then old.id else new.id end;
  select posting_enabled, strict_posting into on_, strict_ from public.ledger_settings where user_id = u;
  if not coalesce(on_, false) then return coalesce(new, old); end if;
  begin
    if tg_op = 'DELETE' then perform public.tp_sync_source(u, tg_table_name, rid, null, null, null, case when tg_table_name = 'accounts' then 'opening' else 'auto' end);
    else perform public.tp_sync_one(tg_table_name, rid, u); end if;
    if tg_table_name = 'accounts' and tg_op = 'UPDATE' then update public.gl_accounts set name = new.name where user_id = u and bank_account_id = new.id and name <> new.name; end if;
  exception
    when sqlstate 'TP001' then
      if tg_table_name = 'accounts' then
        insert into public.ledger_errors(user_id, source_table, source_id, message) values (u, tg_table_name, rid, sqlerrm || ' (opening balance not posted; unlock and use Re-sync)');
      else raise; end if;
    when others then
      if coalesce(strict_, false) then raise; end if;
      insert into public.ledger_errors(user_id, source_table, source_id, message) values (u, tg_table_name, rid, sqlerrm);
  end;
  return coalesce(new, old);
end $$;

create or replace function public.tp_protect_delete() returns trigger language plpgsql security definer set search_path = public as $$
declare prot boolean; on_ boolean;
begin
  select posting_enabled, protect_documents into on_, prot from public.ledger_settings where user_id = old.user_id;
  if not (coalesce(on_, false) and coalesce(prot, false)) then return old; end if;
  if old.kind = 'sale' then
    raise exception 'A sales invoice cannot be deleted. Issue a credit note against it instead.' using errcode = 'TP005'; end if;
  if exists (select 1 from public.transactions t where t.invoice_id = old.id) then
    raise exception 'This document has recorded payments. Delete the payments first.' using errcode = 'TP005'; end if;
  return old;
end $$;
drop trigger if exists tp_protect_del on public.invoices;
create trigger tp_protect_del before delete on public.invoices for each row execute function public.tp_protect_delete();

create or replace function public.set_ledger_controls(p_strict boolean, p_protect boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((select posting_enabled from public.ledger_settings where user_id = u), false) then raise exception 'Set up the ledger first'; end if;
  update public.ledger_settings set strict_posting = coalesce(p_strict, strict_posting), protect_documents = coalesce(p_protect, protect_documents) where user_id = u;
  return (select jsonb_build_object('strict_posting', strict_posting, 'protect_documents', protect_documents) from public.ledger_settings where user_id = u);
end $$;
revoke all on function public.set_ledger_controls(boolean, boolean) from public, anon;
grant execute on function public.set_ledger_controls(boolean, boolean) to authenticated;
