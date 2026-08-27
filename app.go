package main

import (
	"context"
	"strings"
	"time"

	"plxr/internal/daemon"

	wr "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is deliberately thin.
//
// Since the daemon runs on its own, the UI talks to it directly over HTTP and
// WebSocket. What remains here is only what a web page cannot do by itself: know
// where the daemon sits, which system it runs on, and open the folder dialog of
// the operating system.
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

// Daemon returns address and token — and makes sure one is actually running.
// The UI calls this after a dropped connection as well: if the old daemon is
// gone, a new one is started here instead of leaving the window stuck on a dead
// error message.
func (a *App) Daemon() DaemonInfo {
	if info, err := daemon.Ensure(); err == nil {
		a.info = info
	}
	return DaemonInfo{URL: a.info.URL(), Token: a.info.Token, PID: a.info.PID}
}

// Env tells the UI which system it is sitting on.
//
// Needed because with an inset title bar macOS puts the window buttons ON TOP of
// the content — without free space on the left the traffic lights sit on the
// wordmark. Windows and Linux have a bar of their own and need no such space.
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

// Quit closes this window.
//
// After an update the new version starts and the old one has to give way — but
// only the window. The daemon keeps running, which is why the sessions survive
// the changeover.
func (a *App) Quit() {
	go func() {
		time.Sleep(400 * time.Millisecond)
		wr.Quit(a.ctx)
	}()
}

// OpenURL opens an address in the default browser.
//
// Needed because otherwise a click on a URL in the terminal would try to open it
// IN the window — replacing the application with a foreign page
// ersetzt.
func (a *App) OpenURL(url string) {
	if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") {
		wr.BrowserOpenURL(a.ctx, url)
	}
}

// PickDirectory opens the system's folder dialog. This is the one place where
// the desktop app feels noticeably better than the browser.
func (a *App) PickDirectory() string {
	dir, err := wr.OpenDirectoryDialog(a.ctx, wr.OpenDialogOptions{
		Title: "Verzeichnis für die Session",
	})
	if err != nil {
		return ""
	}
	return dir
}
