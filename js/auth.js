/* Password gate — decrypts js/data.enc.js (AES-256-GCM, PBKDF2-SHA256) in the browser. */
(function () {
  const enc = window.DATA_ENC;
  const gate = document.getElementById('gate');
  const form = document.getElementById('gate-form');
  const input = document.getElementById('gate-pass');
  const err = document.getElementById('gate-err');
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function decrypt(password) {
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  async function tryUnlock(password, silent) {
    try {
      const data = await decrypt(password);
      sessionStorage.setItem('upc2_pass', password);
      window.DATA = data;
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
    form.querySelector('button').textContent = '...';
    tryUnlock(input.value, false).finally(() => {
      form.querySelector('button').textContent = 'เปิด Dashboard';
    });
  });

  const saved = sessionStorage.getItem('upc2_pass');
  if (saved) tryUnlock(saved, true);
  else input.focus();
})();
