begin;
alter table public.invoices drop constraint if exists invoices_party_id_fkey;
alter table public.invoices add constraint invoices_party_id_fkey foreign key (party_id) references public.parties(id) on delete cascade;
alter table public.transactions drop constraint if exists transactions_account_id_fkey;
alter table public.transactions add constraint transactions_account_id_fkey foreign key (account_id) references public.accounts(id) on delete set null;
commit;
