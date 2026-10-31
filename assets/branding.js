/* Toolkit Pro - business logo and UPI payment QR on the Settings page. Global: BR.
   The logo is shrunk in the browser and saved with the settings row (column logo_data, migration 025). The QR is drawn from the saved UPI ID.
   Invoices read both from the same settings row (assets/pdf.js). Nothing else in the app depends on this file. */
(function (root) {
'use strict';
const UPI_RE = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/;
const upiOk = s => UPI_RE.test(String(s || '').trim());
const MAX_IN = 8 * 1024 * 1024, MAX_OUT = 300 * 1024;

/* File -> Promise<data URL> (PNG or JPEG, at most 480 x 240 px, kept in proportion). */
function shrink(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Choose an image file.'));
    if (!/^image\//.test(file.type || '')) return reject(new Error('That file is not an image. Use PNG or JPG.'));
    if (file.size > MAX_IN) return reject(new Error('That image is larger than 8 MB. Use a smaller file.'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try {
        const sc = Math.min(1, 480 / img.naturalWidth, 240 / img.naturalHeight), w = Math.max(1, Math.round(img.naturalWidth * sc)), h = Math.max(1, Math.round(img.naturalHeight * sc));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d'), jpeg = /jpe?g/i.test(file.type);
        if (jpeg) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); }
        cx.drawImage(img, 0, 0, w, h);
        let out = cv.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9);
        if (out.length > MAX_OUT * 1.37) { const c2 = document.createElement('canvas'); c2.width = w; c2.height = h; const x2 = c2.getContext('2d'); x2.fillStyle = '#fff'; x2.fillRect(0, 0, w, h); x2.drawImage(img, 0, 0, w, h); out = c2.toDataURL('image/jpeg', 0.85); }
        URL.revokeObjectURL(url); resolve(out);
      } catch (e) { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image. Try a PNG or JPG.')); };
    img.src = url;
  });
}
/* QR as an inline SVG string, or '' when the library is missing */
function qrSvg(text, px) {
  if (!root.qrcode || !text) return '';
  const q = root.qrcode(0, 'M'); q.addData(text, 'Byte'); q.make(); const n = q.getModuleCount(), m = 4; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (n + 2 * m) + ' ' + (n + 2 * m) + '" width="' + px + '" height="' + px + '" role="img" aria-label="UPI payment QR code" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
const uriFor = (id, name) => 'upi://pay?pa=' + encodeURIComponent(String(id).trim()).replace(/%40/g, '@') + '&pn=' + encodeURIComponent(String(name || '').slice(0, 40) || 'Payee') + '&cu=INR';

/* Draws the card into el. S = settings row; save(patch) -> Promise<{error, dropped, lost}>; onLogo(dataUrlOrNull) lets the page update the sidebar. */
function mount(el, S, save, onLogo) {
  const esc_ = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const st = {logo: S.logo_data || '', upi: S.upi_id || '', name: S.business_name || '', msg: ''};
  const draw = () => {
    const logoSrc = st.logo && /^data:image\//.test(st.logo) ? st.logo : 'assets/logo.png';
    const qr = upiOk(st.upi) ? qrSvg(uriFor(st.upi, st.name), 150) : '';
    el.innerHTML = '<h3>Logo and payment QR</h3><div style="display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start">' +
      '<div style="min-width:240px;flex:1"><h4 class=fh style="margin-top:0">Business logo</h4><div style="background:#fff;border:1px solid #d5dbec;border-radius:10px;padding:10px;display:inline-block;max-width:100%"><img id=lgprev src="' + esc_(logoSrc) + '" alt="Current logo" style="display:block;max-width:240px;max-height:110px;object-fit:contain"></div>' +
      '<p class=k>Shown at the top of every invoice and statement and in the sidebar on every screen. ' + (st.logo ? 'This is your uploaded logo.' : 'No logo uploaded yet: the default logo is used.') + ' PNG or JPG; it is shrunk automatically.</p>' +
      '<div class=f2 style="flex-wrap:wrap"><label class=g style="display:inline-block;cursor:pointer;padding:8px 14px;border:1px solid #d5dbec;border-radius:8px">Upload logo<input type=file id=lgfile accept="image/png,image/jpeg,image/webp,image/gif" style="position:absolute;opacity:0;width:1px;height:1px"></label>' + (st.logo ? '<button type=button class=g id=lgrm>Remove logo</button>' : '') + '</div></div>' +
      '<div style="min-width:240px;flex:1"><h4 class=fh style="margin-top:0">UPI payment QR</h4>' + (qr ? '<div style="display:inline-block;border:1px solid #d5dbec;border-radius:10px;padding:8px;background:#fff">' + qr + '</div><p class=k><b>' + esc_(st.upi) + '</b><br>Printed on every sales invoice that still has a balance, with the amount and invoice number filled in, so the customer can scan and pay.</p>' : '<p class=k>' + (st.upi && !upiOk(st.upi) ? 'The saved UPI ID does not look right (it should look like name@bank). Correct it above and save.' : 'Enter your UPI ID in <i>Invoice &amp; PDF details</i> above and press <b>Save settings</b>. The QR code appears here and on your invoices.') + '</p>') + '</div></div>' +
      '<p role=alert class=k id=lgmsg style="color:#b42318">' + esc_(st.msg) + '</p>';
    const f = el.querySelector('#lgfile'), rm = el.querySelector('#lgrm');
    f.onchange = async () => { const file = f.files[0]; if (!file) return; st.msg = '';
      try { const data = await shrink(file), r = await save({logo_data: data}); if (r.error) throw r.error; if (r.dropped && (r.lost || []).length) throw new Error('The logo could not be saved because migration 025 has not been run in Supabase yet. Run supabase/migrations/025_branding.sql once, then try again.'); st.logo = data; if (onLogo) onLogo(data); toast('Logo saved'); } catch (e) { st.msg = e.message || String(e); }
      draw(); };
    if (rm) rm.onclick = async () => { const r = await save({logo_data: null}); if (r.error) { st.msg = r.error.message; } else { st.logo = ''; if (onLogo) onLogo(null); toast('Logo removed'); } draw(); };
  };
  draw();
  return {setUpi(id, name) { st.upi = id || ''; if (name != null) st.name = name; draw(); }};
}
root.BR = {upiOk, shrink, qrSvg, mount, UPI_RE};
if (typeof module !== 'undefined' && module.exports) module.exports = root.BR;
})(typeof window !== 'undefined' ? window : globalThis);
