-- OPTIONAL 004 - stop silent data loss. Read before applying!
-- Effect: deleting a customer/supplier that still has invoices, or a bank account that still has
-- transactions, is REFUSED by the database instead of cascading / orphaning.
-- The current "Delete contact" button says "and all its invoices" and relies on cascade; after this
-- change it shows the database error instead. Apply only if you prefer protection over that shortcut.
begin;
alter table public.invoices drop constraint if exists invoices_party_id_fkey;
alter table public.invoices add constraint invoices_party_id_fkey foreign key (party_id) references public.parties(id) on delete restrict;
alter table public.transactions drop constraint if exists transactions_account_id_fkey;
alter table public.transactions add constraint transactions_account_id_fkey foreign key (account_id) references public.accounts(id) on delete restrict;
commit;
