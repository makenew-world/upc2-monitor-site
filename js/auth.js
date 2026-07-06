/* Password gate — loads the per-area encrypted payload (?area=PU4 etc.) and
   decrypts it in the browser (AES-256-GCM, PBKDF2-SHA256).
   Each area file is encrypted with its own password: a team's password
   cryptographically cannot open another team's data. */
(function () {
  const VALID = ['ALL', 'PU4', 'PU5', 'PU6', 'DU3', 'DU4'];
  const qs = new URLSearchParams(location.search);
  let area = (qs.get('area') || 'ALL').toUpperCase();
  if (!VALID.includes(area)) area = 'ALL';
  const dataFile = area === 'ALL' ? 'js/data.enc.js' : 'js/data.' + area + '.enc.js';
  const sessionKey = 'upc2_pass_' + area;

  const gate = document.getElementById('gate');
  const form = document.getElementById('gate-form');
  const input = document.getElementById('gate-pass');
  const err = document.getElementById('gate-err');
  const btn = form.querySelector('button');
  if (area !== 'ALL') document.getElementById('gate-sub').textContent = 'Area ' + area + ' — ใส่รหัสผ่านของทีม ' + area;
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  // load the (encrypted) data file for this area; the submit handler below is
  // live immediately and awaits this, so an early click never gets lost
  const ready = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = dataFile + '?t=' + Date.now();   // data changes monthly — always fetch fresh
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('load'));
    document.head.appendChild(script);
  });

  async function decrypt(password) {
    const enc = window.DATA_ENC;
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  async function tryUnlock(password, silent) {
    try {
      await ready;
    } catch (e) {
      err.textContent = 'โหลดข้อมูลไม่สำเร็จ — ตรวจสอบ link (?area=' + area + ')';
      return;
    }
    try {
      const data = await decrypt(password);
      sessionStorage.setItem(sessionKey, password);
      window.DATA = data;
      gate.classList.add('hidden');
      window.initApp();
    } catch (e) {
      sessionStorage.removeItem(sessionKey);
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

  const saved = sessionStorage.getItem(sessionKey);
  if (saved) tryUnlock(saved, true);
  else input.focus();
})();
