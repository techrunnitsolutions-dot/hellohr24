// "Get the app" buttons on the login page: Android (APK, or install to home screen) and iOS (add to home screen).
(function () {
  let deferred = null;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
  addEventListener('appinstalled', () => { deferred = null; toast('HelloHR is installed on your phone ✓'); });
  const toast = m => { const t = document.getElementById('toast'); if (!t) return; t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3500); };
  const box = html => {
    const o = document.createElement('div'); o.className = 'appmodal'; o.innerHTML = '<div class="appmodal-card">' + html + '<div class="actions"><button class="btn primary" type="button">Got it</button></div></div>';
    o.addEventListener('click', e => { if (e.target === o || e.target.tagName === 'BUTTON') o.remove(); }); document.body.appendChild(o);
  };
  const ask = (title, html, go) => {
    const o = document.createElement('div'); o.className = 'appmodal'; o.innerHTML = '<div class="appmodal-card"><h2>' + title + '</h2>' + html + '<div class="actions" style="gap:8px"><button class="btn" type="button" data-x="no">Cancel</button><button class="btn primary" type="button" data-x="yes">Allow download</button></div></div>';
    o.addEventListener('click', e => { const x = e.target.dataset && e.target.dataset.x; if (e.target === o || x) { o.remove(); if (x === 'yes') go(); } }); document.body.appendChild(o);
  };
  const ANDROID_STEPS = '<ol><li>Open this page in <b>Chrome</b> on your phone.</li><li>Tap the <b>⋮</b> menu (top right).</li><li>Tap <b>Install app</b> (or <b>Add to Home screen</b>).</li><li>Open <b>HelloHR</b> from your home screen and sign in with your Employee ID.</li></ol>';
  const IOS_STEPS = '<ol><li>Open this page in <b>Safari</b> on your iPhone or iPad.</li><li>Tap the <b>Share</b> button (square with an arrow pointing up).</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Open <b>HelloHR</b> from your home screen and sign in.</li></ol>';
  async function android() {
    if (standalone) return toast('You are already using the app');
    try {
      const r = await fetch('/downloads/hellohr.apk', { method: 'HEAD', cache: 'no-store' });
      if (r.ok && !/text\/html/.test(r.headers.get('content-type') || '')) {
        return ask('Download the HelloHR app?', '<p class="muted" style="margin-top:0">HelloHR for Android (about ' + Math.round((+r.headers.get('content-length') || 0) / 1e6) + ' MB). When it finishes, open the file to install it. If Android asks, allow <b>Install unknown apps</b> for your browser.</p>', () => {
          const a = document.createElement('a'); a.href = '/downloads/hellohr.apk'; a.download = 'HelloHR.apk'; document.body.appendChild(a); a.click(); a.remove(); toast('Downloading HelloHR…');
        });
      }
    } catch (e) { /* no APK published: fall through to home-screen install */ }
    if (deferred) { deferred.prompt(); const c = await deferred.userChoice.catch(() => ({})); deferred = null; if (c.outcome === 'accepted') toast('Installing HelloHR…'); return; }
    box('<h2>Install HelloHR on Android</h2>' + ANDROID_STEPS);
  }
  // iOS: Apple gives websites no way to add themselves, so show a short picture guide with an arrow pointing at Safari's Share button
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 002 2h10a2 2 0 002-2v-8"/></svg>';
  const PLUS_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
  function ios() {
    if (standalone) return toast('You are already using the app');
    const ua = navigator.userAgent, ipad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1), safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Line/.test(ua), iphoneOrIpad = /iPhone|iPod/.test(ua) || ipad;
    const o = document.createElement('div'); o.className = 'appmodal ios-guide';
    const step = (n, ic, t) => '<div class="gstep"><span class="gnum">' + n + '</span><span class="gic">' + ic + '</span><span class="gtx">' + t + '</span></div>';
    o.innerHTML = '<div class="appmodal-card"><h2 style="margin-top:0">Add HelloHR to your home screen</h2>'
      + (!iphoneOrIpad ? '<p class="muted">Open this page on your iPhone or iPad to add the app icon. Send yourself this link: <b>' + location.origin + '</b></p>' : '')
      + (iphoneOrIpad && !safari ? '<div class="gwarn">For the best result open this page in <b>Safari</b>. <button class="btn sm" type="button" data-x="copy">Copy link</button></div>' : '')
      + '<div class="gsteps">' + step(1, SHARE_ICON, 'Tap the <b>Share</b> button ' + (ipad ? 'at the top of Safari' : 'at the bottom of Safari') + '.')
      + step(2, PLUS_ICON, 'Scroll down and tap <b>Add to Home Screen</b>.') + step(3, '<b style="color:#2563eb">Add</b>', 'Tap <b>Add</b> (top right). The HelloHR icon now sits on your home screen.') + '</div>'
      + '<div class="actions" style="gap:8px"><button class="btn primary" type="button" data-x="ok">Got it</button></div></div>'
      + (iphoneOrIpad ? '<div class="garrow ' + (ipad ? 'top' : 'bottom') + '" aria-hidden="true">Tap Share <span>' + (ipad ? '↗' : '↓') + '</span></div>' : '');
    o.addEventListener('click', e => { const x = e.target.dataset && e.target.dataset.x;
      if (x === 'copy') { (navigator.clipboard ? navigator.clipboard.writeText(location.origin) : Promise.reject()).then(() => toast('Link copied. Paste it in Safari.'), () => toast(location.origin)); return; }
      if (e.target === o || x === 'ok') o.remove(); });
    document.body.appendChild(o);
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-app]'); if (!b) return; e.preventDefault(); (b.dataset.app === 'ios' ? ios : android)(); });
  // the app is for employees: hide the buttons on the admin / master logins and inside the installed app
  addEventListener('DOMContentLoaded', () => { const el = document.getElementById('appDownload'); if (el && (standalone || /^\/(admin|master)/.test(location.pathname))) el.remove(); });
})();
