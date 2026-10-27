-- Undo 017: removes the stock and fixed-asset registers and their functions. Journals already posted stay in the ledger (reverse them from Journal Entry first if you want them gone).
drop function if exists public.void_fixed_asset(uuid, text, date);
drop function if exists public.post_depreciation(date);
drop function if exists public.preview_depreciation(date);
drop function if exists public.tp_fa_dep_calc(uuid, date);
drop function if exists public.add_fixed_asset(text, text, date, numeric, numeric, text, numeric, numeric, uuid, text, date, numeric, date);
drop function if exists public.set_closing_stock(date, numeric, text, text);
drop table if exists public.fixed_asset_dep;
drop table if exists public.fixed_assets;
drop table if exists public.stock_valuations;
drop function if exists public.tp_fa_immutable();
drop function if exists public.tp_fy_start(date);
