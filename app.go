package main

import (
	"context"
	"strings"

	"plxr/internal/daemon"

	wr "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App ist bewusst dünn.
//
// Seit der Daemon eigenständig läuft, redet die Oberfläche direkt mit ihm über
// HTTP und WebSocket. Hier bleibt nur, was eine Webseite von sich aus nicht
// kann: wissen, wo der Daemon sitzt, auf welchem System sie läuft, und den
// Ordnerdialog des Betriebssystems öffnen.
type App struct {
	ctx  context.Context
	info daemon.Info
}

func NewApp(info daemon.Info) *App { return &App{info: info} }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

type DaemonInfo struct {
	URL   string `json:"url"`
	Token string `json:"token"`
	PID   int    `json:"pid"`
}

// Daemon liefert Adresse und Token — und stellt dabei sicher, dass wirklich
// einer läuft. Die Oberfläche ruft das auch nach einem Verbindungsabriss auf:
// ist der alte Daemon weg, wird hier ein neuer gestartet, statt dass das
// Fenster mit einer toten Fehlermeldung stehen bleibt.
func (a *App) Daemon() DaemonInfo {
	if info, err := daemon.Ensure(); err == nil {
		a.info = info
	}
	return DaemonInfo{URL: a.info.URL(), Token: a.info.Token, PID: a.info.PID}
}

// Env sagt der Oberfläche, auf welchem System sie sitzt.
//
// Nötig, weil macOS die Fensterknöpfe bei eingelassener Titelleiste ÜBER den
// Inhalt legt — ohne freien Platz links sitzt die Ampel auf dem Schriftzug.
// Windows und Linux haben eine eigene Leiste und brauchen den Platz nicht.
type Env struct {
	Platform      string `json:"platform"`
	Arch          string `json:"arch"`
	TitlebarInset bool   `json:"titlebarInset"`
}

func (a *App) Env() Env {
	info := wr.Environment(a.ctx)
	return Env{
		Platform:      info.Platform,
		Arch:          info.Arch,
		TitlebarInset: info.Platform == "darwin",
	}
}

// OpenURL öffnet eine Adresse im Standardbrowser.
//
// Nötig, weil ein Klick auf eine URL im Terminal sonst versuchen würde, sie
// IM Fenster zu öffnen — und damit die Anwendung durch eine fremde Seite
// ersetzt.
func (a *App) OpenURL(url string) {
	if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") {
		wr.BrowserOpenURL(a.ctx, url)
	}
}

// PickDirectory öffnet den Ordnerdialog des Systems. Das ist der eine Ort, an
// dem sich die Desktop-App spürbar besser anfühlt als der Browser.
func (a *App) PickDirectory() string {
	dir, err := wr.OpenDirectoryDialog(a.ctx, wr.OpenDialogOptions{
		Title: "Verzeichnis für die Session",
	})
	if err != nil {
		return ""
	}
	return dir
}
