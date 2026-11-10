// Einstieg: App zeigen und den Service Worker anmelden (offline nutzbar, Benachrichtigungen).
import { starten } from './app.js';

starten(document.getElementById('app'));
if ('serviceWorker' in navigator) {
  // Neue Fassung: einmal neu laden, sobald der neue Service Worker übernimmt (nicht beim allerersten Öffnen).
  const hatteAlten = !!navigator.serviceWorker.controller;
  let neuGeladen = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hatteAlten && !neuGeladen) { neuGeladen = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => setInterval(() => reg.update().catch(() => {}), 30 * 60_000))
    .catch((e) => console.warn('Service Worker', e));
}
