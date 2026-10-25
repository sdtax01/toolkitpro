# Toolkit Pro (Shree Digitax Solutions)
Static multi-page accounting site + Supabase backend.

## Setup
1. Supabase > SQL Editor: paste and run `supabase/schema_all.sql` once (it contains schema.sql, schema_stage2.sql and schema_stage3.sql in order; run those three separately instead only if you prefer).
2. Put your Project URL and **anon** key at the top of `assets/app.js` (never commit the service-role key).
3. Server mail: `supabase functions deploy send-mail`, then
   `supabase secrets set SMTP_HOST=smtp.yourhost.com SMTP_PORT=465 SMTP_USER=accounts@shreedigitax.com SMTP_PASS=... MAIL_FROM="Shree Digitax <accounts@shreedigitax.com>"`
4. Host the repo root on GitHub Pages (Settings > Pages > main / root). Open the site, create your login, then fill in Settings.
5. Optional check: `cd tests && npm i jsdom && node linkage-test.js`

## Pages
- Sales: `customers.html?kind=client` (list) > `party.html` (profile) > `invoices.html?kind=sale` (list with status tabs) > `invoice-new.html` (form) > `invoice.html` (detail, payments, email, print)
- Purchases: same pages with `kind=supplier` / `kind=purchase` (Suppliers and Bills)
- Accounting: transactions, banking, assets, budgets, goals. Compliance: taxes, documents, calendar, reminders. Insights: reports, overview, dashboard. Settings.
- Update note: `parties.html` was replaced by `customers.html` + `party.html`; delete the old file from your repo.

## Update notes
- Edit buttons added for customers/suppliers, invoices/bills, transactions (linked receipts keep invoice balances in sync), accounts, assets, budgets, goals, reminders and documents.
- Layout is width-capped and charts sit in fixed-height boxes, so the dashboard looks the same at any browser zoom.

## Phase 0 (database safety) and Phase 1 (debtors/creditors reports)
Nothing here is required for the app to keep working: the app uses the new database functions only if they exist.
- `supabase/migrations/`: run **in order**, in Supabase > SQL Editor, on a staging project first, after a backup.
  `000_diagnostics.sql` (read-only; every query should return zero rows) -> `001_constraints.sql` -> `002_payment_functions.sql` -> `003_audit.sql`.
  Each has an undo script in `supabase/undo/` (kept out of `migrations/` so it can never run by accident). `migrations/optional/` (004 stricter deletes, 005 two-decimal money columns) are optional; read the comment at the top of each first.
- New pages: `daily.html` (Daily Summary), `ageing.html?kind=sale|purchase` (Debtors / Creditors Ageing, CSV export, bulk email reminders), `statement.html?id=...` (party statement).
  Also linked from the Customer/Supplier page ("Statement"). They only read existing data.
- Tests: `node tests/phase1.test.js` (no install needed); `tests/sql/phase0_test.sql` (needs a local Postgres, see the comments in `tests/sql/supabase_mock.sql`); `tests/browser-smoke.js` (needs Playwright).

## Phase 2 (double-entry ledger)
Optional and switched off until you press a button. Run in order after Phase 0, on staging first, after a backup:
`supabase/migrations/010_ledger_core.sql` -> `011_ledger_posting.sql` -> `012_ledger_functions.sql`. Undo everything: `supabase/undo/012_ledger_down.sql` (removes the ledger only; invoices, transactions and parties are untouched).
Then open **Books > Ledger Setup** and press *Set up ledger*. It builds the chart of accounts and posts balanced journals for all existing invoices, payments, transactions and bank opening balances.
- After setup every invoice, bill, payment and transaction posts automatically. Editing or deleting one posts a reversal plus a new entry; posted journals can never be edited or deleted.
- Screens: Trial Balance, General Ledger, Cash Book, Day Book, Journal Entry (manual, with reversal), Chart of Accounts, Ledger Setup (period lock, reconciliation, sync check).
- Period lock stops adding, editing or deleting anything dated on or before the locked date.
- Tests: `tests/sql/phase2_test.sql` (`psql -v with_p0=1 -v dump=/tmp/ledger_dump.json -f ...`), `node tests/phase2.test.js /tmp/ledger_dump.json`.
- Known limits: manual journals cannot touch Debtors/Creditors (use invoices and payments); invoices without a GST breakup post their whole amount to Sales; ledger text for a renamed party updates only when that party's invoices are next edited.
