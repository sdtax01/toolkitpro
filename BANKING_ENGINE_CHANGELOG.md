# Unified Banking Engine — change summary

## What changed

- `banking.html` is now the single entry point for recording receipts and payments, managing cash/bank accounts, and reviewing recent money movements.
- The Accounting sidebar no longer shows separate `Income & Receipts` and `Expenses & Payments` shortcuts. `Transactions` remains available for the full legacy transaction register, and `Bank Reconciliation` remains a separate tool.
- Invoice-linked receipts and bill-linked payments call the existing `record_payment` Supabase RPC first. This preserves the existing transaction + invoice `paid` update workflow and allows partial settlements.
- Customer and supplier advances store `party_id`; bank reference values store in `reference_no`.
- The new ledger posting function maps customer advances to the customer-advance liability, supplier advances to the supplier-advance asset, and TDS refunds against TDS receivable instead of income.
- Added a static regression test: `node tests/banking.test.js`.

## Entry mapping

| Banking entry | Transaction type | Category | Ledger effect when ledger migrations are installed |
|---|---|---|---|
| Advance from Customer | income | Advance received | Dr Bank/Cash; Cr Advances from Customers (party subledger) |
| Receipt against Sale Invoice | income | Sales | Dr Bank/Cash; Cr Debtors (invoice party subledger); updates invoice paid/outstanding |
| Interest Income | income | Interest Income | Dr Bank/Cash; Cr Interest Income |
| TDS Refund | income | TDS Refund | Dr Bank/Cash; Cr TDS Receivable |
| Other Income | income | User-entered category | Dr Bank/Cash; Cr corresponding income head |
| Advance Payment to Supplier | expense | Advance paid | Dr Advances to Suppliers (party subledger); Cr Bank/Cash |
| Payment Against Bills | expense | Purchases | Dr Creditors (bill party subledger); Cr Bank/Cash; updates bill paid/outstanding |
| Interest / Late Fees / Penalty / Others | expense | Selected category | Dr corresponding expense head; Cr Bank/Cash |

## Deployment steps

1. Back up the Supabase database and test in a staging project first.
2. Apply the existing migrations in their documented order, through `018_notes_tds_itc.sql`.
3. Apply `supabase/migrations/019_banking_engine.sql` in Supabase SQL Editor.
4. Upload the updated repository files to GitHub, preserving the existing repository root and `assets/` paths.
5. Test a partial customer receipt, partial supplier payment, both advance types, TDS refund, other income/expense, and bank reconciliation.
6. Confirm Trial Balance, General Ledger, Cash Book, customer/supplier statements, Profit & Loss, and Balance Sheet before production use.

## Validation performed

- `node tests/nav.test.js` — passed.
- `node tests/banking.test.js` — passed.
- `node tests/phase1.test.js` — passed (16 tests).
- `node tests/phase2.test.js` — passed (8 tests; real-database cross-check skipped because no dump was supplied).
- `node tests/phase3.test.js` — passed (45 tests).
- `node tests/phase4.test.js` — passed (34 tests).
- `node tests/gst.test.js` — passed (26 tests).
- Browser smoke test could not run because Playwright is not installed in this environment.
