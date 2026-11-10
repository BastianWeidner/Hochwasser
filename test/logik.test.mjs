// Tests der Fachlogik und des Imports: node test/logik.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as L from '../js/logik.js';
import * as I from '../js/import.js';

const start = 1_800_000_000_000;
const stellen = L.normalisieren(L.standardMessstellen());
const reihe = (...cm) => cm.map((v, i) => ({ zeit: start + i * 15 * 60_000, cm: v }));
const H = 3_600_000;

test('Trend gleichmäßiger Anstieg', () => {
  const w = reihe(50, 51.5, 53, 54.5, 56);
  assert.ok(Math.abs(L.trend(w, w.at(-1).zeit) - 6) < 0.001);
  assert.equal(L.trend(reihe(50), start), null);
});

test('Lage: Grenzen und Hochrechnung', () => {
  const s = stellen.find((x) => x.id === 'fischach');
  const w = reihe(90, 91.5, 93, 94.5, 96);
  const l = L.lage(s, w, w.at(-1).zeit);
  assert.equal(l.ueberschritten, null);
  assert.equal(l.naechste.cm, 150);
  assert.equal(l.abstandCm, 54);
  assert.ok(Math.abs(l.stundenBisNaechste - 9) < 0.01);
  const hoch = reihe(205, 206, 207, 208, 209);
  assert.equal(L.lage(s, hoch, hoch.at(-1).zeit).ueberschritten.name, 'Meldestufe 2');
});

test('Simulation versetzt die Welle nach unten', () => {
  const r = L.reihen('WELLE', stellen, start, 40 * 60);
  const spitze = (id) => r[id].reduce((a, b) => (b.cm > a.cm ? b : a));
  assert.ok(spitze('markt1').zeit < spitze('eigen').zeit);
  assert.ok(spitze('eigen').zeit < spitze('fischach').zeit);
  assert.ok(spitze('fischach').cm >= 150 && spitze('fischach').cm <= 200);
});

test('Ruhig bleibt ruhig', () => {
  const r = L.reihen('RUHIG', stellen, start, 24 * 60);
  const g = L.gesamt(stellen, r, start + 24 * H);
  assert.equal(g.ampel, 'RUHIG');
  assert.equal(L.pruefen(stellen, g, [], start).pings.length, 0);
});

test('Welle wird vorher erkannt', () => {
  const r = L.reihen('WELLE', stellen, start, 6 * 60);
  const g = L.gesamt(stellen, r, start + 6 * H);
  assert.equal(g.welleInMin, 180);
  assert.equal(g.ampel, 'AUFMERKSAM');
  assert.ok(g.hinweis.startsWith('Die Welle von oben'));
});

test('Starkregen gibt Alarm', () => {
  const r = L.reihen('STURZFLUT', stellen, start, 11 * 60);
  const g = L.gesamt(stellen, r, start + 11 * H);
  assert.equal(g.ampel, 'ALARM');
  assert.ok(g.lagen.find((l) => l.stelle.id === 'fischach').ueberschritten.cm >= 230);
});

test('Ausfall wird gemeldet', () => {
  const r = L.reihen('AUSFALL', stellen, start, 10 * 60);
  const z = L.gesamt(stellen, r, start + 10 * H).zeichen.at(-1);
  assert.equal(z.titel, 'Messstelle schweigt');
  assert.match(z.text, /Mein Wasserzugang/);
});

test('Ping nur beim Übergang', () => {
  const r = L.reihen('WELLE', stellen, start, 40 * 60);
  let aktiv = [];
  const alle = [];
  for (let m = 0; m <= 40 * 60; m += 15) {
    const e = L.pruefen(stellen, L.gesamt(stellen, r, start + m * 60_000), aktiv, start + m * 60_000);
    alle.push(...e.pings);
    aktiv = e.aktiv;
  }
  assert.equal(alle.filter((p) => p.schluessel === 'grenze:fischach:150').length, 1);
  assert.equal(alle.filter((p) => p.schluessel === 'grenze:eigen:120').length, 1);
  assert.ok(alle.some((p) => p.schluessel === 'welle'));
  assert.ok(alle.length < 40);
});

test('Nachtruhe hält nur leichte Pings zurück', () => {
  assert.equal(L.zeigen({ wichtig: false }, true, 23), false);
  assert.equal(L.zeigen({ wichtig: false }, true, 12), true);
  assert.equal(L.zeigen({ wichtig: true }, true, 3), true);
});

test('Normalisieren', () => {
  const n = L.normalisieren(stellen.map((s) => ({ ...s, hier: true, laufzeitMin: -5 })));
  assert.equal(n.filter((s) => s.hier).length, 1);
  assert.ok(n.every((s) => s.laufzeitMin === 0));
  assert.equal(L.normalisieren(null).length, 5);
});

test('Texte', () => {
  assert.equal(L.rate(6.2), '+6 cm/h');
  assert.equal(L.rate(-3.4), '−3 cm/h');
  assert.equal(L.dauer(150), '2 h 30 min');
  assert.equal(L.trendWort(9), '↑ stark steigend');
});

// ---------- Import ----------

const ttn = {
  end_device_ids: { device_id: 'pegel-neufnach', dev_eui: '70b3d57ed0012345' },
  received_at: '2026-11-10T18:15:00.123Z',
  uplink_message: { frm_payload: 'BLA=', decoded_payload: { distance: 1830, battery: 3.6 } },
};
const chirp4 = {
  time: '2026-11-10T18:30:00Z',
  deviceInfo: { devEui: '70b3d57ed0012345', deviceName: 'pegel-neufnach' },
  object: { sensor: { water_level: 71.5 } },
  data: 'AQI=',
};
const chirp3 = { devEUI: 'cLPVftABI0U=', deviceName: 'x', objectJSON: '{"level":42}', publishedAt: '2026-11-10T18:45:00Z', data: 'B9A=' };

test('TTN-Meldung', () => {
  const [e] = I.lesen(JSON.stringify(ttn));
  assert.equal(e.format, 'TTN');
  assert.equal(e.geraet, '70B3D57ED0012345');
  assert.equal(e.zeit, Date.parse('2026-11-10T18:15:00.123Z'));
  assert.equal(I.feldWaehlen(e.felder), 'distance');
  // Abstandssensor in mm, 2,5 m über Pegel-Null: 250 − 183 = 67 cm.
  assert.equal(I.umrechnen(e, { art: 'abstand', einheit: 'mm', nullpunktCm: 250 }), 67);
});

test('TTN-Storage (eine Meldung je Zeile)', () => {
  const text = [JSON.stringify({ result: ttn }), JSON.stringify({ result: { ...ttn, received_at: '2026-11-10T18:30:00Z' } })].join('\n');
  assert.equal(I.lesen(text).length, 2);
});

test('ChirpStack v4 und v3', () => {
  const [a] = I.lesen(JSON.stringify(chirp4));
  assert.equal(a.format, 'ChirpStack');
  assert.equal(I.feldWaehlen(a.felder), 'sensor.water_level');
  assert.equal(I.umrechnen(a, {}), 71.5);
  const [b] = I.lesen(JSON.stringify(chirp3));
  assert.equal(b.geraet, '70B3D57ED0012345'); // Base64-EUI wird Hex
  assert.equal(I.umrechnen(b, { versatzCm: 10 }), 52);
  // Ohne Decoder aus den Rohbytes: 0x07D0 = 2000 mm.
  assert.equal(I.umrechnen(b, { roh: 'uint16be', einheit: 'mm' }), 200);
});

test('CSV mit Semikolon und Dezimalkomma', () => {
  const csv = 'Zeitpunkt;Messstelle;Wasserstand cm\n10.11.2026 18:00;pegel-neufnach;70,5\n10.11.2026 18:15;pegel-neufnach;71,0\n';
  const e = I.lesen(csv);
  assert.equal(e.length, 2);
  assert.equal(e[0].format, 'CSV');
  assert.equal(I.umrechnen(e[1], {}), 71);
});

test('Zuordnen und Zusammenführen', () => {
  const st = stellen.map((s) => (s.id === 'markt1' ? { ...s, zuordnung: { geraet: '70-B3-D5-7E-D0-01-23-45', art: 'abstand', einheit: 'mm', nullpunktCm: 250 } } : s));
  const e = [...I.lesen(JSON.stringify(ttn)), ...I.lesen(JSON.stringify({ ...ttn, end_device_ids: { dev_eui: 'FFFF000000000000' } }))];
  const z = I.zuordnen(e, st);
  assert.equal(z.anzahl, 1);
  assert.deepEqual(z.unbekannt, ['FFFF000000000000']);
  assert.equal(z.werte.markt1[0].cm, 67);
  const jetzt = Date.parse('2026-11-11T00:00:00Z');
  const m = I.zusammenfuehren([{ zeit: 1, cm: 5 }, ...z.werte.markt1], z.werte.markt1, jetzt);
  assert.equal(m.length, 1); // doppelt nur einmal, uralt weg
  assert.deepEqual(I.entpacken(I.packen({ markt1: m })), { markt1: m });
});

test('Zeitformate', () => {
  assert.equal(I.zeit(1_800_000_000), 1_800_000_000_000);
  assert.equal(I.zeit('1800000000000'), 1_800_000_000_000);
  assert.equal(I.zahl('1.234,5'), 1234.5);
  assert.equal(I.zahl('abc'), null);
});

// ---------- Zentraler Abruf ----------
import { hndLesen, berlinZeit } from '../werkzeuge/abruf.mjs';

test('HND-Übersicht lesen', () => {
  const seite = '<a href="/pegel/iller_lech/fischach-11942009"><img src="x.png" data-name="Fischach" data-zeile2="Schmutter" id="p11942009" data-wert="56" data-wert2="1,23" data-ms="0" data-datum="10.11.2026, 18:45" data-stoerung=""></a>';
  const w = hndLesen(seite, '11942009');
  assert.equal(w.cm, 56);
  assert.equal(w.zeit, Date.parse('2026-11-10T17:45:00Z')); // MEZ = UTC+1
  assert.equal(hndLesen(seite, '123'), null);
  assert.equal(berlinZeit(2026, 7, 1, 12, 0), Date.parse('2026-07-01T10:00:00Z')); // Sommerzeit
});
