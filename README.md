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
