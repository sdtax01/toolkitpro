-- Undo 020. Removes only the columns added by 020 (the text typed into them is lost). Invoices, parties and settings otherwise untouched.
alter table public.parties drop constraint if exists parties_pan_format, drop constraint if exists parties_pincode_format;
alter table public.invoices drop constraint if exists invoices_quantity_positive;
alter table public.parties  drop column if exists gst_type, drop column if exists pan, drop column if exists address, drop column if exists city, drop column if exists pincode;
alter table public.settings drop column if exists pan, drop column if exists city, drop column if exists pincode, drop column if exists bank_name, drop column if exists bank_account, drop column if exists bank_ifsc, drop column if exists upi_id, drop column if exists signatory, drop column if exists terms, drop column if exists default_hsn;
alter table public.invoices drop column if exists description, drop column if exists hsn_sac, drop column if exists quantity, drop column if exists unit, drop column if exists reverse_charge, drop column if exists place_of_supply;
notify pgrst, 'reload schema';
