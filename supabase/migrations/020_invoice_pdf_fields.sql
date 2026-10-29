-- 020: fields needed to print a GST Tax Invoice PDF (Rule 46, CGST Rules 2017) and a ledger statement PDF.
-- Additive only: every column is nullable (or has a default), nothing existing is changed or dropped.
-- The app works without this file; until it is run the new form fields simply are not saved.
-- Run in Supabase > SQL Editor, staging first, after a backup. Undo: supabase/undo/020_invoice_pdf_fields_down.sql

-- Customers / suppliers
alter table public.parties
  add column if not exists gst_type text,          -- regular | composition | sez | unregistered | overseas
  add column if not exists pan text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists pincode text;

-- Your own business (printed on every invoice and statement)
alter table public.settings
  add column if not exists pan text,
  add column if not exists city text,
  add column if not exists pincode text,
  add column if not exists bank_name text,
  add column if not exists bank_account text,
  add column if not exists bank_ifsc text,
  add column if not exists upi_id text,
  add column if not exists signatory text,
  add column if not exists terms text,
  add column if not exists default_hsn text;       -- default HSN / SAC pre-filled on new invoices

-- Per invoice
alter table public.invoices
  add column if not exists description text,       -- description of goods / services
  add column if not exists hsn_sac text,
  add column if not exists quantity numeric,
  add column if not exists unit text,
  add column if not exists reverse_charge boolean not null default false,
  add column if not exists place_of_supply text;   -- state name; blank = the customer's state

-- Format checks that never reject existing rows (NOT VALID skips old data; new data is checked).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'parties_pan_format') then
    alter table public.parties add constraint parties_pan_format check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'parties_pincode_format') then
    alter table public.parties add constraint parties_pincode_format check (pincode is null or pincode ~ '^[1-9][0-9]{5}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_quantity_positive') then
    alter table public.invoices add constraint invoices_quantity_positive check (quantity is null or quantity > 0) not valid;
  end if;
end $$;

notify pgrst, 'reload schema';
