-- Undo 003 (WARNING: deletes the audit history. Export audit_log first if you want to keep it.)
do $$ declare t text; begin
  foreach t in array array['invoices','transactions','parties','accounts'] loop
    execute format('drop trigger if exists tp_touch on public.%I', t);
    execute format('drop trigger if exists tp_audit on public.%I', t);
    execute format('alter table public.%I drop column if exists updated_at', t);
  end loop; end $$;
drop function if exists public.tp_touch();
drop function if exists public.tp_audit();
drop table if exists public.audit_log;
