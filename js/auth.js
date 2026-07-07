/* Password gate — single link for everyone; the password determines the view.
   The key is derived ONCE (PBKDF2-SHA256, shared salt) and matched against the
   edition index (tiny AES-GCM check blobs). Whichever edition the password
   opens (ALL / PU4 / PU5 / PU6 / DU3 / DU4), its payload is then fetched and
   decrypted with the same key. Wrong passwords open nothing. */
(function () {
  const gate = document.getElementById('gate');
  const form = document.getElementById('gate-form');
  const input = document.getElementById('gate-pass');
  const err = document.getElementById('gate-err');
  const btn = form.querySelector('button');
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  const loadScript = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('load ' + src));
    document.head.appendChild(s);
  });

  // small edition index loads up-front; the (larger) data file only after a match
  const indexReady = loadScript('js/data.index.enc.js?t=' + Date.now());

  async function deriveKey(password, saltB64, iter) {
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(saltB64), iterations: iter, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }

  async function tryUnlock(password, silent) {
    try {
      await indexReady;
    } catch (e) {
      err.textContent = 'โหลดข้อมูลไม่สำเร็จ — ลอง refresh หน้าใหม่';
      return;
    }
    try {
      const idx = window.DATA_INDEX;
      const key = await deriveKey(password, idx.salt, idx.iter);   // one KDF run
      let edition = null;
      for (const [ed, chk] of Object.entries(idx.editions)) {
        try {
          await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(chk.iv) }, key, b64(chk.ct));
          edition = ed; break;                                     // GCM tag verified → this password's edition
        } catch (e) { /* not this edition */ }
      }
      if (!edition) throw new Error('no-match');

      const dataFile = edition === 'ALL' ? 'js/data.enc.js' : 'js/data.' + edition + '.enc.js';
      await loadScript(dataFile + '?t=' + Date.now());             // data changes monthly — always fetch fresh
      const enc = window.DATA_ENC;                                 // same salt → same key decrypts the payload
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
      window.DATA = JSON.parse(new TextDecoder().decode(pt));

      sessionStorage.setItem('upc2_pass', password);
      gate.classList.add('hidden');
      window.initApp();
    } catch (e) {
      sessionStorage.removeItem('upc2_pass');
      if (!silent) {
        err.textContent = 'รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง';
        input.value = '';
        input.focus();
      }
      gate.classList.remove('hidden');
    }
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true; btn.textContent = '...';
    tryUnlock(input.value, false).finally(() => { btn.disabled = false; btn.textContent = 'เปิด Dashboard'; });
  });

  const saved = sessionStorage.getItem('upc2_pass');
  if (saved) tryUnlock(saved, true);
  else input.focus();
})();
