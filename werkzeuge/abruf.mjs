// Zentraler Abruf: holt neue Pegelwerte aus allen aktiven Quellen in daten/messstellen.json und schreibt
// daten/pegel.json (letzte 30 Tage). Läuft im geplanten Ablauf (.github/workflows/seite.yml) alle 15 Minuten.
// Aufruf: node werkzeuge/abruf.mjs   Umgebung: SEITE_URL (bisherige Werte von der Seite), dazu die Geheimnisse
// der Quellen (z. B. TTN_API_KEY, INNO_LIVE_TOKEN). Schlüssel stehen nie in Dateien des Repos.
import { readFile, writeFile } from 'node:fs/promises';
import * as I from '../js/import.js';
import { normalisieren } from '../js/logik.js';

const wurzel = new URL('../', import.meta.url);
const lesenJson = async (p) => JSON.parse(await readFile(new URL(p, wurzel), 'utf8'));

/** Ortszeit Deutschland (wie auf der HND-Seite) in Millisekunden UTC. */
export function berlinZeit(j, mo, t, h, mi) {
  const geraten = Date.UTC(j, mo - 1, t, h, mi);
  const teile = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(geraten)).reduce((a, p) => ({ ...a, [p.type]: +p.value }), {});
  const alsBerlin = Date.UTC(teile.year, teile.month - 1, teile.day, teile.hour, teile.minute);
  return geraten - (alsBerlin - geraten);
}

/** Pegel-Übersicht des HND: je Pegel ein <img id="p<Nr>" data-wert=… data-datum=…>. */
export function hndLesen(htmlText, nr) {
  const tag = htmlText.match(new RegExp(`<img[^>]*\\bid="p${nr}"[^>]*>`, 'i'))?.[0];
  if (!tag) return null;
  const attr = (n) => tag.match(new RegExp(`\\b${n}="([^"]*)"`, 'i'))?.[1] ?? '';
  const cm = I.zahl(attr('data-wert'));
  const d = attr('data-datum').match(/(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s*(\d{1,2}):(\d{2})/);
  if (cm == null || !d) return null;
  return { zeit: berlinZeit(+d[3], +d[2], +d[1], +d[4], +d[5]), cm, stufe: I.zahl(attr('data-ms')) };
}

async function holen(url, kopf = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Hochwasser-Web-App (GitHub Actions)', ...kopf } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function quelleAbrufen(q, stellen, seit) {
  if (q.art === 'hnd') {
    const w = hndLesen(await holen('https://www.hnd.bayern.de/pegel'), q.pegelNr);
    if (!w) throw new Error(`HND: Pegel ${q.pegelNr} nicht gefunden`);
    return { [q.messstelle]: [{ zeit: w.zeit, cm: w.cm }] };
  }
  const geheim = q.geheimnis ? process.env[q.geheimnis] : undefined;
  if (q.geheimnis && !geheim) throw new Error(`Geheimnis ${q.geheimnis} fehlt`);
  let text;
  if (q.art === 'ttn') {
    // TTN Storage Integration: Meldungen seit dem letzten Abruf, eine JSON-Zeile je Meldung.
    const nach = new Date(seit).toISOString();
    text = await holen(`https://${q.region || 'eu1'}.cloud.thethings.network/api/v3/as/applications/${encodeURIComponent(q.app)}/packages/storage/uplink_message?after=${nach}&limit=1000`,
      { Authorization: `Bearer ${geheim}`, Accept: 'text/event-stream' });
  } else if (q.art === 'url') {
    text = await holen(q.url.replace('{seit}', encodeURIComponent(new Date(seit).toISOString())), geheim ? { [q.kopf || 'Authorization']: (q.praefix ?? 'Bearer ') + geheim } : {});
  } else {
    throw new Error(`Unbekannte Art ${q.art}`);
  }
  const z = I.zuordnen(I.lesen(text), stellen);
  if (z.unbekannt.length) console.log(`  unbekannte Geräte: ${z.unbekannt.join(', ')}`);
  if (z.ohneWert) console.log(`  ${z.ohneWert} Meldungen ohne Messwert`);
  return z.werte;
}

async function main() {
  const cfg = await lesenJson('daten/messstellen.json');
  const stellen = normalisieren(cfg.messstellen);
  let alt = {};
  try {
    alt = process.env.SEITE_URL ? JSON.parse(await holen(new URL('daten/pegel.json', process.env.SEITE_URL).href + '?t=' + Date.now()))
      : await lesenJson('daten/pegel.json');
  } catch (e) {
    console.log('Keine bisherigen Werte:', e.message);
  }
  const werte = I.entpacken(alt);
  const jetzt = Date.now();
  const seit = Date.parse(alt?.stand) || jetzt - 86_400_000;
  let fehler = 0;
  for (const q of cfg.abruf || []) {
    if (!q.aktiv) continue;
    const name = q.name || q.art;
    try {
      const neu = await quelleAbrufen(q, stellen, seit - 3_600_000);
      for (const [id, l] of Object.entries(neu)) {
        werte[id] = I.zusammenfuehren(werte[id], l, jetzt);
        console.log(`${name}: ${id} +${l.length} Werte, zuletzt ${l.at(-1)?.cm} cm`);
      }
    } catch (e) {
      fehler++;
      console.log(`${name}: Fehler ${e.message}`);
    }
  }
  for (const id of Object.keys(werte)) werte[id] = I.zusammenfuehren(werte[id], [], jetzt);
  await writeFile(new URL('daten/pegel.json', wurzel), JSON.stringify(I.packen(werte, jetzt)) + '\n');
  console.log(`daten/pegel.json geschrieben (${Object.values(werte).reduce((a, l) => a + l.length, 0)} Werte, ${fehler} Fehler)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
