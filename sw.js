// Service Worker: speichert die App beim ersten Öffnen, danach startet sie auch ohne Netz.
// Die Messwerte (daten/pegel.json) kommen immer zuerst frisch aus dem Netz, nur ohne Netz aus dem Speicher.
// Dateiliste und VERSION schreibt werkzeuge/sw-bauen.py; jede Änderung an einer Datei ergibt eine neue Version.
const VERSION = 'f34967d5762c';
const KERN = ["./", "index.html", "manifest.webmanifest", "css/app.css", "js/app.js", "js/haupt.js", "js/import.js", "js/logik.js", "fonts/nunito_bold.ttf", "fonts/nunito_extrabold.ttf", "fonts/nunito_semibold.ttf", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/icon.svg", "icons/logo.svg", "vendor/preact-htm.js"];
const CACHE = 'hochwasser-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    await (await caches.open(CACHE)).addAll(KERN);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k.startsWith('hochwasser-')) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const pfad = e.request.mode === 'navigate' ? new URL('./index.html', self.registration.scope).href : url.href.split('#')[0].split('?')[0];
  if (url.pathname.includes('/daten/')) {
    // Daten: Netz zuerst, Speicher als Rückfall.
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const r = await fetch(e.request, { cache: 'no-store' });
        if (r.ok) c.put(pfad, r.clone());
        return r;
      } catch {
        return (await c.match(pfad)) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const treffer = await c.match(pfad);
    if (treffer) return treffer;
    const r = await fetch(e.request);
    if (r.ok && r.type === 'basic') c.put(pfad, r.clone());
    return r;
  })());
});

// Tippen auf eine Benachrichtigung öffnet die App.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (fenster.length) return fenster[0].focus();
    return self.clients.openWindow('./');
  })());
});
