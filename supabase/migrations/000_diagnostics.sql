-- 000_diagnostics.sql  (READ ONLY - changes nothing)
-- Run in Supabase > SQL Editor BEFORE 001. Every query below should return zero rows.
-- Rows returned = data to fix by hand first, otherwise 001 will stop with a clear message.

-- 1. Duplicate invoice/bill numbers (same user, same type, ignoring case and spaces)
select user_id, kind, lower(btrim(number)) as number, count(*) as copies, array_agg(id) as invoice_ids
from public.invoices group by 1,2,3 having count(*) > 1;

-- 2. Paid amount below zero or above the invoice total
select id, number, kind, amount, paid from public.invoices where paid < 0 or paid > amount;

-- 3. GST breakup that does not add up to the total (only invoices that have a breakup)
select id, number, amount, taxable, cgst, sgst, igst
from public.invoices
where taxable is not null
  and abs(amount - (taxable + coalesce(cgst,0) + coalesce(sgst,0) + coalesce(igst,0))) >= 0.005;

-- 4. Invoices whose "paid" differs from the payments actually linked to them
select i.id, i.number, i.kind, i.paid as paid_on_invoice, coalesce(sum(t.amount),0) as linked_payments
from public.invoices i left join public.transactions t on t.invoice_id = i.id
group by i.id having round(i.paid,2) <> round(coalesce(sum(t.amount),0),2);

-- 5. Amounts with more than 2 decimals (matters only for optional/005)
select 'transactions' as tbl, id, amount from public.transactions where amount <> round(amount,2)
union all select 'invoices', id, amount from public.invoices where amount <> round(amount,2) or paid <> round(paid,2);
