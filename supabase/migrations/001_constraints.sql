-- 001_constraints.sql  - database-side accounting rules. Undo: supabase/undo/001_constraints_down.sql
-- Stops with a message (and changes nothing) if existing data would break a rule.
begin;
do $$ begin
  if exists (select 1 from public.invoices group by user_id, kind, lower(btrim(number)) having count(*) > 1) then
    raise exception 'Duplicate invoice numbers exist. Fix them first (see 000_diagnostics.sql, query 1).'; end if;
  if exists (select 1 from public.invoices where paid < 0 or paid > amount) then
    raise exception 'Some invoices have paid below 0 or above the total. Fix them first (000_diagnostics.sql, query 2).'; end if;
  if exists (select 1 from public.invoices where taxable is not null
      and abs(amount - (taxable + coalesce(cgst,0) + coalesce(sgst,0) + coalesce(igst,0))) >= 0.005) then
    raise exception 'Some invoices have a GST breakup that does not match the total. Fix them first (000_diagnostics.sql, query 3).'; end if;
end $$;

create unique index if not exists invoices_user_kind_number_uq
  on public.invoices (user_id, kind, lower(btrim(number)));

alter table public.invoices drop constraint if exists invoices_paid_range;
alter table public.invoices add constraint invoices_paid_range check (paid >= 0 and paid <= amount);

alter table public.invoices drop constraint if exists invoices_gst_total;
alter table public.invoices add constraint invoices_gst_total
  check (taxable is null or abs(amount - (taxable + coalesce(cgst,0) + coalesce(sgst,0) + coalesce(igst,0))) < 0.005);
commit;
