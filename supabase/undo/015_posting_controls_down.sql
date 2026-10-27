-- Undo 015: puts back the 011 version of tp_post_trigger and removes the switches.
drop trigger if exists tp_protect_del on public.invoices;
drop function if exists public.tp_protect_delete();
drop function if exists public.set_ledger_controls(boolean, boolean);

create or replace function public.tp_post_trigger() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; rid uuid; on_ boolean;
begin
  u := case when tg_op = 'DELETE' then old.user_id else new.user_id end; rid := case when tg_op = 'DELETE' then old.id else new.id end;
  select posting_enabled into on_ from public.ledger_settings where user_id = u;
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
      insert into public.ledger_errors(user_id, source_table, source_id, message) values (u, tg_table_name, rid, sqlerrm);
  end;
  return coalesce(new, old);
end $$;

alter table public.ledger_settings drop column if exists strict_posting, drop column if exists protect_documents;
