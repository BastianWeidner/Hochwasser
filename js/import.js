// Import von Pegeldaten: LoRaWAN-Meldungen (The Things Network v3, ChirpStack v3/v4), CSV und einfaches JSON.
// Läuft im Browser (Testimport in der Verwaltung) und in Node (werkzeuge/abruf.mjs im geplanten Ablauf).
// Ergebnis ist immer eine Liste von Einträgen { geraet, zeit, felder, roh }, die über die Zuordnung einer
// Messstelle zu Wasserständen in cm werden.

/** Feldnamen, die als Messwert in Frage kommen, in dieser Reihenfolge. */
export const KANDIDATEN = [
  'wasserstand', 'pegel', 'water_level', 'waterLevel', 'waterlevel', 'level', 'height', 'hoehe',
  'abstand', 'distance', 'distance_mm', 'distance_cm', 'Distance', 'range', 'value', 'wert',
];

// ---------- Hilfen ----------

const b64 = (s) => (typeof atob === 'function' ? Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(s, 'base64')));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

/** EUIs vergleichbar machen: Großbuchstaben ohne Trennzeichen; Base64 (ChirpStack v3) wird zu Hex. */
export function euiNormal(s) {
  if (s == null) return '';
  const t = String(s).trim();
  if (/^[0-9a-fA-F:\-\s]{16,23}$/.test(t)) return t.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (/^[A-Za-z0-9+/]{11}=$/.test(t)) { try { return hex(b64(t)); } catch { /* kein Base64 */ } }
  return t;
}

/** Verschachtelte Felder flach machen: { sensor: { distance: 5 } } → { 'sensor.distance': 5 }. */
export function flach(o, vor = '', aus = {}) {
  if (o == null || typeof o !== 'object') return aus;
  for (const [k, v] of Object.entries(o)) {
    const n = vor ? `${vor}.${k}` : k;
    if (v != null && typeof v === 'object' && !Array.isArray(v)) flach(v, n, aus);
    else aus[n] = v;
  }
  return aus;
}

/** Zahl aus Text, auch mit Dezimalkomma; sonst null. */
export function zahl(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string') return null;
  const t = x.trim().replace(/\s/g, '');
  if (!t) return null;
  const n = Number(/,\d+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
}

/** Zeit aus ISO-Text, „TT.MM.JJJJ HH:MM(:SS)“, Sekunden oder Millisekunden seit 1970. */
export function zeit(x) {
  if (x == null || x === '') return null;
  if (typeof x === 'number') return x < 1e11 ? x * 1000 : x;
  const t = String(x).trim();
  if (/^\d{9,13}$/.test(t)) return zeit(Number(t));
  const de = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (de) {
    const j = de[3].length === 2 ? 2000 + +de[3] : +de[3];
    return new Date(j, +de[2] - 1, +de[1], +de[4], +de[5], +(de[6] || 0)).getTime();
  }
  const ms = Date.parse(t.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
}

// ---------- Formate ----------

/** Eine JSON-Meldung in einen Eintrag umwandeln, oder null. */
export function ausMeldung(o) {
  if (!o || typeof o !== 'object') return null;
  if (o.result && typeof o.result === 'object') o = o.result; // TTN Storage-API: { result: {...} }
  // The Things Network v3
  if (o.end_device_ids && (o.uplink_message || o.data?.uplink_message)) {
    const u = o.uplink_message || o.data.uplink_message;
    return {
      format: 'TTN',
      geraet: euiNormal(o.end_device_ids.dev_eui) || o.end_device_ids.device_id,
      name: o.end_device_ids.device_id,
      zeit: zeit(o.received_at || u.received_at || u.rx_metadata?.[0]?.time),
      felder: flach(u.decoded_payload || {}),
      roh: u.frm_payload || null,
    };
  }
  // ChirpStack v4
  if (o.deviceInfo) {
    return {
      format: 'ChirpStack',
      geraet: euiNormal(o.deviceInfo.devEui) || o.deviceInfo.deviceName,
      name: o.deviceInfo.deviceName,
      zeit: zeit(o.time || o.rxInfo?.[0]?.gwTime || o.rxInfo?.[0]?.nsTime),
      felder: flach(o.object || {}),
      roh: o.data || null,
    };
  }
  // ChirpStack v3
  if (o.devEUI) {
    let obj = o.object || {};
    if (!o.object && o.objectJSON) { try { obj = JSON.parse(o.objectJSON); } catch { obj = {}; } }
    return {
      format: 'ChirpStack v3',
      geraet: euiNormal(o.devEUI),
      name: o.deviceName,
      zeit: zeit(o.publishedAt || o.rxInfo?.[0]?.time),
      felder: flach(obj),
      roh: o.data || null,
    };
  }
  // Einfaches JSON: { zeit, messstelle, cm } oder ähnlich.
  const f = flach(o);
  const z = zeit(f.zeit ?? f.time ?? f.timestamp ?? f.datum ?? f.date ?? f.ts);
  const g = f.messstelle ?? f.geraet ?? f.device ?? f.devEui ?? f.dev_eui ?? f.station ?? f.id;
  if (z == null || g == null) return null;
  return { format: 'JSON', geraet: euiNormal(g), name: String(g), zeit: z, felder: f, roh: null };
}

function trenner(kopf) {
  const zaehl = (c) => kopf.split(c).length;
  return [';', '\t', ','].sort((a, b) => zaehl(b) - zaehl(a))[0];
}

function csvZeile(z, t) {
  const out = []; let feld = '', inQ = false;
  for (let i = 0; i < z.length; i++) {
    const c = z[i];
    if (inQ) { if (c === '"' && z[i + 1] === '"') { feld += '"'; i++; } else if (c === '"') inQ = false; else feld += c; }
    else if (c === '"') inQ = true;
    else if (c === t) { out.push(feld); feld = ''; }
    else feld += c;
  }
  out.push(feld);
  return out.map((s) => s.trim());
}

/** CSV mit Kopfzeile: Spalten für Zeit, Messstelle/Gerät und Wert werden am Namen erkannt. */
export function ausCsv(text, standardGeraet = '') {
  const zeilen = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((z) => z.trim());
  if (zeilen.length < 2) return [];
  const t = trenner(zeilen[0]);
  const kopf = csvZeile(zeilen[0], t);
  const k = kopf.map((s) => s.toLowerCase());
  const finde = (namen) => k.findIndex((s) => namen.some((n) => s === n || s.startsWith(n)));
  const iZeit = finde(['zeit', 'time', 'datum', 'date', 'timestamp', 'zeitpunkt', 'ts']);
  const iGer = finde(['messstelle', 'geraet', 'gerät', 'device', 'deveui', 'dev_eui', 'station', 'sensor', 'id']);
  if (iZeit < 0) return [];
  const out = [];
  for (const z of zeilen.slice(1)) {
    const s = csvZeile(z, t);
    const felder = {};
    kopf.forEach((n, i) => { if (i !== iZeit && i !== iGer) felder[n] = s[i]; });
    const g = iGer >= 0 ? s[iGer] : standardGeraet;
    const zt = zeit(s[iZeit]);
    if (zt != null) out.push({ format: 'CSV', geraet: euiNormal(g), name: g, zeit: zt, felder, roh: null });
  }
  return out;
}

/** Text einer Datei oder Antwort erkennen: JSON (Objekt, Liste, eine Meldung je Zeile) oder CSV. */
export function lesen(text, standardGeraet = '') {
  const t = String(text || '').trim();
  if (!t) return [];
  if (t[0] === '{' || t[0] === '[') {
    try {
      const j = JSON.parse(t);
      const liste = Array.isArray(j) ? j : Array.isArray(j.werte) ? j.werte : Array.isArray(j.data) ? j.data : [j];
      return liste.map(ausMeldung).filter(Boolean);
    } catch {
      // Eine JSON-Meldung je Zeile (z. B. TTN Storage-API).
      return t.split(/\r?\n/).map((z) => { try { return ausMeldung(JSON.parse(z)); } catch { return null; } }).filter(Boolean);
    }
  }
  return ausCsv(t, standardGeraet);
}

// ---------- Zuordnung und Umrechnung ----------

/**
 * Zuordnung einer Messstelle (alles außer geraet optional):
 *   geraet       DevEUI oder Gerätename wie in den Daten
 *   feld         Feldname im entschlüsselten Inhalt, leer = automatisch (siehe KANDIDATEN)
 *   art          'pegel' (Wert ist der Wasserstand) oder 'abstand' (Sensor misst von oben bis zur Wasseroberfläche)
 *   einheit      'cm' | 'mm' | 'm'
 *   nullpunktCm  bei 'abstand': Abstand Sensor bis Pegel-Null in cm; Wasserstand = nullpunktCm − Abstand
 *   versatzCm    bei 'pegel': wird addiert (z. B. Sensor sitzt 20 cm über Pegel-Null)
 *   roh          'uint16be' | 'uint16le' | 'int16be' | 'int16le': Wert aus den Rohbytes, wenn es keinen Decoder gibt
 *   rohStart     Byte, ab dem gelesen wird (Standard 0)
 */
export function feldWaehlen(felder, wunsch) {
  if (wunsch) return zahl(felder[wunsch]) != null ? wunsch : null;
  const namen = Object.keys(felder);
  for (const k of KANDIDATEN) {
    const kl = k.toLowerCase();
    const n = namen.find((x) => {
      const xl = x.toLowerCase();
      return xl === kl || xl.endsWith('.' + kl) || xl.startsWith(kl + ' ') || xl.startsWith(kl + '_') || xl.startsWith(kl + '(') || xl.startsWith(kl + '[');
    });
    if (n && zahl(felder[n]) != null) return n;
  }
  // Sonst: genau ein Zahlenfeld (z. B. eine CSV mit nur einer Wertspalte).
  const zahlen = namen.filter((n) => zahl(felder[n]) != null);
  return zahlen.length === 1 ? zahlen[0] : null;
}

function ausRoh(roh, art, start = 0) {
  if (!roh) return null;
  let b;
  try { b = b64(roh); } catch { return null; }
  if (b.length < start + 2) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  switch (art) {
    case 'uint16be': return dv.getUint16(start, false);
    case 'uint16le': return dv.getUint16(start, true);
    case 'int16be': return dv.getInt16(start, false);
    case 'int16le': return dv.getInt16(start, true);
    default: return null;
  }
}

const FAKTOR = { cm: 1, mm: 0.1, m: 100 };

/** Wasserstand in cm aus einem Eintrag, oder null. */
export function umrechnen(e, z = {}) {
  let w;
  if (z.roh) w = ausRoh(e.roh, z.roh, z.rohStart || 0);
  else {
    const f = feldWaehlen(e.felder || {}, z.feld);
    w = f ? zahl(e.felder[f]) : null;
  }
  if (w == null) return null;
  const cm = w * (FAKTOR[z.einheit] ?? 1);
  const v = z.art === 'abstand' ? (z.nullpunktCm ?? 0) - cm : cm + (z.versatzCm ?? 0);
  return Math.round(v * 10) / 10;
}

/**
 * Einträge den Messstellen zuordnen. Ergebnis: { werte: { id: [{zeit, cm}] }, unbekannt: [geraet], ohneWert, anzahl }.
 */
export function zuordnen(eintraege, stellen) {
  const nach = new Map();
  for (const s of stellen) if (s.zuordnung?.geraet) nach.set(euiNormal(s.zuordnung.geraet), s);
  const werte = {}, unbekannt = new Set();
  let ohneWert = 0, anzahl = 0;
  for (const e of eintraege) {
    const s = nach.get(euiNormal(e.geraet)) || (e.name != null ? nach.get(euiNormal(e.name)) : undefined);
    if (!s) { unbekannt.add(e.geraet || e.name || '?'); continue; }
    const cm = e.zeit != null ? umrechnen(e, s.zuordnung) : null;
    if (cm == null) { ohneWert++; continue; }
    (werte[s.id] ||= []).push({ zeit: e.zeit, cm });
    anzahl++;
  }
  for (const l of Object.values(werte)) l.sort((a, b) => a.zeit - b.zeit);
  return { werte, unbekannt: [...unbekannt], ohneWert, anzahl };
}

/** Zwei Messreihen zusammenführen: nach Zeit sortiert, doppelte Zeitpunkte nur einmal, älter als [tage] weg. */
export function zusammenfuehren(alt = [], neu = [], jetzt = Date.now(), tage = 30) {
  const grenze = jetzt - tage * 86_400_000;
  const m = new Map();
  for (const p of [...alt, ...neu]) if (p && p.zeit >= grenze && Number.isFinite(p.cm)) m.set(p.zeit, p);
  return [...m.values()].sort((a, b) => a.zeit - b.zeit);
}

// ---------- Zentrale Datei daten/pegel.json ----------

/** Kompakte Form für die Datei: { stand, werte: { id: [[zeit, cm], ...] } }. */
export const packen = (werteJe, stand = Date.now()) => ({
  stand: new Date(stand).toISOString(),
  werte: Object.fromEntries(Object.entries(werteJe).map(([id, l]) => [id, l.map((p) => [p.zeit, p.cm])])),
});

export const entpacken = (j) => Object.fromEntries(
  Object.entries(j?.werte || {}).map(([id, l]) => [id, (l || []).filter((p) => Array.isArray(p) && p.length >= 2).map(([zeit, cm]) => ({ zeit, cm }))]),
);
