-- Undo 002 (the app automatically falls back to its previous behaviour)
drop function if exists public.record_payment(uuid, numeric, date, uuid, text);
drop function if exists public.delete_payment(uuid);
