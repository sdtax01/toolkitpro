-- Undo for 023_practice_suite.sql. DELETES the client master, compliance tasks and recurring fee setups. Invoices already created are not touched.
drop table if exists public.recurring_invoices;
drop table if exists public.compliance_tasks;
drop table if exists public.client_master;
notify pgrst, 'reload schema';
