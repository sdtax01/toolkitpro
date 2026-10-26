-- OPTIONAL 005 - money columns limited to 2 decimals (numeric(14,2)). Run 000 query 5 first.
begin;
do $$ begin
  if exists (select 1 from public.transactions where amount <> round(amount,2))
  or exists (select 1 from public.invoices where amount <> round(amount,2) or paid <> round(paid,2)
        or coalesce(taxable,0) <> round(coalesce(taxable,0),2) or coalesce(cgst,0) <> round(coalesce(cgst,0),2)
        or coalesce(sgst,0) <> round(coalesce(sgst,0),2) or coalesce(igst,0) <> round(coalesce(igst,0),2)) then
    raise exception 'Some amounts have more than 2 decimals. Review them first (000_diagnostics.sql, query 5).'; end if; end $$;
alter table public.accounts     alter column opening type numeric(14,2);
alter table public.transactions alter column amount  type numeric(14,2);
alter table public.invoices     alter column amount  type numeric(14,2), alter column paid type numeric(14,2),
  alter column taxable type numeric(14,2), alter column cgst type numeric(14,2), alter column sgst type numeric(14,2), alter column igst type numeric(14,2);
alter table public.assets  alter column value type numeric(14,2);
alter table public.budgets alter column monthly_limit type numeric(14,2);
alter table public.goals   alter column target type numeric(14,2), alter column saved type numeric(14,2);
commit;
