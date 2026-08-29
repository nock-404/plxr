<img src="web/favicon.svg" alt="" width="88" align="right">

# plxr

Ein Terminal für macOS, Windows und Linux — gebaut für den Fall, dass mehrere
Coding-Agenten gleichzeitig laufen.

![plxr](docs/crt.jpg)

## Warum

Terminals gibt es viele, und die meisten rendern schnell. Keines hilft
jemandem, der acht Agenten parallel fährt: Welcher wartet auf eine Antwort?
Was hat der in `MTA360` eigentlich gemacht? Wo war nochmal diese
Fehlermeldung? Und wieso ist beim Zuklappen des Laptops alles weg?

plxr beantwortet das, weil ein Hintergrundprozess die Terminals besitzt und
ihren Zustand kennt.

## Installieren

```sh
curl -fsSL https://raw.githubusercontent.com/nock-404/plxr/main/install.sh | sh
```

macOS und Linux. Für Windows das Archiv von der Releases-Seite laden.

## Was es kann

**Als Terminal**

- echte Login-Shell, mit `TERM`, `COLORTERM` und `LANG` wie es sein soll
- bis zu vier Flächen nebeneinander, jede mit eigener Session
- Suche im Scrollback, anklickbare Adressen, Kopieren und Einfügen
- xterm 6 mit WebGL, Unicode-11-Breiten, 50.000 Zeilen Verlauf
- Tastenkürzel: `⌘T` neu, `⌘W` schließen, `⌘F` suchen, `⌘D` teilen,
  `⌘1`–`⌘9` springen, `⌘+`/`⌘-`/`⌘0` Schrift, `⌘,` Einstellungen,
  `⌘.` alle anhalten — und `?` zeigt die Liste

**Als Leitstand**

- **Posteingang** — alle Sessions, die auf eine Antwort warten, mit ihrer
  Frage. Antworten geht direkt, ohne eine einzige zu öffnen. Fragen, die
  wörtlich gleich sind, werden zu **einer** Karte mit **einer** Antwort.
- **Antwortgedächtnis** — „das hast du heute schon zweimal so beantwortet",
  mit Knopf. Nur wörtlich gleiche Fragen, nur innerhalb eines Tages.
- **Notbremse** — ein Griff hält alle Sessions an (`SIGSTOP`), ein zweiter
  lässt sie weiterlaufen. Einzeln geht auch.
- **Übersicht** — Kacheln mit lebender Vorschau, Schiene nach Projekt
- **Zustand je Agent** — arbeitet, wartet, braucht dich. Bei Claude Code exakt
  über einen Hook, bei allen anderen aus Bildschirm und Ruhezeit.
- **Verbrauchstempo** — wie schnell gerade Kontingent verbraucht wird, bevor
  das Fenster reißt
- **Vorlagen** — die Arbeitsumgebung von heute morgen auf einen Klick

**Zum Wiederfinden**

- **Terminalsuche** — durchsucht, was je in einem Terminal stand, auch in
  Sessions, die es nicht mehr gibt. tmux verliert das beim Neustart.
- **Archiv** — alle Claude-Code-Unterhaltungen über mehrere Konten, mit
  Volltextsuche über den kompletten Verlauf
- **Dateien** — Baum je Session mit Editor, dazu die aufgelöste
  CLAUDE.md-Kette: was wirkt hier eigentlich alles
- **Merkpunkte** — vor jeder Anweisung ein Abzug des Arbeitsverzeichnisses,
  danach einzelne Dateien zurückrollen. `git checkout .` nimmt deine eigene
  Arbeit mit — das hier nicht. Nur in einem Git-Repo, und ohne Index oder
  Arbeitsbaum anzufassen.
- **Wiedergabe** — jede Session als Aufzeichnung abspielen, mit Sprung zum
  Suchtreffer
- **Wartekonto** — über Wochen: wie lang haben die Agenten gearbeitet, und wie
  lang auf dich gewartet

**Drumherum**

- **Sessions überleben das Fenster.** Zuklappen, neu öffnen, alles läuft.
- **Konten wechseln** — Transkript ins Zielkonto kopieren und mit `--resume`
  fortsetzen, wenn ein Kontingent aufgebraucht ist
- **Ports** — was lauscht, und der Weg es zu beenden
- **Vier Skins**, komplett anpassbar: alle Farben live, eigener Farbwähler,
  Schriftgrößen, als eigenes Theme speicherbar
- **Werkstatt** — einen Skin im laufenden Fenster schreiben, angedockt neben
  der Oberfläche: jeder Tastendruck ist sofort links zu sehen. Daneben steht,
  welche Klassen dein Blatt noch nicht anfasst. Eigene Skins liegen unter
  `~/.plxr/skins` und überstehen jedes Update.
- **Werkbank** — eine Konsole im Fenster (`F12`, `⌘⌥I`): Meldungen, jeder
  Netzaufruf mit Status, und der Zustand der Oberfläche. Beim ersten Fehler
  meldet sie sich selbst.
- **Selbstaktualisierung** aus GitHub Releases, mit Ladebalken und Neustart

Nichts in der Oberfläche ist ein Systemwidget: keine Auswahlmenüs des
Betriebssystems, keine Systemdialoge, keine Systemscrollbalken. Jeder Pixel
gehört dem Skin.

## Kommandozeile

```
plxr                    Fenster öffnen
plxr ls                 laufende Sessions
plxr new [pfad] [-- kommando …]
plxr attach <was>       Terminal an eine Session hängen (Strg-Q zweimal löst)
plxr kill <was>         Session beenden
plxr ports              belegte Ports
plxr setup-hook         Claude Code seinen Zustand melden lassen
plxr update             auf die neueste Fassung bringen
```

`<was>` ist der Anfang der Session-ID oder ein Teil des Namens.

## Skins

Ein Theme wählt einen Skin — eine ganze visuelle Sprache, nicht nur Farben.

| | |
|---|---|
| ![Pixel](docs/pixel.jpg) | ![Skizze](docs/sketch.jpg) |

Alles davon lässt sich im Zahnrad anpassen und als eigenes Theme sichern.
Eigene Themes liegen in `~/.plxr/themes/*.json`:

```json
{
  "name": "mein-theme",
  "label": "Mein Theme",
  "skin": "crt",
  "palette": { "bg": "#0b0906", "fg": "#ffb000", "accent": "#ffcf5c" }
}
```

## Prüfen

```sh
./check.sh    # alles, was ohne Fenster prüfbar ist — 25 Stufen
./smoke.sh    # klickt die Oberfläche mit einem echten Browser durch
```

`check.sh` läuft vor jedem Commit. `smoke.sh` baut aus dem Arbeitsstand ein
Binary, startet einen eigenen Daemon in einem Wegwerf-Verzeichnis, öffnet die
Oberfläche in Chrome, klickt jede Ansicht und jeden Dialog an und legt
Bildschirmfotos aller vier Skins ab. Es ist bewusst **nicht** Teil von
`check.sh`: es braucht einen Browser, und eine Stufe, die sich still
überspringt, ist eine Stufe, die lügt.

Es fängt genau das, was keine statische Prüfung sieht: ein Wurf beim Start, ein
Dialog, der nicht erscheint, eine Ansicht ohne Fläche, rohe
Übersetzungsschlüssel auf dem Schirm, ein Skin, der nicht lädt.

## Bauen

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@latest
wails build
```

Für die Entwicklung der Oberfläche im Browser: `go run . --browser`.
`./check.sh` prüft vor jedem Commit JavaScript, Klassenabgleich, `go vet` und
den Querbau für fünf Plattformen.

## Aufbau

| Paket | Aufgabe |
|---|---|
| `internal/core` | die Anwendung ohne Oberfläche — kennt keinen Transport |
| `internal/daemon` | der Prozess, dem die Terminals gehören |
| `internal/ptyhost` | Prozesse im PTY, Scrollback, Mitschnitt, Vorschau |
| `internal/shell` | welche Shell, mit welchen Argumenten und welcher Umgebung |
| `internal/session` | Datenmodell und Registry unter `~/.plxr/sessions` |
| `internal/agent` | erkennt das laufende CLI und leitet den Status ab |
| `internal/hook` | schreibt den Zustand, den Claude Code meldet |
| `internal/archive` | die abgelegten Transkripte, über Konten hinweg gefaltet |
| `internal/search` | Volltextsuche über Transkripte und Terminalmitschnitte |
| `internal/usage` | Tokenverbrauch und Tempo |
| `internal/rules` | welche CLAUDE.md, Skills und Agenten hier wirken |
| `internal/template` | mehrere Sessions auf einen Schlag |
| `internal/marks` | Abzug des Arbeitsverzeichnisses vor jeder Anweisung |
| `internal/replies` | welche Antwort auf welche Frage ging |
| `internal/files` | Dateibaum und Editor, an die Session gefesselt |
| `internal/ports` | belegte Ports |
| `internal/theme` | Themes und Skins, eingebaute wie eigene |
| `internal/accounts` | mehrere Claude-Code-Konten auf einem Rechner |
| `internal/fleet` | Zustandsdateien anderer Werkzeuge einlesen |
| `internal/notify` | Systemmeldung, wenn jemand wartet |
| `internal/cli` | `plxr` auf der Kommandozeile |
| `internal/uierr` | Fehler als Code statt als Prosa, damit sie übersetzbar sind |
| `internal/update` | Selbstaktualisierung aus GitHub Releases |
| `internal/server` | HTTP und WebSocket zwischen Daemon und Oberfläche |

Der Kern kompiliert für macOS, Windows und Linux. Die Fensterschicht baut auf
jedem System selbst, weil Wails gegen dessen Webview linkt.

## Konten

Wer mehrere Claude-Zugänge über `CLAUDE_CONFIG_DIR` fährt, sieht sie unter
`~/.claude`, `~/.claude2`, … automatisch. In einer laufenden Session lässt sich
das Konto wechseln: plxr kopiert das Transkript ins Zielkonto und startet die
Session dort mit `--resume` neu — nötig, weil Claude Code Transkripte nur unter
dem eigenen Konfigurationsverzeichnis sucht.

## Lizenz

Apache 2.0. Frei und kostenlos, auch gewerblich.

## Mitmachen

Fehler und Vorschläge gern als Issue. Vor einem Pull Request `./check.sh`
laufen lassen.
