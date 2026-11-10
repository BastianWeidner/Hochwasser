// Fachlogik der Hochwasser-App: Messstellen, Trend, Voranzeichen, Pings und Demo-Simulation.
// Gleiche Regeln wie features/hochwasser/logic in der Android-App. Ohne DOM, läuft auch in Node (Tests, Abruf).

export const QUELLEN = {
  AMTLICH: 'HND Bayern',
  MARKT: 'Markt · LoRa',
  EIGEN: 'Eigener Sensor',
  ANDERE: 'Andere Quelle',
};

export const STEIGT_AB = 3.0;
const STUNDE = 3_600_000;

export const standardRegeln = () => ({
  anstieg: true, anstiegCmProH: 5, absinken: true, absinkenCmProH: 10,
  grenze: true, auffaellig: true, schweigen: false, schweigenMin: 60,
});

export const MELDESTUFEN_FISCHACH = [
  { name: 'Meldestufe 1', cm: 150 }, { name: 'Meldestufe 2', cm: 200 },
  { name: 'Meldestufe 3', cm: 230 }, { name: 'Meldestufe 4', cm: 260 },
];

/** Demo-Aufstellung, flussabwärts sortiert. laufzeitMin = Zeit bis zur nächsten Messstelle darunter. */
export function standardMessstellen() {
  const m = (id, name, gewaesser, quelle, grenzen, laufzeitMin, mehr = {}) =>
    ({ id, name, gewaesser, quelle, grenzen, laufzeitMin, favorit: false, hier: false, regeln: standardRegeln(), ...mehr });
  return [
    m('markt1', 'Markt-Pegel Neufnach', 'Neufnach', 'MARKT', [{ name: 'eigene Grenze', cm: 110 }], 120, { favorit: true }),
    m('markt2', 'Markt-Pegel Schmutter oben', 'Schmutter', 'MARKT', [], 60, { favorit: true }),
    m('eigen', 'Mein Wasserzugang', 'Schmutter', 'EIGEN', [{ name: 'Steg überflutet', cm: 120 }], 60, { favorit: true, hier: true }),
    m('fischach', 'Fischach / Schmutter', 'Schmutter', 'AMTLICH', MELDESTUFEN_FISCHACH.map((g) => ({ ...g })), 60, { favorit: true }),
    m('markt3', 'Markt-Pegel unterhalb', 'Schmutter', 'MARKT', [], 60),
  ];
}

const zahl = (x, lo, hi, standard) => (Number.isFinite(+x) ? Math.min(hi, Math.max(lo, +x)) : standard);

/** Unsinnige Werte abfangen; höchstens eine Messstelle ist „hier“. */
export function normalisieren(liste) {
  const gesehen = new Set();
  const l = (Array.isArray(liste) && liste.length ? liste : standardMessstellen())
    .filter((s) => s && s.id && !gesehen.has(s.id) && gesehen.add(s.id))
    .map((s) => ({
      id: String(s.id),
      name: String(s.name || '').trim() || 'Messstelle',
      gewaesser: String(s.gewaesser || ''),
      quelle: s.quelle in QUELLEN ? s.quelle : 'ANDERE',
      grenzen: (s.grenzen || []).filter((g) => g && +g.cm > 0).map((g) => ({ name: String(g.name || 'Grenze'), cm: Math.round(+g.cm) })).sort((a, b) => a.cm - b.cm),
      laufzeitMin: zahl(s.laufzeitMin, 0, 48 * 60, 60),
      favorit: !!s.favorit,
      hier: !!s.hier,
      regeln: regelnNormal(s.regeln),
      ...(s.zuordnung ? { zuordnung: s.zuordnung } : {}),
    }));
  const hier = l.find((s) => s.hier)?.id;
  return l.map((s) => ({ ...s, hier: s.id === hier }));
}

function regelnNormal(r = {}) {
  const s = { ...standardRegeln(), ...r };
  return {
    anstieg: !!s.anstieg, anstiegCmProH: zahl(s.anstiegCmProH, 1, 100, 5),
    absinken: !!s.absinken, absinkenCmProH: zahl(s.absinkenCmProH, 1, 100, 10),
    grenze: !!s.grenze, auffaellig: !!s.auffaellig,
    schweigen: !!s.schweigen, schweigenMin: zahl(s.schweigenMin, 15, 24 * 60, 60),
  };
}

// ---------- Analyse ----------

/** Lineare Ausgleichsgerade über die Werte im Fenster bis [bis], in cm pro Stunde. Werte: [{zeit, cm}]. */
export function trend(werte, bis, fensterMin = 60) {
  const von = bis - fensterMin * 60_000;
  const w = werte.filter((p) => p.zeit >= von && p.zeit <= bis);
  if (w.length < 2 || w[w.length - 1].zeit - w[0].zeit < 20 * 60_000) return null;
  const mx = w.reduce((a, p) => a + p.zeit, 0) / w.length;
  const my = w.reduce((a, p) => a + p.cm, 0) / w.length;
  let z = 0, n = 0;
  for (const p of w) { const dx = p.zeit - mx; z += dx * (p.cm - my); n += dx * dx; }
  return n === 0 ? null : (z / n) * STUNDE;
}

export function letzter(werte, jetzt) {
  for (let i = werte.length - 1; i >= 0; i--) if (werte[i].zeit <= jetzt) return werte[i];
  return null;
}

export function lage(stelle, werte, jetzt) {
  const w = letzter(werte, jetzt);
  const bis = w ? w.zeit : jetzt;
  const t = w ? trend(werte, bis) : null;
  const tf = w ? trend(werte, bis - 3 * STUNDE) : null;
  const grenzen = [...stelle.grenzen].sort((a, b) => a.cm - b.cm);
  const ueber = w ? [...grenzen].reverse().find((g) => w.cm >= g.cm) || null : null;
  const naechste = w ? grenzen.find((g) => w.cm < g.cm) || null : null;
  const stunden = w && naechste && t != null && t > 0.5 ? (naechste.cm - w.cm) / t : null;
  const vor6 = w ? letzter(werte, bis - 6 * STUNDE) : null;
  return {
    stelle, wert: w, trend: t, trendFrueher: tf, ueberschritten: ueber, naechste,
    stundenBisNaechste: stunden,
    abstandCm: w && naechste ? naechste.cm - w.cm : null,
    stilleMin: w ? Math.floor((jetzt - w.zeit) / 60_000) : null,
    sechsStunden: w && vor6 ? w.cm - vor6.cm : null,
  };
}

export function beschleunigt(l) {
  if (l.trend == null) return false;
  const f = l.trendFrueher ?? 0;
  return l.trend >= STEIGT_AB && l.trend - f >= Math.max(2, Math.abs(f) * 0.5);
}

export const AMPEL = { RUHIG: 'Alles ruhig', AUFMERKSAM: 'Aufmerksam bleiben', WARNUNG: 'Warnung', ALARM: 'Alarm' };

/** Gesamtlage: je Messstelle die Lage, dazu Voranzeichen, Ampel, ein Satz für die Übersicht, Welle-Laufzeit. */
export function gesamt(stellen, werteJe, jetzt) {
  const lagen = stellen.map((s) => lage(s, werteJe[s.id] || [], jetzt));
  const hierIdx = stellen.findIndex((s) => s.hier);
  const hierLage = lagen[hierIdx];
  const zeichen = [];

  // 1. Steigt ein Pegel oberhalb von „hier“, bevor es hier steigt?
  let welleIn = null;
  if (hierIdx > 0) {
    let obenIdx = -1;
    for (let i = hierIdx - 1; i >= 0; i--) if ((lagen[i].trend ?? 0) >= STEIGT_AB) { obenIdx = i; break; }
    if (obenIdx >= 0) {
      const o = lagen[obenIdx];
      const hierSteigt = (hierLage?.trend ?? 0) >= STEIGT_AB;
      let lauf = 0;
      for (let i = obenIdx; i < hierIdx; i++) lauf += stellen[i].laufzeitMin;
      if (!hierSteigt) welleIn = lauf;
      zeichen.push({
        titel: 'Oberer Pegel steigt zuerst',
        text: `${o.stelle.name} ${rate(o.trend)}` + (hierSteigt ? ', die Welle ist bei dir angekommen' : `, bei dir in ca. ${dauer(lauf)}`),
        auffaellig: true,
      });
    }
  }
  if (!zeichen.length) zeichen.push({ titel: 'Kein Anstieg oberhalb', text: 'Die Pegel flussaufwärts sind ruhig', auffaellig: false });

  // 2. Wird der Anstieg schneller?
  const schneller = lagen.find(beschleunigt);
  zeichen.push(schneller
    ? { titel: 'Anstieg wird schneller', text: `${schneller.stelle.name}: vor 3 h ${rate(schneller.trendFrueher)}, jetzt ${rate(schneller.trend)}`, auffaellig: true }
    : { titel: 'Kein beschleunigter Anstieg', text: 'Die Anstiegsraten bleiben gleich oder fallen', auffaellig: false });

  // 3. Grenzen.
  const ueber = lagen.filter((l) => l.ueberschritten);
  const baldig = lagen.filter((l) => l.stundenBisNaechste != null).sort((a, b) => a.stundenBisNaechste - b.stundenBisNaechste)[0];
  if (ueber.length) {
    zeichen.push({ titel: 'Grenze überschritten', text: ueber.map((l) => `${l.stelle.name}: ${l.ueberschritten.name}`).join(', '), auffaellig: true });
  } else if (baldig) {
    zeichen.push({
      titel: 'Keine Grenze erreicht',
      text: `${baldig.stelle.name}: ${baldig.naechste.name} bei gleichem Anstieg in ca. ${dauer(Math.round(baldig.stundenBisNaechste * 60))} (Hochrechnung)`,
      auffaellig: baldig.stundenBisNaechste < 6,
    });
  } else {
    zeichen.push({ titel: 'Keine Grenze erreicht', text: 'Alle Pegel liegen unter ihren Grenzen', auffaellig: false });
  }

  // 4. Melden alle?
  const still = lagen.filter((l) => (l.stilleMin ?? Infinity) > 30);
  zeichen.push(still.length
    ? { titel: 'Messstelle schweigt', text: still.map((l) => l.stelle.name + (l.stilleMin != null ? ` seit ${dauer(l.stilleMin)}` : ' ohne Werte')).join(', '), auffaellig: true }
    : { titel: 'Alle Messstellen melden', text: 'Letzter Wert vor höchstens 30 Minuten', auffaellig: false });

  const alarm = lagen.some((l) => {
    if (!l.ueberschritten) return false;
    const idx = [...l.stelle.grenzen].sort((a, b) => a.cm - b.cm).findIndex((g) => g.cm === l.ueberschritten.cm);
    return l.stelle.hier || (l.stelle.quelle === 'AMTLICH' && idx >= 2);
  });
  let ampel = 'RUHIG';
  if (alarm) ampel = 'ALARM';
  else if (ueber.length || (baldig?.stundenBisNaechste ?? 99) < 3) ampel = 'WARNUNG';
  else if (zeichen.some((z) => z.auffaellig) || lagen.some((l) => (l.trend ?? 0) >= STEIGT_AB)) ampel = 'AUFMERKSAM';

  const ueberText = ueber.map((l) => `${l.stelle.name} ${l.ueberschritten.name}`).join(', ');
  let hinweis;
  if (alarm) hinweis = `Eine wichtige Grenze ist überschritten: ${ueberText}.`;
  else if (welleIn != null && hierLage) {
    const oben = Math.max(-Infinity, ...lagen.slice(0, hierIdx).map((l) => l.sechsStunden ?? -Infinity));
    hinweis = `Die Welle von oben ist in etwa ${dauer(welleIn)} bei dir.` + (oben > 5 ? ` Oben stieg es in 6 h um ${Math.round(oben)} cm.` : '');
  } else if (ueber.length) hinweis = `Grenze überschritten: ${ueberText}.`;
  else if (baldig && ampel !== 'RUHIG') hinweis = `Bleibt der Anstieg so, erreicht ${baldig.stelle.name} ${baldig.naechste.name} in etwa ${dauer(Math.round(baldig.stundenBisNaechste * 60))}.`;
  else if (ampel === 'AUFMERKSAM') hinweis = 'Die Pegel steigen, noch ist keine Grenze in Sicht.';
  else hinweis = 'Keine Auffälligkeiten an deinen Messstellen.';

  return { lagen, zeichen, ampel, hinweis, welleInMin: welleIn };
}

// ---------- Pings ----------

const cmText = (w) => (w ? `${Math.round(w.cm)} cm` : '–');

/**
 * Gepingt wird nur, wenn eine Regel neu aktiv wird. Damit es knapp an der Schwelle nicht ständig pingt, bleibt eine
 * Regel aktiv, bis der Wert deutlich darunter liegt (Anstieg: unter 60 % der Rate, Grenze: 5 cm darunter).
 * Ergebnis: { pings: [{zeit, schluessel, titel, text, wichtig}], aktiv: [schluessel] }.
 */
export function pruefen(stellen, g, vorher, jetzt) {
  const v = new Set(vorher);
  const aktiv = new Map();
  const ping = (k, titel, text, wichtig) => aktiv.set(k, { zeit: jetzt, schluessel: k, titel, text, wichtig });
  for (const l of g.lagen) {
    const s = l.stelle, r = s.regeln, t = l.trend, w = l.wert;
    if (r.anstieg && t != null) {
      const k = `anstieg:${s.id}`;
      if (t >= r.anstiegCmProH || (v.has(k) && t >= r.anstiegCmProH * 0.6)) ping(k, `Schneller Anstieg: ${s.name}`, `${rate(t)}, jetzt ${cmText(w)}`, true);
    }
    if (r.absinken && t != null) {
      const k = `absinken:${s.id}`;
      if (-t >= r.absinkenCmProH || (v.has(k) && -t >= r.absinkenCmProH * 0.6)) ping(k, `Schnelles Absinken: ${s.name}`, `${rate(t)}, jetzt ${cmText(w)}`, false);
    }
    if (r.grenze && w) {
      for (const gr of s.grenzen) {
        const k = `grenze:${s.id}:${gr.cm}`;
        if (w.cm >= gr.cm || (v.has(k) && w.cm >= gr.cm - 5)) ping(k, `${gr.name} erreicht: ${s.name}`, `${Math.round(w.cm)} cm, Grenze ${gr.cm} cm, Trend ${rate(t)}`, true);
      }
    }
    if (r.auffaellig && beschleunigt(l)) ping(`auffaellig:${s.id}`, `Anstieg beschleunigt: ${s.name}`, `vor 3 h ${rate(l.trendFrueher)}, jetzt ${rate(t)}`, true);
    if (r.schweigen && (l.stilleMin ?? Infinity) >= r.schweigenMin) {
      ping(`schweigen:${s.id}`, `Messstelle schweigt: ${s.name}`, l.stilleMin != null ? `Seit ${dauer(l.stilleMin)} kein neuer Wert` : 'Noch kein Wert', false);
    }
  }
  const hier = stellen.find((s) => s.hier);
  if (g.welleInMin != null && hier && hier.regeln.auffaellig) ping('welle', 'Welle unterwegs', `${g.zeichen[0].text}.`, true);
  return { pings: [...aktiv.values()].filter((p) => !v.has(p.schluessel)), aktiv: [...aktiv.keys()] };
}

/** Nachtruhe: leichte Pings zwischen 22 und 6 Uhr nicht als Benachrichtigung zeigen. */
export const zeigen = (p, nachtruhe, stunde) => p.wichtig || !nachtruhe || (stunde >= 6 && stunde < 22);

// ---------- Texte ----------

export function rate(t) {
  if (t == null) return '–';
  const r = Math.round(t);
  return r > 0 ? `+${r} cm/h` : r < 0 ? `−${-r} cm/h` : '±0 cm/h';
}

export function trendWort(t) {
  if (t == null) return 'keine Daten';
  if (t >= 8) return '↑ stark steigend';
  if (t >= STEIGT_AB) return '↑ steigend';
  if (t > -STEIGT_AB) return '→ gleichbleibend';
  if (t > -8) return '↓ fallend';
  return '↓ stark fallend';
}

export function dauer(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = Math.floor((m % 60) / 15) * 15;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

// ---------- Demo-Simulation ----------

export const SZENARIEN = {
  RUHIG: { titel: 'Ruhig', beschreibung: 'Normaler Wasserstand mit kleinen Schwankungen.', dauerH: 24 },
  WELLE: { titel: 'Anlaufende Welle', beschreibung: 'Langer Regen: Die Pegel steigen nacheinander von oben nach unten, Fischach erreicht Meldestufe 1.', dauerH: 40 },
  STURZFLUT: { titel: 'Starkregen', beschreibung: 'Gewitter über dem Oberlauf: Steiler Anstieg in wenigen Stunden bis Meldestufe 3.', dauerH: 20 },
  AUSFALL: { titel: 'Messstelle fällt aus', beschreibung: 'Kleine Welle, dabei meldet der eigene Sensor nach vier Stunden nichts mehr.', dauerH: 24 },
};
export const TAKT_MIN = 15;
const VORLAUF_H = 24, BEGINN_H = 2;
const GRUND = { markt1: 40, markt2: 35, eigen: 38, fischach: 48, markt3: 45 };
const HOEHE = { markt1: 80, markt2: 70, eigen: 95, fischach: 125, markt3: 110 };
const FAKTOR = { RUHIG: 0, WELLE: 1, STURZFLUT: 1.6, AUSFALL: 0.5 };

export function form(sz, h) {
  if (h <= 0) return 0;
  const welle = (an, ab) => (h <= an ? (1 - Math.cos((Math.PI * h) / an)) / 2 : Math.exp(-(h - an) / ab));
  return { RUHIG: 0, WELLE: welle(16, 12), STURZFLUT: welle(5, 6), AUSFALL: welle(10, 8) }[sz];
}

export function pegel(sz, id, idx, versatzMin, min) {
  const g = GRUND[id] ?? 40 + 3 * idx, a = HOEHE[id] ?? 90;
  const h = (min - versatzMin) / 60 - BEGINN_H;
  const rauschen = 0.8 * Math.sin(min / 37 + idx * 1.7) + 0.4 * Math.sin(min / 11 + idx);
  return g + a * FAKTOR[sz] * form(sz, h) + rauschen;
}

const ausgefallen = (sz, s, min) => sz === 'AUSFALL' && s.hier && min > (BEGINN_H + 4) * 60;

/** Messreihen von 24 h vor dem Start bis [bisMin] danach, Zeitstempel ab [start]. */
export function reihen(sz, stellen, start, bisMin) {
  let versatz = 0;
  const out = {};
  stellen.forEach((s, idx) => {
    const l = [];
    for (let m = -VORLAUF_H * 60; m <= bisMin; m += TAKT_MIN) {
      if (!ausgefallen(sz, s, m)) l.push({ zeit: start + m * 60_000, cm: pegel(sz, s.id, idx, versatz, m) });
    }
    out[s.id] = l;
    versatz += s.laufzeitMin;
  });
  return out;
}
