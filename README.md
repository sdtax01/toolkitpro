# Toolkit Pro (Shree Digitax Solutions)
Static multi-page accounting site + Supabase backend.

## Setup
1. Supabase > SQL Editor: paste and run `supabase/schema_all.sql` once (it contains schema.sql, schema_stage2.sql and schema_stage3.sql in order; run those three separately instead only if you prefer).
2. Put your Project URL and **anon** key at the top of `assets/app.js` (never commit the service-role key).
3. Server mail: `supabase functions deploy send-mail`, then
   `supabase secrets set SMTP_HOST=smtp.yourhost.com SMTP_PORT=465 SMTP_USER=accounts@shreedigitax.com SMTP_PASS=... MAIL_FROM="Shree Digitax <accounts@shreedigitax.com>"`
4. Host the repo root on GitHub Pages (Settings > Pages > main / root). Open the site, create your login, then fill in Settings.
5. Optional check: `cd tests && npm i jsdom && node linkage-test.js`

## Navigation (sidebar)
One nested sidebar for every page, defined in `NAV` in `assets/app.js` (styles at the end of `assets/app.css`). Groups: Sales, Purchases, Accounting, Tax & Compliance, Reports & Insights, Books of Accounts, Settings, plus a direct Dashboard link. The full menu-to-page map, the items that were left out because the feature does not exist, and the notes on shared pages are in `NAVIGATION_MAP.md`. No SQL is involved. Test: `node tests/nav.test.js`.

## Pages
- (The sidebar now groups these differently; see `NAVIGATION_MAP.md`.)
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

## Phase 3: Profit & Loss, Balance Sheet, Year-end review, Bank reconciliation

Run once in the Supabase SQL Editor (after Phases 0 to 2): `supabase/migrations/013_bank_reconciliation.sql`. Undo: `supabase/undo/013_bank_reconciliation_down.sql` (removes imported statement lines and saved reconciliations only).

- **Profit & Loss** (`profit-loss.html`), **Balance Sheet** (`balance-sheet.html`) and **Year-end Review** (`year-end.html`) read the ledger. They need no new SQL; they appear under Books.
- **Bank Reconciliation** (`bank-rec.html`) works on your Transactions. Import a bank CSV (Date, Description, Debit and Credit, or one Amount column), accept matches, record missing items, enter the statement balance, and save when the difference is zero. A bank account that has saved reconciliations cannot be deleted.
- Layout: Quick Summary removed from the sidebar, the header "+ Add Transaction" button removed, and fonts and sidebar width now scale between phone and large desktop.
- Tests: `node tests/phase3.test.js [ledger_dump.json]` and `tests/sql/phase3_test.sql`.

## Heads and sub-ledgers (Chart of Accounts)

Run once in the Supabase SQL Editor (after 010-012): `supabase/migrations/014_heads_subledgers.sql`. Undo: `supabase/undo/014_heads_subledgers_down.sql`.

- **Chart of Accounts:** every account (except Debtors, Creditors and bank accounts) has an "Add sub-account" button. The code is picked automatically (or type your own). Sub-accounts show indented under their head, and the parent row also shows its total with sub-accounts.
- **Invoices and bills:** a new "Income head" (sales) or "Expense head" (purchases) selector appears on the new and edit forms once at least one extra income/expense account exists. Leaving it on "(default)" posts to Sales / Purchases exactly as before. The chosen head is posted in the ledger, so it flows into the Trial Balance, Profit & Loss and Balance Sheet, which show names such as "Sales › Software sales". Changing the head later posts a reversal and a fresh entry, nothing is overwritten.
- **Dashboard:** the Income vs Expenses chart is now on an accrual basis (sales invoices and purchase bills by invoice date, excluding GST). The cards above it are unchanged.
- Tests: `tests/sql/heads_test.sql`.

## Phase 4 (audit fixes): stock, fixed assets, notes, TDS, GST set-off, statements
Everything here is optional and additive. Run in order in the Supabase SQL Editor, staging first, after a backup, and **after** 001-003, 010-012 and 014 (014 is needed by 018). Each has an undo script in `supabase/undo/` (undo 018 first, then 017, 016, 015; delete credit/debit notes and TDS entries in the app before undoing 018). Single owner login as before: there are no roles or approvals.
- `015_posting_controls.sql`: two switches on **Books > Ledger Setup** (both off by default). *Strict posting*: if the ledger cannot post, the invoice or payment is not saved either. *Protect documents*: sales invoices cannot be deleted (issue a credit note) and nothing with payments can be deleted.
- `016_accounts_gst_setoff.sql`: new built-in accounts (GST paid, Inventory, Advances, TDS receivable/payable, Fixed assets, Accumulated depreciation, Capital, Drawings, Change in inventories, Depreciation) and special Transaction categories: income *Advance received*, *Capital introduced*; expense *Advance paid*, *GST payment*, *TDS deposited*, *Drawings*. The existing category *Taxes* is unchanged. **GST & Taxes** page gets a *Post GST set-off* button (output GST cleared by input credit in the legal order, then by the GST you paid).
- `017_stock_fixed_assets.sql`: **Closing Stock** page (posts only the difference from the current Inventory balance) and **Fixed Assets** page (register, depreciation posted once per finished financial year, straight-line or written-down value at the life/rate you enter).
- `018_notes_tds_itc.sql`: **Credit / Debit Notes** (GST Sec 34 style, original invoice never edited), **TDS Entries** (receivable when a customer deducts, payable when you deduct), and a *ITC not allowed* tick on bills (GST becomes part of cost). Invoices get an `adjusted` amount (notes + TDS) that every balance, ageing and statement now subtracts.
- **Financial Statements** (`statements.html`, no SQL): Balance sheet in current / non-current layout with comparative, Statement of Profit and Loss, and an indirect Cash Flow Statement, all from the ledger.
- Front-end changes: GST rates now include 3% and 40% (12% and 28% remain for old documents); CGST and SGST are always equal (each half rounded to the paisa); intra/inter-state is decided by the GSTIN state codes when both GSTINs are valid, otherwise by State names as before; GSTIN gets a format and check-digit test that asks for confirmation but never blocks.
- Tests: `node tests/phase4.test.js [ledger_dump.json]`, `node tests/gst.test.js`, and `tests/sql/phase4a_test.sql`, `phase4b_test.sql`, `phase4c_test.sql`, `undo_test.sql`, `phase2_with_phase4_test.sql` (all installed together on top of the Phase 2 tests).
- Not covered yet (needs professional input or more design): HSN/SAC and line items, reverse charge, e-invoice/e-way bill, TDS/TCS rate engine and returns, income-tax block depreciation, asset disposal, accrual/prepaid/provision entries, expected credit loss, deferred and current tax, notes to accounts, GSTR-1/3B/2B files. Tax rates, section numbers and thresholds change: have your CA verify every statutory treatment.

## Unified Banking engine (migration 019)

- **Banking** (`banking.html`) is the single entry point for receipts, payments, bank/cash accounts and recent money movements. The old Income & Receipts and Expenses & Payments menu shortcuts are removed; their underlying Transactions data and page remain available for compatibility.
- Receipts: customer advances, receipts against sales invoices (partial receipts update invoice paid/outstanding), and other income including interest income, TDS refunds and custom categories.
- Payments: supplier advances, payments against purchase bills (partial payments update bill paid/outstanding), and other payments including interest, late fees/penalties and custom categories.
- Advance entries retain the selected customer/supplier on the transaction. The ledger posts customer advances to the customer-advance liability and supplier advances to the supplier-advance asset. TDS refunds reduce TDS receivable instead of being counted again as income.
- Apply `supabase/migrations/019_banking_engine.sql` **after migrations 010–018** to add the transaction party/reference fields and update ledger posting. Test on staging after a database backup. This migration is additive and does not replace invoice payment functions.


## Voice assistant (browser based)
A microphone button sits at the bottom right of every signed-in page. Tap it and speak, or type a command in the box. Works in Chrome and Edge (needs internet for speech recognition and a microphone permission). English (India) only for now.
- **Commands:** Record payment, Record receipt, Show (me) dashboard, Share ledger statement to customer / supplier (NAME), Open ledger / day book / trial balance / profit and loss / balance sheet / ageing / invoices / settings, Outstanding of (NAME), Help.
- **Record payment / receipt:** it lists the pending bills (vendor and bill wise) and asks. Say, for example: "Vendor Sharma Traders, bill number 245, amount 12,000, date 25 October 2026". Anything you leave out it asks for one item at a time ("full" = the whole pending amount). It then reads the entry back and **always waits for yes** (or the Confirm button) before posting. Posting uses the same `record_payment` database function as the bill page, so period lock, balance checks and ledger posting all apply. After posting it shows a green tick and says "Done. Anything else required?".
- **Statements:** finds the customer or supplier, shows the WhatsApp number saved on their page, and opens WhatsApp with the statement text (period, opening, billed, received, closing, pending bills). WhatsApp cannot be sent silently from a web page; you press Send in WhatsApp. Say "last month", "this month", "last financial year", "all" or "from 1 April to 30 June" to change the period (default: this financial year).
- **Voice settings:** Settings > Voice assistant (or the gear in the panel): voice, prefer male voice, pitch, speed, volume, default bank/cash account. They are saved per device, because every device has its own installed voices.
- **Files:** `assets/voice-core.js` (dialogue brain, no browser needed), `assets/voice.js` (microphone, speaker, panel, posting), loaded by `loadVoice()` in `assets/app.js`.
- **Tests:** `node tests/voice.test.js` (conversation tests, no install needed).
- **Hands-free wake word:** Settings > Voice assistant > "Hands-free: wake the assistant by voice" (off by default; saved per device). While the ERP page is open the browser listens only for the phrase (default "Hey Buddy", changeable). It then opens the panel and says "Yes, how may I help you?"; "Hey Buddy show me dashboard" in one breath also works. A green dot on the mic button shows it is armed. It cannot work when the page or browser is closed, the phone is locked, or the tab is in the background on mobile. The microphone stays on and Chrome's speech service processes the audio, so use it on your own device, not a shared one.

## Tax Invoice PDF and Statement PDF (migration 020)

- **Sales invoice page:** *Download PDF* and *Share PDF* create an A4 **Tax Invoice** (titled "Invoice" if your GSTIN is blank in Settings). It follows the Rule 46 (CGST Rules 2017) contents: supplier and recipient name, address, GSTIN, state and code, invoice number and date, place of supply, reverse charge, HSN/SAC, description, quantity, taxable value, CGST/SGST or IGST rate and amount, total, amount in words, bank details, terms, declaration and authorised-signatory box. Before creating it, the page lists anything missing and lets you continue or fix it first. It does **not** produce an e-invoice IRN/QR code: have your CA confirm whether your turnover requires one.
- **Statement page and the voice command "share ledger statement ...":** create an A4 ledger statement PDF (multi-page, header repeats). The voice command saves the PDF and shows a *Share PDF* button (the phone share sheet needs a tap); where the browser cannot share files, the PDF is saved and WhatsApp opens with the message so you can attach it.
- Every page carries the time it was generated (IST) at the bottom right. Font is Inter and colours are the app's own, from `assets/pdf.js`.
- **New fields:** Customers and Suppliers now hold registration type, GSTIN, PAN, address, city, PIN code and a state dropdown (with GST state codes). Settings holds your PAN, city, PIN, bank, UPI, signatory, terms and a default HSN/SAC. Sales invoices hold description, HSN/SAC, quantity, unit, place of supply and reverse charge.
- Run `supabase/migrations/020_invoice_pdf_fields.sql` once in the Supabase SQL Editor (staging first, after a backup; undo: `supabase/undo/020_invoice_pdf_fields_down.sql`). Until it is run, everything still saves exactly as before and the app tells you the new fields were not stored.
- New files: `assets/pdf.js`, `assets/gst-fields.js`, `assets/vendor/jspdf.umd.min.js` (jsPDF 2.5.2, MIT) and `assets/vendor/Inter-Regular.ttf`, `Inter-Bold.ttf` (Inter, SIL OFL, Latin subset). Test: `node tests/pdf.test.js`.

### Multi-line invoices (migration 021, run after 020)
- Run `supabase/migrations/020_invoice_pdf_fields.sql` first, then `021_invoice_items.sql` (Supabase SQL Editor, staging first, after a backup). Undo files are in `supabase/undo/`.
- Sales invoices can now have several lines, each with its own description, HSN/SAC, quantity, unit, rate, discount and GST rate. Tax is worked out per line; the invoice header carries the sum, so ledger, ageing, reports and notes are unchanged.
- Saving goes through the `save_sales_invoice` function, which checks that the lines add up to the header and replaces the lines atomically. Existing invoices can be edited (Edit button on the invoice page), subject to the period lock and the existing paid/adjusted rules.
- Without 021 the page still works with a single line as before; more than one line asks you to run 021.
- E-invoicing (IRN / QR) is not required for this business and is not produced. The earlier note about confirming this with a CA no longer applies.
- Test: `psql -f tests/sql/phase5_test.sql` in an empty database.

### Voice: partial party names
Saying only part of a name ("acme", "zenith") now finds the party if every word you said matches a distinctive word of its name. If several parties share that word, the assistant asks which one.
