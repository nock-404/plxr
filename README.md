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
curl -fsSL https://raw.githubusercontent.com/mg-pr/plxr/main/install.sh | sh
```

macOS und Linux. Für Windows das Archiv von der Releases-Seite laden.

## Was es kann

**Als Terminal**

- echte Login-Shell, mit `TERM`, `COLORTERM` und `LANG` wie es sein soll
- bis zu vier Flächen nebeneinander, jede mit eigener Session
- Suche im Scrollback, anklickbare Adressen, Kopieren und Einfügen
- xterm 6 mit WebGL, Unicode-11-Breiten, 50.000 Zeilen Verlauf
- Tastenkürzel: `⌘T` neu, `⌘W` schließen, `⌘F` suchen, `⌘D` teilen,
  `⌘1`–`⌘9` springen, `⌘+`/`⌘-`/`⌘0` Schrift, `⌘,` Einstellungen

**Als Leitstand**

- **Posteingang** — alle Sessions, die auf eine Antwort warten, mit ihrer
  Frage. Antworten geht direkt, ohne eine einzige zu öffnen.
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

**Drumherum**

- **Sessions überleben das Fenster.** Zuklappen, neu öffnen, alles läuft.
- **Konten wechseln** — Transkript ins Zielkonto kopieren und mit `--resume`
  fortsetzen, wenn ein Kontingent aufgebraucht ist
- **Ports** — was lauscht, und der Weg es zu beenden
- **Vier Skins**, komplett anpassbar: alle Farben live, eigener Farbwähler,
  Schriftgrößen, als eigenes Theme speicherbar
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
| `internal/vorlage` | mehrere Sessions auf einen Schlag |
| `internal/files` | Dateibaum und Editor, an die Session gefesselt |
| `internal/ports` | belegte Ports |
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
