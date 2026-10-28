/* Prode league site service worker (written by scripts/sites/build_league.py;
   PWA since 2026-10-28). The board is ONE page with its data inline, rebuilt
   hourly. A navigation takes the network when it answers within 3 s and the
   saved page otherwise, and every online visit refreshes the saved page, so no
   build stamp is needed and nothing is downloaded twice. Fonts, the flag font,
   the league logo and the icons are kept; the club crests on CloudFront are
   not (cross-origin opaque responses are padded in storage accounting). */
const SHELL = 'league-shell-v1';
const RUNTIME = 'league-runtime-v1';
const NAV_TIMEOUT_MS = 3000;
const EXTRAS = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
                'apple-touch-icon.png', 'logo.svg', 'TwemojiCountryFlags.woff2'];
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap';

function cacheable(res) {
  return !!res && (res.ok || res.type === 'opaque');
}

async function saveFonts() {
  try {
    const runtime = await caches.open(RUNTIME);
    const res = await fetch(FONTS_CSS);
    if (!res.ok) return;
    await runtime.put(FONTS_CSS, res.clone());
    const css = await res.text();
    const urls = Array.from(new Set((css.match(/url\((https:[^)]+)\)/g) || []).map((m) => m.slice(4, -1))));
    await Promise.all(urls.map((u) => runtime.add(u).catch(() => {})));
  } catch (e) { /* fonts are optional */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(['/']);                                    // the board itself: required
    await Promise.all(EXTRAS.map((u) => shell.add(u).catch(() => {})));   // the rest: best effort
    await saveFonts();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit && self.navigator && self.navigator.onLine === false) return hit;
  const refresh = fetch(req).then((res) => {
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await refresh) || Response.error();
}

async function navigation(req) {
  const shell = await caches.open(SHELL);
  if (self.navigator && self.navigator.onLine === false) {
    const saved = await shell.match('/');
    if (saved) return saved;
  }
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), NAV_TIMEOUT_MS)),
    ]);
    if (res && res.ok) {
      shell.put('/', res.clone());     // whatever query it was opened with
      return res;
    }
    throw new Error('status ' + (res && res.status));
  } catch (e) {
    return (await shell.match('/')) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') { event.respondWith(navigation(req)); return; }
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    event.respondWith((async () => {
      const shell = await caches.open(SHELL);
      return (await shell.match(req)) || staleWhileRevalidate(req, RUNTIME);
    })());
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, RUNTIME));
  }
  // the club crests, the analytics beacon and the other leagues: straight to the network
});
