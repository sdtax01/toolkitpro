# Upload to GitHub: Phase 4 audit fixes

Unzip `toolkitpro-main-phase4.zip` and upload the contents over your repository root (same folder names; GitHub web: Add file > Upload files, drag the folders, commit). Nothing needs deleting. Every page's script links now carry `?v=20261027` so browsers fetch the new JavaScript.

## Order of work after upload
1. Upload the files; GitHub Pages redeploys. The site works exactly as before (the new pages show an 'install migration' note until the SQL is run).
2. In Supabase SQL Editor (staging first, after a backup) run, in order: `015_posting_controls.sql`, `016_accounts_gst_setoff.sql`, `017_stock_fixed_assets.sql`, `018_notes_tds_itc.sql` from `supabase/migrations/` (needs 001-003, 010-012 and 014 already installed). Each can be skipped independently except 018, which needs 016.
3. Books > Ledger Setup: optionally tick Strict posting / Protect documents.

## New files (20)
- fixed-assets.html
- notes.html
- statements.html
- stock.html
- supabase/migrations/015_posting_controls.sql
- supabase/migrations/016_accounts_gst_setoff.sql
- supabase/migrations/017_stock_fixed_assets.sql
- supabase/migrations/018_notes_tds_itc.sql
- supabase/undo/015_posting_controls_down.sql
- supabase/undo/016_accounts_gst_setoff_down.sql
- supabase/undo/017_stock_fixed_assets_down.sql
- supabase/undo/018_notes_tds_itc_down.sql
- tds.html
- tests/gst.test.js
- tests/phase4.test.js
- tests/sql/phase2_with_phase4_test.sql
- tests/sql/phase4a_test.sql
- tests/sql/phase4b_test.sql
- tests/sql/phase4c_test.sql
- tests/sql/undo_test.sql

## Changed files (37)
- README.md
- ageing.html
- assets.html
- assets/app.js
- assets/reports-lib.js
- balance-sheet.html
- bank-rec.html
- banking.html
- budgets.html
- calendar.html
- coa.html
- customers.html
- daily.html
- daybook.html
- documents.html
- goals.html
- index.html
- invoice-new.html
- invoice.html
- invoices.html
- journal-new.html
- ledger-setup.html
- ledger.html
- overview.html
- party.html
- profit-loss.html
- reminders.html
- reports.html
- settings.html
- statement.html
- supabase/undo/012_ledger_down.sql
- taxes.html
- tests/browser-smoke.js
- tests/phase1.test.js
- transactions.html
- trial-balance.html
- year-end.html

## Behaviour changes to know about
- CGST and SGST are now always equal (each half of the rate rounded to the paisa). Before, an odd-paisa tax total was split unevenly (for example 2.50 / 2.51); the total can now differ from the old figure by one paisa on such invoices. Saved invoices are not recalculated.
- Intra/inter-state is decided by GSTIN state codes when both GSTINs are valid; otherwise by State names exactly as before.
- GST rate list adds 3% and 40%.
- Balances everywhere are amount minus paid minus credit notes/TDS (the extra part is 0 until migration 018 is installed).
- `supabase/undo/012_ledger_down.sql` now also removes the Phase 4 extras and the 014 invoice-head guard so the full ledger undo works with them installed.

## Not done (needs your CA or a further phase)
HSN/SAC and invoice line items, reverse charge, e-invoice/e-way bill, TDS/TCS rate and return engine, income-tax block depreciation, asset disposal, accruals/prepaids/provisions, expected credit loss, current and deferred tax, notes to accounts, GSTR file exports. Roles and maker-checker were intentionally left out (single-user, as you asked).
