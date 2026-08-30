# Offen

Alles, was gesagt, gezeigt oder gemessen wurde und noch nicht erledigt ist.
Neues kommt hier rein, sobald es aufschlägt — nicht erst, wenn Zeit dafür ist.
Erledigtes fliegt raus, nicht ins Archiv.

## Gerade in Arbeit

- (nichts)

## Zugesagt, noch nicht gebaut

- **Terminal soll zum Theme passen.** Aktuell hat es feste Farben und steht als
  dunkler Klotz in einem hellen Skin. Frage von ihm: „muss das terminal dann
  immer so GANZ anders aussehen?" — Nein. Die halbe Ursache ist schon gefunden:
  `term-bg`/`term-fg` durften laut Go in einer Palette stehen, wurden von
  `app.js` aber nie angewendet. Das ist behoben; jetzt fehlt noch, dass die
  mitgelieferten Themes die Werte auch setzen.
- **Bereichsbeschriftung überlappt.** „Unbekanntes CLI" liegt über der ersten
  Terminalzeile.
- **Transparenz: die Fensterhälfte ist ungeprüft.** Der Regler und die Seite
  sind durchgeklickt und gemessen. Ob macOS das Fenster wirklich durchscheinend
  macht, kann ich hier nicht sehen — dafür braucht es das echte Fenster. Beim
  ersten Einschalten sagt es, dass ein Neustart nötig ist.
- **Kontowechsel wird angeboten, wo er nicht gehen kann.** Auf einer Session
  ohne Claude Code (Agent „generic", also eine normale Shell) steht der Knopf
  „Konto 1" trotzdem da; erst der Klick bringt „Wechsel fehlgeschlagen — Für
  diese Session ist keine Claude-Session-ID bekannt". Die Meldung stimmt, der
  Weg dahin nicht: der Schalter gehört ausgegraut mit Begründung im Tooltip,
  statt ins Leere zu führen.
- **Fortsetzen lässt die alte Kachel stehen.** Nach „Fortsetzen" liegt die neue
  Session neben der beendeten statt an deren Stelle; nach zweimal Fortsetzen
  stehen drei Kacheln desselben Verzeichnisses da, zwei davon „beendet". Seine
  Worte: „fortsetzen lässt das da drin stehen. brauch ich dann doch nicht…"
- **Agentenverwaltung: Probe für einzelne Zeilen fehlt noch bei „Erkennt am
  Kommando".** Die Probe prüft bisher nur die beiden Satzlisten.
## Gemessen, noch nicht behoben

- **Deutsche Bezeichner in `ui.js`** — `hexNachHsv`, `kasten` und weitere im
  Farbwähler.
- **Deutsche Klassennamen im CSS und JavaScript.** `zeile2`, `griff`, `feld`,
  `auswahl`, `auswahlText`, `pfadListe`, `farbwert`, `stil`, `stilzeile`,
  `farbwahl`, `farbflaeche`, `farbton`, `farbpunkt`, `farbtonpunkt`, `wahl` —
  stehen so in `classes.py` unter LAYOUT_ONLY. Dazu einzelne Bezeichner wie
  `gewuenscht` in `app.js` und deutsche Abschnittsüberschriften in `base.css`
  und `win95/skin.css`.
- **60 Zeilen Deutsch im Go-Code.** Fehlermeldungen (`kein gültiges Token`,
  `Daemon ist nicht hochgekommen`), CLI-Hilfe, Kommentare, halbübersetzte
  Sätze. Dazu deutsche Dateinamen (`internal/search/mitschnitt.go`), ein
  deutscher Wire-Name (`nur=eigene`) und deutsche Überschriften in `base.css`
  und `win95/skin.css`. **Keine Prüfstufe sieht dorthin** — das Gate fehlt noch.
- **Zwei Daemons gleichzeitig.** `Ensure()` liest `daemon.json`, prüft auf Leben
  und startet sonst einen neuen — zwei Fenster gleichzeitig starten zwei
  Daemons. Beobachtet: PIDs 9664 und 10092, drei Minuten auseinander.
- **Theme-Namen auf Deutsch** in `web/themes/*.json` (`CRT · Eisröhre`) — die
  stehen in der Auswahlliste, auch in der englischen Oberfläche.

## Wunschliste, noch nicht angefasst

- **Tonspur** – Ton bei Statuswechseln
- **Kollisionswache** – zwei Sessions im selben Verzeichnis
- **Warteschlange** – Anweisungen anstellen statt sofort schicken
- **Nachtschicht** – Zeitfenster, in dem ohne Rückfrage durchgearbeitet wird
- **MCP-Server** – plxr selbst als MCP-Server
- **Konten verwalten** – bisher gibt es nur `GET /api/accounts`; anlegen,
  benennen, Standard setzen fehlt komplett und braucht erst einen Entwurf

## Braucht eine Entscheidung von ihm

- **Leine.** Nur sinnvoll mit dem richtigen Zähler: kumulierter Verbrauch, nicht
  Kontextgröße. Welche Grenze, und was passiert beim Erreichen — anhalten,
  fragen, oder nur melden?
- **Handy.** Wie besprochen nicht baubar: echtes Push ohne fremde Cloud gibt es
  nicht. Alternative wäre eine Seite im lokalen Netz ohne Benachrichtigung.

## Nur er selbst kann das

- **`mg-pr/plxr` löschen.** Befehl: `gh repo delete mg-pr/plxr --yes`. Seine
  alte Firmen-Mail steht dort noch in der Historie.
