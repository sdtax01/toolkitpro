# Upload to GitHub: navigation restructuring (cache version 20261028)

**No SQL required for this navigation restructuring.** Do not run anything in Supabase for this release.

Unzip `toolkitpro-main-nav.zip` and upload the contents over your repository root (same folder names; GitHub web: Add file > Upload files, drag the folders and files, commit). Nothing needs deleting. Do not upload the zip itself.

## Steps
1. Unzip on your computer. You get one folder, `toolkitpro-main`; upload what is *inside* it so `index.html` and `assets/` sit at the repository root.
2. GitHub > your repository > Add file > Upload files. Drag in all files and folders. Choose "Commit directly to main".
3. Wait for GitHub Pages to redeploy (Settings > Pages shows the status, usually 1 to 2 minutes).
4. Open the site and press Ctrl+F5 (Cmd+Shift+R on Mac) once. Every page now loads `assets/app.js?v=20261028` and `assets/app.css?v=20261028`, so other devices fetch the new files by themselves.
5. Check: the sidebar shows Dashboard plus seven groups; open Sales > Customers and Purchases > Suppliers (the lists must differ); on a phone, the ☰ button opens the menu.

## Changed files (11 with real changes, 29 with only the cache version)
- `assets/app.js`: new `NAV` definition, active-item matching, collapsible groups, mobile drawer, scroll to `#section`. Supabase URL and anon key unchanged.
- `assets/app.css`: sidebar styles added at the end (existing rules untouched).
- `index.html`: Quick actions card; dashboard figures and charts unchanged.
- `notes.html`: optional `?kind=credit|debit` filter (list view only).
- `statement.html`: customer/supplier chooser when opened without `id`; the statement itself is unchanged.
- `reports.html`, `statements.html`, `ledger-setup.html`: `id` attributes on existing cards, so menu items can jump to them.
- `settings.html`: the same seven fields, now under two sub-headings (Company profile; Business & GST details); same Save. Email card gets an id.
- `tests/browser-smoke.js`: sidebar checks added. `tests/nav.test.js`: new.
- `README.md`, `UPLOAD_TO_GITHUB.md`, `NAVIGATION_MAP.md` (new): documentation.
- The other 29 pages only had `?v=20261027` changed to `?v=20261028` in their script/style links.

## Rolling back
Re-upload the files from `toolkitpro-main-phase4.zip`. Nothing in the database changes, so nothing needs undoing there.

---

# Earlier release: Phase 4 audit fixes (kept for reference)

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

## This update (series, import/export, reset)
1. Upload everything, including the new files: `import-export.html`, `assets/doc-series.js`, `assets/settings-tools.js`, `assets/import-core.js`, `assets/import-ui.js`, `supabase/migrations/022_series_import_reset.sql`, `supabase/undo/022_series_import_reset_down.sql`, and the `tests/` additions.
2. Changed files: `assets/app.js`, `assets/app.css`, `settings.html`, `invoice-new.html`, `notes.html`, `banking.html`, `transactions.html`, and the version number in every page.
3. Run migration 022 in the Supabase SQL editor (staging first).
4. Hard-refresh the browser (version 20261031).
