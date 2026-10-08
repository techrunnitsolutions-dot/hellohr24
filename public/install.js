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
  function ios() {
    if (standalone) return toast('You are already using the app');
    box('<h2>Install HelloHR on iPhone / iPad</h2><p class="muted" style="margin-top:0">Apple does not allow installing apps straight from a website, so add it to your home screen. It then opens full-screen like any other app.</p>' + IOS_STEPS);
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-app]'); if (!b) return; e.preventDefault(); (b.dataset.app === 'ios' ? ios : android)(); });
  // the app is for employees: hide the buttons on the admin / master logins and inside the installed app
  addEventListener('DOMContentLoaded', () => { const el = document.getElementById('appDownload'); if (el && (standalone || /^\/(admin|master)/.test(location.pathname))) el.remove(); });
})();
