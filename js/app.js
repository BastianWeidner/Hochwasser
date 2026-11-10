// Oberfläche der Hochwasser-Web-App: Übersicht (Flusslauf), Details, Einzel-Details, Verwaltung.
// Gleicher Aufbau wie die Hochwasser-Unter-App der Dach-App.
import { html, render, useState, useEffect, useMemo, useRef } from '../vendor/preact-htm.js';
import * as L from './logik.js';
import * as I from './import.js';

export const VERSION = '0.1.1';
const LOKAL = 'hochwasser.lokal.v1';
const ABRUF_MS = 5 * 60_000;

// ---------- Speicher (nur Einstellungen dieses Geräts) ----------

function lokalLesen() {
  try { return JSON.parse(localStorage.getItem(LOKAL)) || {}; } catch { return {}; }
}
function lokalSchreiben(l) {
  try { localStorage.setItem(LOKAL, JSON.stringify(l)); } catch { /* privat oder voll: dann eben nur für diese Sitzung */ }
}

/** Zentrale Aufstellung plus die Einstellungen dieses Geräts (Favorit, Standort, Ping-Regeln). */
function aufstellen(zentral, lokal) {
  const je = lokal.je || {};
  const hierLokal = Object.entries(je).find(([, v]) => v.hier)?.[0];
  return L.normalisieren(zentral.map((s) => {
    const l = je[s.id] || {};
    return {
      ...s,
      favorit: l.favorit ?? s.favorit,
      hier: hierLokal ? s.id === hierLokal : s.hier,
      regeln: { ...s.regeln, ...(l.regeln || {}) },
    };
  }));
}

// ---------- Zeit und Zahlen ----------

const fmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const fmtKurz = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDatum = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const zeit = (ms, f = fmt) => (ms ? f.format(new Date(ms)) : '–');
const cm = (w) => (w ? `${Math.round(w.cm)} cm` : '–');
const trendKlasse = (l) => (l.ueberschritten ? 'k-alarm' : (l.trend ?? 0) >= L.STEIGT_AB ? 'k-steigt' : 'k-ruhig');

// ---------- Benachrichtigungen ----------

const kannMelden = () => typeof Notification !== 'undefined';
async function melden(p, demo) {
  if (!kannMelden() || Notification.permission !== 'granted') return;
  const titel = p.titel + (demo ? ' (Demo)' : '');
  const optionen = { body: p.text + (demo ? '\nSimulierte Daten, keine echte Warnung.' : ''), tag: p.schluessel, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(titel, optionen);
    else new Notification(titel, optionen);
  } catch (e) { console.warn('Benachrichtigung', e); }
}

// ---------- App ----------

export function App() {
  const [lokal, setLokalRoh] = useState(lokalLesen);
  const setLokal = (f) => setLokalRoh((alt) => { const n = typeof f === 'function' ? f(alt) : f; lokalSchreiben(n); return n; });
  const [zentral, setZentral] = useState(() => L.standardMessstellen());
  const [live, setLive] = useState({ werte: {}, stand: null, fehler: null, geladen: false });
  const [testimport, setTestimport] = useState({});
  const [tab, setTab] = useState('uebersicht');
  const [detail, setDetail] = useState(null);
  const [demo, setDemo] = useState(() => demoNeu('WELLE', L.standardMessstellen()));
  const [livePings, setLivePings] = useState([]);

  const stellen = useMemo(() => aufstellen(zentral, lokal), [zentral, lokal]);

  // Zentrale Aufstellung und Werte laden, Werte alle 5 Minuten neu.
  useEffect(() => {
    fetch('daten/messstellen.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (Array.isArray(j?.messstellen) && j.messstellen.length) setZentral(L.normalisieren(j.messstellen)); })
      .catch(() => {});
    const holen = () => fetch('daten/pegel.json?t=' + Date.now(), { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((j) => setLive({ werte: I.entpacken(j), stand: Date.parse(j.stand) || null, fehler: null, geladen: true }))
      .catch((e) => setLive((a) => ({ ...a, fehler: String(e.message || e), geladen: true })));
    holen();
    const t = setInterval(holen, ABRUF_MS);
    return () => clearInterval(t);
  }, []);

  // Live-Werte plus Testimport dieses Geräts.
  const liveWerte = useMemo(() => {
    const out = { ...live.werte };
    for (const [id, l] of Object.entries(testimport)) out[id] = I.zusammenfuehren(out[id], l, Date.now(), 365);
    return out;
  }, [live, testimport]);
  const hatLive = Object.values(liveWerte).some((l) => l.length && Date.now() - l.at(-1).zeit < 7 * 86_400_000);
  const modus = lokal.modus || (live.geladen && hatLive ? 'live' : 'demo');
  const setModus = (m) => setLokal((l) => ({ ...l, modus: m }));

  // Demo: Reihen hängen an Szenario und Aufstellung.
  const demoReihen = useMemo(() => L.reihen(demo.szenario, stellen, demo.start, L.SZENARIEN[demo.szenario].dauerH * 60), [demo.szenario, demo.start, stellen]);
  const jetzt = modus === 'demo' ? demo.start + demo.simMin * 60_000 : Date.now();
  const werteJe = modus === 'demo' ? demoReihen : liveWerte;
  const lage = useMemo(() => L.gesamt(stellen, werteJe, jetzt), [stellen, werteJe, jetzt]);

  // Demo abspielen.
  useEffect(() => {
    if (modus !== 'demo' || !demo.laeuft) return;
    const t = setInterval(() => setDemo((d) => demoSchritt(d, stellen, demoReihen, 1, lokal.nachtruhe !== false)), demo.tempo);
    return () => clearInterval(t);
  }, [modus, demo.laeuft, demo.tempo, stellen, demoReihen, lokal.nachtruhe]);

  // Live: nach jedem Abruf prüfen, ob neu gepingt werden muss (aktiv bleibt auf dem Gerät gespeichert).
  useEffect(() => {
    if (modus !== 'live' || !live.geladen) return;
    const e = L.pruefen(stellen, lage, lokal.aktiv || [], Date.now());
    if (e.pings.length) {
      const stunde = new Date().getHours();
      e.pings.forEach((p) => { if (L.zeigen(p, lokal.nachtruhe !== false, stunde)) melden(p, false); });
      setLivePings((a) => [...e.pings.reverse(), ...a].slice(0, 50));
    }
    if (JSON.stringify(e.aktiv) !== JSON.stringify(lokal.aktiv || [])) setLokal((l) => ({ ...l, aktiv: e.aktiv }));
  }, [modus, live, testimport]);

  // Zurück-Taste des Browsers: Einzel-Details schließen.
  useEffect(() => {
    const zurueck = () => setDetail(null);
    addEventListener('popstate', zurueck);
    return () => removeEventListener('popstate', zurueck);
  }, []);
  const oeffnen = (id) => { history.pushState({ detail: id }, ''); setDetail(id); window.scrollTo(0, 0); };
  const schliessen = () => history.back();

  const ctx = {
    stellen, lage, jetzt, werteJe, modus, setModus, demo, setDemo, demoReihen, lokal, setLokal,
    live, liveWerte, pings: modus === 'demo' ? demo.pings : livePings, testimport, setTestimport, zentral,
  };

  const offen = detail && stellen.find((s) => s.id === detail);
  if (offen) return html`<${Einzel} ...${ctx} s=${offen} zurueck=${schliessen} />`;
  return html`
    <div class="app">
      <header class="kopf">
        <img class="logo" src="icons/logo.svg" alt="Logo" width="40" height="40" />
        <span class="kopf-titel"><h1>Hochwasser</h1><span class="leise klein">in Fischach</span></span>
      </header>
      <main class="inhalt">
        ${tab !== 'verwaltung' && html`<${Quelle} ...${ctx} />`}
        ${tab === 'uebersicht' && html`<${Uebersicht} ...${ctx} oeffnen=${oeffnen} details=${() => setTab('details')} />`}
        ${tab === 'details' && html`<${Details} ...${ctx} oeffnen=${oeffnen} />`}
        ${tab === 'verwaltung' && html`<${Verwaltung} ...${ctx} />`}
        <p class="fuss leise klein">Version ${VERSION} · Amtliche Werte: Bayerisches Landesamt für Umwelt, www.hnd.bayern.de (CC BY 4.0). Keine amtliche Warnung.</p>
      </main>
      <nav class="tabs">
        ${[['uebersicht', 'Übersicht', '≈'], ['details', 'Details', '↗'], ['verwaltung', 'Verwaltung', '⚙']].map(([k, t, z]) => html`
          <button class=${'tab' + (tab === k ? ' an' : '')} onClick=${() => { setTab(k); window.scrollTo(0, 0); }} aria-current=${tab === k ? 'page' : null}>
            <span class="tab-symbol" aria-hidden="true">${z}</span>${t}
          </button>`)}
      </nav>
    </div>`;
}

// ---------- Demo ----------

function demoNeu(szenario, stellen, tempo = 800) {
  const start = Math.floor(Date.now() / 900_000) * 900_000;
  return { szenario, start, simMin: 0, laeuft: false, tempo, pings: [], aktiv: [] };
}

function demoSchritt(d, stellen, reihen, takte, nachtruhe) {
  const ende = L.SZENARIEN[d.szenario].dauerH * 60;
  let n = { ...d };
  for (let i = 0; i < takte && n.simMin < ende; i++) {
    n.simMin += L.TAKT_MIN;
    const jetzt = n.start + n.simMin * 60_000;
    const e = L.pruefen(stellen, L.gesamt(stellen, reihen, jetzt), n.aktiv, jetzt);
    const stunde = new Date().getHours();
    e.pings.forEach((p) => { if (L.zeigen(p, nachtruhe, stunde)) melden(p, true); });
    n = { ...n, aktiv: e.aktiv, pings: [...[...e.pings].reverse(), ...n.pings].slice(0, 50) };
  }
  if (n.simMin >= ende) n.laeuft = false;
  return n;
}

const TEMPO = [['langsam', 2000], ['normal', 800], ['schnell', 250]];

/** Kopfkarte: Live-Stand oder Demo-Steuerung, dazu Benachrichtigungen erlauben. */
function Quelle({ modus, setModus, demo, setDemo, stellen, demoReihen, live, lokal }) {
  const [erlaubt, setErlaubt] = useState(kannMelden() ? Notification.permission : 'unsupported');
  const fragen = async () => setErlaubt(await Notification.requestPermission());
  const ende = L.SZENARIEN[demo.szenario].dauerH * 60;
  return html`
    ${erlaubt === 'default' && html`
      <div class="hinweis">
        <p>Pings als Benachrichtigung? Auf dem iPhone geht das, wenn die Seite zum Home-Bildschirm hinzugefügt ist (Teilen › Zum Home-Bildschirm).</p>
        <button class="knopf klein-knopf" onClick=${fragen}>Benachrichtigungen erlauben</button>
      </div>`}
    <div class="modus" role="group" aria-label="Datenquelle">
      <button class=${modus === 'live' ? 'an' : ''} onClick=${() => setModus('live')}>Live-Daten</button>
      <button class=${modus === 'demo' ? 'an' : ''} onClick=${() => setModus('demo')}>Demo</button>
    </div>
    ${modus === 'live' ? html`
      <div class="karte leise-karte klein">
        ${!live.geladen ? 'Lädt …' : live.stand ? html`Werte zentral abgerufen: ${zeit(live.stand, fmtDatum)}. Die Seite lädt alle 5 Minuten neu.`
          : html`Noch keine zentralen Werte${live.fehler ? ` (${live.fehler})` : ''}. Der Abruf läuft alle 15 Minuten, sobald die Seite auf GitHub Pages veröffentlicht ist.`}
        ${live.stand && Date.now() - live.stand > 3_600_000 && html`<p class="rot">Der letzte Abruf ist über eine Stunde alt.</p>`}
      </div>` : html`
      <section class="karte demo">
        <div class="reihe-text"><strong>Demo · simulierte Daten</strong><span class="klein">${zeit(demo.start + demo.simMin * 60_000)} · +${L.dauer(demo.simMin)}</span></div>
        <div class="chips">
          ${Object.entries(L.SZENARIEN).map(([k, s]) => html`
            <button class=${'chip' + (demo.szenario === k ? ' an' : '')} onClick=${() => setDemo(demoNeu(k, stellen, demo.tempo))}>${s.titel}</button>`)}
        </div>
        <p class="klein">${L.SZENARIEN[demo.szenario].beschreibung}</p>
        <div class="fortschritt"><div style=${{ width: `${Math.min(100, (demo.simMin / ende) * 100)}%` }}></div></div>
        <div class="reihe">
          <button class="knopf" disabled=${demo.simMin >= ende} onClick=${() => setDemo((d) => ({ ...d, laeuft: !d.laeuft }))}>
            ${demo.laeuft ? 'Pause' : demo.simMin === 0 ? 'Abspielen' : 'Weiter'}
          </button>
          <button class="knopf zweit" disabled=${demo.simMin >= ende} onClick=${() => setDemo((d) => demoSchritt(d, stellen, demoReihen, 4, lokal.nachtruhe !== false))}>+1 h</button>
          <button class="knopf text" onClick=${() => setDemo(demoNeu(demo.szenario, stellen, demo.tempo))}>Neu</button>
        </div>
        <div class="chips"><span class="klein">Tempo</span>
          ${TEMPO.map(([t, ms]) => html`<button class=${'chip' + (demo.tempo === ms ? ' an' : '')} onClick=${() => setDemo((d) => ({ ...d, tempo: ms }))}>${t}</button>`)}
        </div>
      </section>`}`;
}

// ---------- Übersicht ----------

function Uebersicht({ lage, oeffnen, details }) {
  const hier = lage.lagen.find((l) => l.stelle.hier);
  return html`
    <section class="karte held">
      ${hier && html`
        <span class="klein">${hier.stelle.name}</span>
        <div class="wert-zeile"><span class="riesig">${cm(hier.wert)}</span><span class=${'rate ' + trendKlasse(hier)}>${L.rate(hier.trend)}</span></div>`}
      <div class=${'ampel a-' + lage.ampel}>
        <strong>${L.AMPEL[lage.ampel]}</strong>
        <p>${lage.hinweis}</p>
      </div>
    </section>
    <h2 class="zwischen">Flusslauf</h2>
    <ol class="fluss">
      ${lage.lagen.map((l, i) => html`
        <li class=${(l.stelle.hier ? 'hier ' : '') + trendKlasse(l)}>
          <button class="fluss-karte" onClick=${() => oeffnen(l.stelle.id)}>
            <span class="fluss-name">
              <strong>${l.stelle.favorit ? '★ ' : ''}${l.stelle.name}</strong>
              <span class="klein">${l.stelle.hier ? 'Hier · ' : ''}${L.QUELLEN[l.stelle.quelle]}</span>
            </span>
            <span class="fluss-wert"><strong>${cm(l.wert)}</strong><span class=${'klein rate ' + trendKlasse(l)}>${L.rate(l.trend)}</span></span>
          </button>
          ${i < lage.lagen.length - 1 && html`<span class="laufzeit klein">↓ Laufzeit ca. ${L.dauer(l.stelle.laufzeitMin)}</span>`}
        </li>`)}
    </ol>
    <button class="knopf breit" onClick=${details}>Lage-Analyse und Pings ansehen</button>`;
}

// ---------- Details ----------

function Details({ lage, pings, oeffnen }) {
  return html`
    <section class="karte">
      <h2>Voranzeichen</h2>
      <ul class="liste">
        ${lage.zeichen.map((z) => html`
          <li class="zeichen"><span class=${'punkt' + (z.auffaellig ? ' auffaellig' : '')} aria-label=${z.auffaellig ? 'auffällig' : 'unauffällig'}></span>
            <span><strong>${z.titel}</strong><span class="klein">${z.text}</span></span></li>`)}
      </ul>
    </section>
    <section class="karte">
      <h2>Alle Messstellen</h2>
      <ul class="liste">
        ${lage.lagen.map((l) => html`
          <li><button class="tabelle-zeile" onClick=${() => oeffnen(l.stelle.id)}>
            <span class="tz-name"><strong>${l.stelle.name}</strong><span class="klein">${L.QUELLEN[l.stelle.quelle]}${l.stelle.favorit ? ' · ★' : ''}</span></span>
            <strong class="tz-wert">${cm(l.wert)}</strong>
            <span class="tz-rest"><span class=${'klein rate ' + trendKlasse(l)}>${L.rate(l.trend)}</span>
              <span class="klein">${l.ueberschritten ? l.ueberschritten.name : l.abstandCm != null ? `noch ${Math.round(l.abstandCm)} cm` : 'keine Grenze'}</span></span>
          </button></li>`)}
      </ul>
    </section>
    <section class="karte">
      <h2>Letzte Pings</h2>
      ${pings.length ? html`<ul class="liste">${pings.slice(0, 15).map((p) => html`
        <li class="ping"><span class="klein">${zeit(p.zeit, fmtKurz)}</span>
          <span><strong class=${p.wichtig ? 'rot' : ''}>${p.titel}</strong><span class="klein">${p.text}</span></span></li>`)}</ul>`
        : html`<p class="leise">Noch keine.</p>`}
    </section>`;
}

// ---------- Einzel-Details ----------

function Einzel({ s, zurueck, lage, werteJe, jetzt, stellen, setLokal }) {
  const [stunden, setStunden] = useState(24);
  const l = lage.lagen.find((x) => x.stelle.id === s.id);
  const idx = stellen.findIndex((x) => x.id === s.id);
  const oben = stellen[idx - 1];
  const bis = (id) => (werteJe[id] || []).filter((p) => p.zeit <= jetzt);
  const lokalAendern = (f) => setLokal((lo) => ({ ...lo, je: { ...(lo.je || {}), [s.id]: f(lo.je?.[s.id] || {}) } }));
  const regel = (k, v) => lokalAendern((x) => ({ ...x, regeln: { ...(x.regeln || {}), [k]: v } }));
  const r = s.regeln;
  return html`
    <div class="app">
      <header class="kopf">
        <button class="kopf-zurueck" onClick=${zurueck} aria-label="Zurück zur Übersicht">‹</button>
        <h1>${s.name}</h1>
        <button class="stern" onClick=${() => lokalAendern((x) => ({ ...x, favorit: !s.favorit }))} aria-label=${s.favorit ? 'Favorit entfernen' : 'Als Favorit markieren'}>${s.favorit ? '★' : '☆'}</button>
      </header>
      <main class="inhalt">
        <p class="klein leise">${L.QUELLEN[s.quelle]} · ${s.gewaesser} · Stand ${zeit(l?.wert?.zeit)}</p>
        <div class="wert-zeile"><span class="riesig">${cm(l?.wert)}</span>
          ${l && html`<span class=${'rate ' + trendKlasse(l)}>${L.rate(l.trend)} · ${L.trendWort(l.trend)}</span>`}</div>
        <div class="chips">${[6, 24, 48, 168].map((h) => html`<button class=${'chip' + (stunden === h ? ' an' : '')} onClick=${() => setStunden(h)}>${h === 168 ? '7 T' : `${h} h`}</button>`)}</div>
        <section class="karte">
          <${Diagramm} werte=${bis(s.id)} vergleich=${oben ? bis(oben.id) : null} grenzen=${s.grenzen} jetzt=${jetzt} stunden=${stunden} />
          <p class="klein legende"><span class="l-haupt"></span>${s.name}
            ${oben && html` <span class="l-vergleich"></span>${oben.name} (oberhalb)`}
            ${s.grenzen.length > 0 && html` <span class="l-grenze"></span>Grenzen ${s.grenzen.map((g) => g.cm).join(' / ')} cm`}</p>
        </section>
        ${l && html`
          <div class="kacheln">
            <div class="karte"><span class="klein">Trend 1 h</span><strong>${L.rate(l.trend)}</strong></div>
            <div class="karte"><span class="klein">letzte 6 h</span><strong>${l.sechsStunden == null ? '–' : `${l.sechsStunden >= 0 ? '+' : '−'}${Math.abs(Math.round(l.sechsStunden))} cm`}</strong></div>
            <div class="karte"><span class="klein">${l.naechste ? (l.naechste.name.startsWith('Meldestufe') ? 'MS ' + l.naechste.name.slice(11) : 'Grenze') + ' in ca.' : 'Grenze'}</span>
              <strong>${l.stundenBisNaechste != null ? L.dauer(l.stundenBisNaechste * 60) : l.ueberschritten ? 'erreicht' : '–'}</strong></div>
          </div>
          <p class="klein leise">„in ca.“ ist eine einfache Hochrechnung aus dem Trend, keine amtliche Vorhersage.</p>`}
        <section class="karte">
          <h2>Pings für diese Messstelle</h2>
          <p class="klein leise">Gilt nur auf diesem Gerät.</p>
          <${Schalter} text="Schneller Anstieg" hilfe=${`mehr als ${r.anstiegCmProH} cm pro Stunde`} an=${r.anstieg} onChange=${(v) => regel('anstieg', v)} />
          ${r.anstieg && html`<${Zaehler} text="Schwelle" wert=${`${r.anstiegCmProH} cm/h`} minus=${() => regel('anstiegCmProH', Math.max(1, r.anstiegCmProH - 1))} plus=${() => regel('anstiegCmProH', r.anstiegCmProH + 1)} />`}
          <${Schalter} text="Schnelles Absinken" hilfe=${`mehr als ${r.absinkenCmProH} cm pro Stunde`} an=${r.absinken} onChange=${(v) => regel('absinken', v)} />
          <${Schalter} text="Grenze erreicht" hilfe=${s.grenzen.length ? s.grenzen.map((g) => `${g.name} ${g.cm} cm`).join(', ') : 'für diese Messstelle ist keine Grenze gesetzt'} an=${r.grenze} onChange=${(v) => regel('grenze', v)} />
          <${Schalter} text="Auffälliger Verlauf" hilfe=${'Anstieg wird schneller' + (s.hier ? ', Welle von oben unterwegs' : '')} an=${r.auffaellig} onChange=${(v) => regel('auffaellig', v)} />
          <${Schalter} text="Messstelle schweigt" hilfe=${`seit ${r.schweigenMin} Minuten kein neuer Wert`} an=${r.schweigen} onChange=${(v) => regel('schweigen', v)} />
        </section>
      </main>
    </div>`;
}

/** Verlauf als SVG mit Grenzlinien und dem Pegel darüber zum Vergleich. */
function Diagramm({ werte, vergleich, grenzen, jetzt, stunden }) {
  const B = 320, Hh = 200;
  const von = jetzt - stunden * 3_600_000;
  const w = werte.filter((p) => p.zeit >= von), v = (vergleich || []).filter((p) => p.zeit >= von);
  const maxW = Math.max(0, ...w.map((p) => p.cm), ...v.map((p) => p.cm));
  const minG = grenzen.length ? Math.min(...grenzen.map((g) => g.cm)) : Infinity;
  const oben = Math.max(maxW, maxW > minG * 0.5 ? Math.max(...grenzen.map((g) => g.cm)) : 0, 100) * 1.1;
  const x = (t) => ((t - von) / (jetzt - von)) * B, y = (c) => Hh - (c / oben) * Hh;
  const pfad = (l) => l.map((p, i) => `${i ? 'L' : 'M'}${x(p.zeit).toFixed(1)},${y(p.cm).toFixed(1)}`).join('');
  return html`
    <div class="diagramm">
      <div class="achse klein"><span>${Math.round(oben)}</span><span>${Math.round(oben / 2)}</span><span>0 cm</span></div>
      <svg viewBox=${`0 0 ${B} ${Hh}`} preserveAspectRatio="none" role="img" aria-label=${`Verlauf der letzten ${stunden} Stunden, jetzt ${w.at(-1) ? Math.round(w.at(-1).cm) : '–'} cm`}>
        <line x1="0" x2=${B} y1=${Hh / 2} y2=${Hh / 2} class="raster" />
        <line x1="0" x2=${B} y1=${Hh} y2=${Hh} class="raster" />
        ${grenzen.filter((g) => g.cm < oben).map((g, i) => html`<line x1="0" x2=${B} y1=${y(g.cm)} y2=${y(g.cm)} class="grenze" style=${{ opacity: 0.35 + (0.65 * (i + 1)) / grenzen.length }} />`)}
        ${v.length > 1 && html`<path d=${pfad(v)} class="vergleich" />`}
        ${w.length > 1 && html`<path d=${pfad(w)} class="haupt" />`}
      </svg>
    </div>
    <div class="reihe-text klein leise"><span>vor ${stunden === 168 ? '7 Tagen' : `${stunden} h`}</span><span>jetzt</span></div>
    ${w.length === 0 && html`<p class="leise klein">Für diesen Zeitraum gibt es noch keine Werte.</p>`}`;
}

// ---------- Verwaltung ----------

function Verwaltung({ stellen, lokal, setLokal, setTestimport, testimport }) {
  const hierSetzen = (id) => setLokal((lo) => {
    const je = { ...(lo.je || {}) };
    for (const s of stellen) je[s.id] = { ...(je[s.id] || {}), hier: s.id === id };
    return { ...lo, je };
  });
  return html`
    <section class="karte">
      <h2>Messstellen am Fluss</h2>
      <p class="klein leise">Von oben nach unten mit der Laufzeit bis zur nächsten Messstelle. Reihenfolge, Laufzeiten und Grenzen gelten für alle und stehen im Repo in daten/messstellen.json.</p>
      <ul class="liste">
        ${stellen.map((s, i) => html`
          <li class="verwalt">
            <span class="tz-name"><strong>${s.name}</strong>
              <span class="klein">${L.QUELLEN[s.quelle]}${i < stellen.length - 1 ? ` · ↓ ${L.dauer(s.laufzeitMin)}` : ''}${s.zuordnung?.geraet ? ' · Gerät ' + s.zuordnung.geraet : ''}</span></span>
            ${s.hier ? html`<span class="marke">Hier</span>` : html`<button class="knopf text" onClick=${() => hierSetzen(s.id)}>Mein Standort</button>`}
          </li>`)}
      </ul>
    </section>
    <${Testimport} stellen=${stellen} setTestimport=${setTestimport} testimport=${testimport} />
    <section class="karte">
      <h2>Datenquellen</h2>
      <ul class="liste quellen">
        <li><strong>Amtlicher Pegel (HND Bayern)</strong><span class="klein">Öffentlich, ohne Zugang. Der zentrale Abruf holt alle 15 Minuten den Wert von Fischach / Schmutter.</span></li>
        <li><strong>Pegel vom Markt (LoRa)</strong><span class="klein">Wartet auf die Freigabe. Vorbereitet für die Schnittstelle von Inno.Live, The Things Network oder ChirpStack. Schlüssel liegen nur in den Geheimnissen des Repos.</span></li>
        <li><strong>Eigener Sensor</strong><span class="klein">Über das eigene Gateway (ChirpStack) oder The Things Network, gleiche Zuordnung wie die Markt-Pegel.</span></li>
        <li><strong>Andere Quelle</strong><span class="klein">Jede Webadresse, die JSON oder CSV liefert, zum Beispiel Pegelonline.</span></li>
      </ul>
    </section>
    <section class="karte">
      <h2>Analyse und Pings</h2>
      <${Schalter} text="Nachtruhe für leichte Pings" hilfe="22–6 Uhr; Grenzen und schnelle Anstiege kommen trotzdem durch" an=${lokal.nachtruhe !== false} onChange=${(v) => setLokal((l) => ({ ...l, nachtruhe: v }))} />
      <p class="klein leise">Pings kommen, solange die Seite offen ist. Pings bei geschlossener App brauchen später einen kleinen Server.</p>
      <button class="knopf text" onClick=${() => setLokal({})}>Einstellungen dieses Geräts zurücksetzen</button>
    </section>`;
}

/** Testimport: eine Datei (TTN, ChirpStack, CSV, JSON) lesen und anzeigen, was die Zuordnung daraus macht. */
function Testimport({ stellen, setTestimport, testimport }) {
  const [erg, setErg] = useState(null);
  const [ziel, setZiel] = useState(stellen[0]?.id);
  const [art, setArt] = useState('pegel');
  const [einheit, setEinheit] = useState('cm');
  const [nullpunkt, setNullpunkt] = useState('');
  const datei = useRef(null);

  const lesen = async (f) => {
    const text = await f.text();
    const eintraege = I.lesen(text, f.name.replace(/\.[^.]+$/, ''));
    const geraete = [...new Set(eintraege.map((e) => e.geraet))];
    setErg({ name: f.name, eintraege, geraete, geraet: geraete[0] || '' });
  };
  const zuordnung = erg && { geraet: erg.geraet, art, einheit, nullpunktCm: +String(nullpunkt).replace(',', '.') || 0 };
  const vorschau = useMemo(() => {
    if (!erg) return null;
    const st = stellen.map((s) => (s.id === ziel ? { ...s, zuordnung } : { ...s, zuordnung: undefined }));
    return I.zuordnen(erg.eintraege.filter((e) => e.geraet === erg.geraet), st);
  }, [erg, ziel, art, einheit, nullpunkt]);
  const formate = erg ? [...new Set(erg.eintraege.map((e) => e.format))].join(', ') : '';
  const beispiel = erg?.eintraege.find((e) => e.geraet === erg.geraet);
  const feld = beispiel ? I.feldWaehlen(beispiel.felder) : null;

  return html`
    <section class="karte">
      <h2>Testimport</h2>
      <p class="klein leise">Datei mit LoRa-Meldungen (The Things Network, ChirpStack), CSV oder JSON wählen. Die Werte erscheinen nur auf diesem Gerät, bis du die Seite neu lädst. So lässt sich die Zuordnung prüfen, bevor sie zentral eingetragen wird.</p>
      <input type="file" ref=${datei} accept=".json,.csv,.txt,.ndjson,application/json,text/csv" class="versteckt" onChange=${(e) => e.target.files[0] && lesen(e.target.files[0])} />
      <button class="knopf zweit" onClick=${() => datei.current.click()}>Datei wählen</button>
      ${erg && (erg.eintraege.length === 0 ? html`<p class="rot">In „${erg.name}“ habe ich keine Meldungen erkannt.</p>` : html`
        <p class="klein">${erg.eintraege.length} Meldungen erkannt (${formate}), ${erg.geraete.length} Gerät(e).</p>
        <label class="feld"><span class="feld-label">Gerät</span>
          <select value=${erg.geraet} onChange=${(e) => setErg({ ...erg, geraet: e.target.value })}>${erg.geraete.map((g) => html`<option value=${g}>${g}</option>`)}</select></label>
        <p class="klein leise">Messwert-Feld: ${feld || 'keins erkannt'}${beispiel && feld ? ` (z. B. ${beispiel.felder[feld]})` : ''}</p>
        <label class="feld"><span class="feld-label">Messstelle</span>
          <select value=${ziel} onChange=${(e) => setZiel(e.target.value)}>${stellen.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
        <div class="reihe">
          <label class="feld"><span class="feld-label">Der Sensor misst</span>
            <select value=${art} onChange=${(e) => setArt(e.target.value)}><option value="pegel">Wasserstand</option><option value="abstand">Abstand zum Wasser</option></select></label>
          <label class="feld"><span class="feld-label">Einheit</span>
            <select value=${einheit} onChange=${(e) => setEinheit(e.target.value)}><option>cm</option><option>mm</option><option>m</option></select></label>
        </div>
        ${art === 'abstand' && html`<label class="feld"><span class="feld-label">Abstand Sensor bis Pegel-Null (cm)</span>
          <input inputmode="decimal" value=${nullpunkt} onInput=${(e) => setNullpunkt(e.target.value)} /></label>`}
        ${vorschau && html`<p class="klein">${vorschau.anzahl} Werte${vorschau.anzahl ? `, zuletzt ${Math.round(vorschau.werte[ziel].at(-1).cm)} cm am ${zeit(vorschau.werte[ziel].at(-1).zeit, fmtDatum)}` : ''}${vorschau.ohneWert ? `, ${vorschau.ohneWert} ohne Messwert` : ''}.</p>`}
        <div class="reihe">
          <button class="knopf" disabled=${!vorschau?.anzahl} onClick=${() => setTestimport((t) => ({ ...t, [ziel]: vorschau.werte[ziel] }))}>Anzeigen</button>
          <button class="knopf text" onClick=${() => navigator.clipboard?.writeText(JSON.stringify({ geraet: erg.geraet, ...(feld ? { feld } : {}), art, einheit, ...(art === 'abstand' ? { nullpunktCm: zuordnung.nullpunktCm } : {}) }))}>Zuordnung kopieren</button>
        </div>`)}
      ${Object.keys(testimport).length > 0 && html`<p class="klein">Testwerte aktiv für: ${Object.keys(testimport).join(', ')}. Sichtbar unter „Live-Daten“.
        <button class="knopf text" onClick=${() => setTestimport({})}>Entfernen</button></p>`}
    </section>`;
}

// ---------- Kleine Bausteine ----------

function Schalter({ text, hilfe, an, onChange }) {
  return html`
    <label class="schalter">
      <span class="schalter-text"><span>${text}</span>${hilfe && html`<span class="klein leise">${hilfe}</span>`}</span>
      <input type="checkbox" role="switch" checked=${an} onChange=${(e) => onChange(e.target.checked)} />
      <span class="schalter-bahn" aria-hidden="true"></span>
    </label>`;
}

function Zaehler({ text, wert, minus, plus }) {
  return html`
    <div class="zaehler"><span class="schalter-text">${text}</span>
      <button class="rund" onClick=${minus} aria-label=${text + ' verringern'}>−</button><strong>${wert}</strong>
      <button class="rund" onClick=${plus} aria-label=${text + ' erhöhen'}>+</button></div>`;
}

export function starten(el) { render(html`<${App} />`, el); }
