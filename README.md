# Hochwasser in Fischach

Web-App (PWA) für die Pegel an Neufnach und Schmutter rund um Fischach: Flusslauf mit Laufzeiten,
Verlauf mit Meldestufen, Voranzeichen und Pings bei schnellem Anstieg oder erreichter Grenze. Gleicher Aufbau
wie die Hochwasser-Unter-App der Android-Dach-App. **Keine amtliche Warnung** – maßgeblich bleiben
[HND Bayern](https://www.hnd.bayern.de) und die Warnungen der Behörden.

Adresse nach dem Veröffentlichen: https://bastianweidner.github.io/Hochwasser/

## Seiten

- **Übersicht:** Mein Standort groß, Lage-Hinweis (Ampel), Flusslauf von oben nach unten mit Laufzeiten.
- **Details:** Voranzeichen, Tabelle aller Messstellen, letzte Pings.
- **Einzel-Details:** Tipp auf einen Pegel – Diagramm 6 h/24 h/48 h/7 T mit Grenzen und dem Pegel darüber,
  Hochrechnung bis zur nächsten Grenze, Favorit, Ping-Regeln.
- **Verwaltung:** Messstellen, eigener Standort, Testimport für LoRa-Dateien, Datenquellen, Nachtruhe.
- **Live-Daten / Demo:** Live zeigt die zentral abgerufenen Werte; Demo spielt vier Szenarien mit simulierten
  Daten ab (Ruhig, Anlaufende Welle, Starkregen, Messstelle fällt aus).

Einstellungen wie Favoriten, Standort und Ping-Regeln gelten je Gerät (Browser-Speicher). Die Messwerte sind
für alle gleich.

## Wie die Daten zu allen kommen

Der Ablauf `.github/workflows/seite.yml` läuft alle 15 Minuten (und bei jeder Änderung auf `main`):

1. `node werkzeuge/abruf.mjs` holt neue Werte aus allen aktiven Quellen in `daten/messstellen.json`,
   führt sie mit den bisherigen Werten der Seite zusammen (30 Tage) und schreibt `daten/pegel.json`.
2. Die Seite wird samt Daten auf GitHub Pages veröffentlicht. Es entstehen dabei keine Commits.

GitHub startet geplante Abläufe nicht immer pünktlich; 10–30 Minuten Verzug sind normal. Für Echtzeit und
Pings bei geschlossener App kommt später ein kleiner Server dazu.

**Einmalig einrichten:** Settings › Pages › Build and deployment › Source = **GitHub Actions**.

### Quellen (`abruf` in `daten/messstellen.json`)

| Art | Wozu | Geheimnis |
| --- | --- | --- |
| `hnd` | Amtlicher Pegel aus der Übersicht des HND Bayern (`pegelNr`, z. B. 11942009 Fischach) | – |
| `ttn` | The Things Network v3, Storage Integration der Anwendung (`region`, `app`) | `TTN_API_KEY` |
| `url` | Jede Adresse mit TTN-/ChirpStack-JSON, JSON-Liste oder CSV, z. B. eine Inno.Live-Schnittstelle. `{seit}` in der Adresse wird durch den letzten Abruf ersetzt | `INNO_LIVE_TOKEN` |

Geheimnisse anlegen unter Settings › Secrets and variables › Actions. **Schlüssel nie in Dateien schreiben**,
das Repo und die Seite sind öffentlich. Eine Quelle mit `"aktiv": true` einschalten.

### Zuordnung der LoRa-Geräte

Jede Messstelle kann eine `zuordnung` haben:

```json
"zuordnung": { "geraet": "70B3D57ED0012345", "feld": "distance", "art": "abstand", "einheit": "mm", "nullpunktCm": 250 }
```

- `geraet`: DevEUI (mit oder ohne Trennzeichen) oder Gerätename wie in den Meldungen.
- `feld`: Feld im entschlüsselten Inhalt (`decoded_payload` bzw. `object`), leer = automatisch
  (wasserstand, pegel, water_level, level, distance, abstand …, verschachtelt als `sensor.distance`).
- `art`: `pegel` (Wert ist der Wasserstand, optional `versatzCm`) oder `abstand` (Sensor misst von oben bis
  zum Wasser; Wasserstand = `nullpunktCm` − Abstand).
- `einheit`: `cm`, `mm` oder `m`.
- Ohne Decoder: `"roh": "uint16be"` (oder `uint16le`, `int16be`, `int16le`) liest den Wert aus den Rohbytes,
  `rohStart` = Byte-Position.

Am schnellsten geht es mit **Verwaltung › Testimport**: Datei mit Meldungen wählen, Gerät, Messstelle und
Umrechnung einstellen, Ergebnis prüfen, „Zuordnung kopieren“ und in `daten/messstellen.json` einfügen.

Erkannte Formate: TTN v3 (einzelne Meldung, Liste oder Storage-API mit einer Meldung je Zeile),
ChirpStack v4 und v3 (HTTP-/MQTT-Integration), JSON-Liste `[{ "zeit", "messstelle", "cm" }]`,
CSV mit Kopfzeile (Spalten Zeit, Messstelle/Gerät, Wert; `;` oder `,`, Dezimalkomma, `TT.MM.JJJJ HH:MM`).

## Logo

`icons/logo.svg` ist ein Platzhalter. Zum Austauschen einfach die Datei ersetzen (gleicher Name, quadratisch).
Für das Wappen des Markts Fischach vorher die Erlaubnis der Gemeinde einholen.

## Entwickeln

Ohne Build-Schritt: ES-Module mit Preact/htm (`vendor/`). Lokal starten: `python3 -m http.server` im Ordner,
dann http://localhost:8000.

- Tests: `node --test test/*.test.mjs`
- **Nach jeder Änderung an App-Dateien** `python3 werkzeuge/sw-bauen.py` ausführen (neue Version für den
  Service Worker), sonst sehen Nutzer die Änderung erst spät.

Lizenzen: Preact und htm (MIT, `vendor/lizenzen/`), Nunito (SIL OFL, `fonts/`). Amtliche Pegelwerte:
Bayerisches Landesamt für Umwelt, www.hnd.bayern.de, Lizenz CC BY 4.0.
