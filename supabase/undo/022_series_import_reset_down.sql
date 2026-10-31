-- Undo for 022_series_import_reset.sql. Restores the original immutability guards and removes the reset function.
-- The two new columns are dropped too: any saved numbering series and expense voucher numbers are lost.
drop function if exists public.reset_posted_entries(text, boolean);
do $$ begin
  if to_regprocedure('public.tp_immutable()') is not null then
    execute $f$
      create or replace function public.tp_immutable() returns trigger language plpgsql as $b$
      begin raise exception 'Posted journal entries cannot be changed or deleted. Post a reversal instead.' using errcode = 'TP002'; end $b$ $f$;
  end if;
  if to_regprocedure('public.tp_fa_immutable()') is not null then
    execute $f$
      create or replace function public.tp_fa_immutable() returns trigger language plpgsql as $b$
      begin raise exception 'This record cannot be changed or deleted. Post a reversal journal instead.' using errcode = 'TP002'; end $b$ $f$;
  end if;
end $$;
drop index if exists public.transactions_voucher_uq;
alter table public.transactions drop column if exists voucher_no;
alter table public.settings drop column if exists doc_series;
notify pgrst, 'reload schema';
