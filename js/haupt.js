// Einstieg: App zeigen und den Service Worker anmelden (offline nutzbar, Benachrichtigungen).
import { starten } from './app.js';

starten(document.getElementById('app'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker', e));
