/* Run: node tests/pdf.test.js [outDir]   (writes sample PDFs to outDir when given; needs no install) */
const fs = require('fs'), path = require('path'), A = path.join(__dirname, '..', 'assets');
const {jsPDF} = require(path.join(A, 'vendor', 'jspdf.umd.min.js'));
const GF = require(path.join(A, 'gst-fields.js')), PDF = require(path.join(A, 'pdf.js'));
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const env = {JsPDF: jsPDF, fonts: {regular: fs.readFileSync(path.join(A, 'vendor', 'Inter-Regular.ttf')).toString('base64'), bold: fs.readFileSync(path.join(A, 'vendor', 'Inter-Bold.ttf')).toString('base64')}, logo: 'data:image/png;base64,' + fs.readFileSync(path.join(A, 'logo.png')).toString('base64'), now: new Date('2026-10-29T02:03:00Z')};
const out = process.argv[2];

/* words and money */
ok(PDF.inrWords(0.5) === 'Rupees Zero and Fifty Paise Only', 'words: fifty paise');
ok(PDF.inrWords(123456.5) === 'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only', 'words: lakh style');
ok(PDF.inrWords(10000000) === 'Rupees One Crore Only', 'words: one crore');
ok(PDF.inrWords(11800) === 'Rupees Eleven Thousand Eight Hundred Only', 'words: 11800');
ok(PDF.fmt(1234567.8) === '12,34,567.80' && PDF.fmt(999) === '999.00' && PDF.fmt(100000) === '1,00,000.00', 'Indian digit grouping');
ok(PDF.stampOf(new Date('2026-10-29T02:03:00Z')) === '29 Oct 2026, 07:33 PM'.replace('PM', 'AM') + ' IST', 'timestamp in IST (' + PDF.stampOf(new Date('2026-10-29T02:03:00Z')) + ')');
/* state codes */
ok(GF.stateCodeByName('maharashtra') === '27' && GF.stateCodeByName('Jammu and Kashmir') === '01' && GF.stateCodeByName('Orissa') === '21', 'state name to code');
ok(GF.stateCodeOf('27AAAAA0000A1Z5', 'Gujarat') === '27', 'GSTIN state code wins over typed state');
ok(GF.panOf('27ABCDE1234F1Z5') === 'ABCDE1234F', 'PAN from GSTIN');
ok(GF.colErr({code: 'PGRST204', message: "Could not find the 'pan' column of 'parties' in the schema cache"}) && !GF.colErr({message: 'duplicate key'}), 'column-missing error detection');

const CHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', mk = b => { let t = 0; for (let i = 0; i < 14; i++) { const v = CHS.indexOf(b[i]) * (i % 2 ? 2 : 1); t += Math.floor(v / 36) + v % 36; } return b + CHS[(36 - t % 36) % 36]; };
const S = {business_name: 'Shree Digitax Solutions', gstin: mk('27ABCDE1234F1Z'), state: 'Maharashtra', address: 'Office 4, Sairaj Complex, Shivaji Nagar', city: 'Pune', pincode: '411005', phone: '+91 98765 43210', email: 'accounts@shreedigitax.com', bank_name: 'HDFC Bank, Shivaji Nagar', bank_account: '50200012345678', bank_ifsc: 'HDFC0000123', upi_id: 'shreedigitax@hdfcbank', signatory: 'Raj', terms: '1. Payment due within 15 days.\n2. Interest at 18% p.a. on delayed payment.\n3. Subject to Pune jurisdiction.'};
const P = {id: 'p1', name: 'Acme Industries Pvt Ltd', kind: 'client', gstin: mk('29AABCA1234C1Z'), state: 'Karnataka', address: '12, MG Road, Indiranagar', city: 'Bengaluru', pincode: '560038', gst_type: 'regular'};
const inter = {number: 'INV-0042', date: '2026-10-28', due_date: '2026-11-12', taxable: 100000, gst_rate: 18, cgst: 0, sgst: 0, igst: 18000, amount: 118000, paid: 40000, adjusted: 0, hsn_sac: '998231', description: 'GST return filing and compliance advisory services for FY 2025-26 (monthly retainer, October 2026)', quantity: 1, unit: 'Nos'};
const intra = {...inter, number: 'INV-0043', igst: 0, cgst: 9000, sgst: 9000, paid: 0};
const P2 = {...P, state: 'Maharashtra', gstin: mk('27AABCA1234C1Z')};

const chk = PDF.invoiceChecks(S, P, inter);
ok(chk.errors.length === 0 && chk.warnings.length === 0, 'complete invoice has no warnings (' + chk.warnings.join('; ') + ')');
const bad = PDF.invoiceChecks({}, {name: 'X', kind: 'client'}, {number: 'THIS-IS-A-VERY-LONG-INVOICE-NO', taxable: null});
ok(bad.errors.length === 1 && bad.warnings.some(w => /16 characters/.test(w)) && bad.warnings.some(w => /HSN/.test(w)) && bad.warnings.some(w => /address/i.test(w)), 'incomplete invoice reports errors and warnings');

const pages = d => d.getNumberOfPages();
const di = PDF.buildInvoice(env, {S, P, x: inter}), da = PDF.buildInvoice(env, {S, P: P2, x: intra});
ok(pages(di) === 1 && pages(da) === 1, 'invoice fits one A4 page');
const sz = di.internal.pageSize; ok(Math.abs(sz.getWidth() - 210) < .01 && Math.abs(sz.getHeight() - 297) < .01, 'page is A4 (210 x 297 mm)');
const noGst = PDF.buildInvoice(env, {S: {...S, gstin: ''}, P, x: inter}); ok(pages(noGst) === 1, 'invoice without supplier GSTIN still builds (titled Invoice)');

/* statement, many rows -> several pages */
const rows = Array.from({length: 70}, (_, i) => ({date: '2026-0' + (4 + i % 6) + '-' + String(1 + i % 27).padStart(2, '0'), type: i % 3 ? 'Invoice' : 'Payment', ref: i % 9 === 0 ? 'INV-' + (100 + i) + ' with a rather long reference note that needs to wrap onto a second line' : 'INV-' + (100 + i), billed: i % 3 ? 1000 + i : 0, paid: i % 3 ? 0 : 500, balance: 1000 * i}));
const st = {opening: 2500, billed: 90000, paid: 30000, closing: 62500, rows};
const ds = PDF.buildStatement(env, {S, P, st, from: '2026-04-01', to: '2026-10-29', today: '2026-10-29'});
ok(pages(ds) >= 2, 'long statement paginates (' + pages(ds) + ' pages)');
const empty = PDF.buildStatement(env, {S, P: {...P, kind: 'supplier'}, st: {opening: 0, billed: 0, paid: 0, closing: 0, rows: []}, from: '', to: '2026-10-29', today: '2026-10-29'}); ok(pages(empty) === 1, 'empty supplier statement builds');
const bytes = Buffer.from(di.output('arraybuffer')); ok(bytes.slice(0, 5).toString() === '%PDF-' && bytes.length < 250000, 'valid PDF, size ' + bytes.length + ' bytes');
if (out) { fs.mkdirSync(out, {recursive: true}); fs.writeFileSync(path.join(out, 'invoice-inter.pdf'), bytes); fs.writeFileSync(path.join(out, 'invoice-intra.pdf'), Buffer.from(da.output('arraybuffer'))); fs.writeFileSync(path.join(out, 'statement.pdf'), Buffer.from(ds.output('arraybuffer'))); fs.writeFileSync(path.join(out, 'invoice-nogst.pdf'), Buffer.from(noGst.output('arraybuffer'))); }
console.log(fail ? fail + ' check(s) failed' : 'All PDF checks passed'); process.exit(fail ? 1 : 0);
