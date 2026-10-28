# Toolkit Pro: sidebar map

The sidebar is defined once, in the `NAV` array in `assets/app.js`, and drawn by `boot()` on every page. Nothing else contains menu markup. Edit the array to add, rename or move an item; `node tests/nav.test.js` then checks that every link still points at a real page.

Behaviour: the active page is highlighted and its group opens automatically; other groups remember whether you opened them (browser localStorage, per device); below 900 px wide the menu becomes a drawer (☰ button, tap outside or press Esc to close). Detail pages highlight their parent: `party.html` > Customers/Suppliers, `invoice.html` and `invoice-new.html` > Sales Invoices/Purchase Bills, `statement.html?id=…` > Customer/Supplier Statements.

Items with a `#section` jump to a card on an existing page. They are views of the same data, not separate copies.

## Menu to page

| Group | Menu item | Page |
|---|---|---|
| | Dashboard | `index.html` |
| **Sales** | Customers | `customers.html?kind=client` |
| | Sales Invoices | `invoices.html?kind=sale` |
| | Credit Notes | `notes.html?kind=credit` (credit notes only; same page as Tax & Compliance) |
| | Debtors Ageing | `ageing.html?kind=sale` |
| | Customer Statements | `statement.html?kind=client` (customer chooser; then `statement.html?id=…&kind=client`) |
| **Purchases** | Suppliers | `customers.html?kind=supplier` |
| | Purchase Bills | `invoices.html?kind=purchase` |
| | Debit Notes | `notes.html?kind=debit` (debit notes only) |
| | Creditors Ageing | `ageing.html?kind=purchase` |
| | Supplier Statements | `statement.html?kind=supplier` |
| **Accounting** | Transactions | `transactions.html` |
| | Income & Receipts | `transactions.html?type=income` |
| | Expenses & Payments | `transactions.html?type=expense` |
| | Banking | `banking.html` |
| | Bank Reconciliation | `bank-rec.html` |
| | Closing Stock | `stock.html` |
| | Fixed Assets | `fixed-assets.html` |
| | Other Assets | `assets.html` |
| | Budgets | `budgets.html` |
| | Financial Goals | `goals.html` |
| **Tax & Compliance** | GST & Taxes | `taxes.html` |
| | Credit / Debit Notes | `notes.html` (all notes) |
| | TDS Entries | `tds.html` |
| | Documents & Uploads | `documents.html` |
| | Compliance Calendar | `calendar.html` |
| | Reminders | `reminders.html` |
| **Reports & Insights** | Reports Dashboard | `reports.html` |
| | Income & Expense Analysis | `reports.html#income-expense` |
| | Receivables & Payables | `reports.html#receivables-payables` |
| | Monthly / Financial Year Analysis | `reports.html#monthly` |
| | Business Overview | `overview.html` |
| | Daily Summary | `daily.html` |
| **Books of Accounts** | Trial Balance | `trial-balance.html` |
| | General Ledger | `ledger.html` |
| | Cash Book | `ledger.html?book=cash` |
| | Day Book | `daybook.html` |
| | Journal Entry (Manual Posting) | `journal-new.html` |
| | Profit & Loss | `profit-loss.html` |
| | Balance Sheet | `balance-sheet.html` |
| | Financial Statements (Schedule III) | `statements.html` |
| | - Balance Sheet | `statements.html#sch-bs` |
| | - Statement of Profit and Loss | `statements.html#sch-pl` |
| | - Cash Flow Statement | `statements.html#sch-cf` |
| | Year-end Review | `year-end.html` |
| | Chart of Accounts | `coa.html` |
| | Ledger Setup | `ledger-setup.html` |
| **Settings** | Company Profile | `settings.html#company` |
| | Business & GST Details | `settings.html#gst` |
| | Application Settings | `settings.html#app` (email test) |

## Requested items that are not in the menu, and why

| Requested | Status |
|---|---|
| Financial Year & Reporting Preferences | Not built. The financial year is fixed April to March in code and every report has its own date pickers; there is no stored preference to edit. Left out rather than linking to something else. |
| Document Preferences | Not built. Invoice and bill numbers (INV-, BILL-, CN-, DN-) are generated automatically and there is no template or numbering setting. |
| Default Accounts (part of "Default Accounts & Ledger Preferences") | Not built as a setting. The built-in ledger accounts are fixed by migrations 010-018 and the income/expense head is chosen per invoice. The menu item is therefore named **Ledger Preferences** and opens the period lock and safety switches. |
| Application Settings (full) | Only the email test exists today. The menu item opens it. |

## Things you should know

- **Same page, several doors.** Credit Notes (Sales), Debit Notes (Purchases) and Credit / Debit Notes (Tax) all use `notes.html`. The first two are filtered views (`?kind=credit|debit`); there is one set of records. The Balance Sheet and Statement of Profit and Loss also exist twice on purpose: the Books pages are account-wise, the Schedule III pages are the statutory layout.
- **"Schedule III"** is the label you asked for. The page uses a current / non-current layout with comparatives, but has no notes to accounts (see the README "not covered" list). Have your CA confirm it before it is used as a statutory statement.
- **Record Receipt / Record Payment** on the Dashboard open the invoice or bill list, because a receipt recorded on the invoice page keeps that invoice's balance in step. For income or payments that belong to no invoice use Add Transaction.
- **Other Assets** (`assets.html`) still offers a "Fixed Assets" category next to the Fixed Assets register (`fixed-assets.html`). They are separate stores (the first feeds the Dashboard portfolio chart, the second the ledger). This release does not change that; avoid entering the same asset in both.
- **Genuinely new behaviour** (all read-only, no database change): the customer/supplier chooser on `statement.html` when opened without an id; the `?kind=credit|debit` filter on `notes.html`; section ids on four pages; sub-headings in the Settings form (same fields, same Save); the Dashboard "Quick actions" card.
