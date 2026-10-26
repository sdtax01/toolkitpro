begin;
alter table public.accounts     alter column opening type numeric;
alter table public.transactions alter column amount  type numeric;
alter table public.invoices     alter column amount type numeric, alter column paid type numeric, alter column taxable type numeric,
  alter column cgst type numeric, alter column sgst type numeric, alter column igst type numeric;
alter table public.assets  alter column value type numeric;
alter table public.budgets alter column monthly_limit type numeric;
alter table public.goals   alter column target type numeric, alter column saved type numeric;
commit;
