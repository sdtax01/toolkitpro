-- Undo 001
begin;
drop index if exists public.invoices_user_kind_number_uq;
alter table public.invoices drop constraint if exists invoices_paid_range;
alter table public.invoices drop constraint if exists invoices_gst_total;
commit;
