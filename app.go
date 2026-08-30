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

	// Version of THIS window. The daemon carries its own and the two can drift
	// apart: an update replaces the bundle, the daemon keeps running as the
	// process it was. What the interface then shows is the daemon's version,
	// and the window quietly talks to code that is months old.
	Version string `json:"version"`
}

func (a *App) Env() Env {
	info := wr.Environment(a.ctx)
	return Env{
		Version:       version,
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

// Seethrough is what a web page cannot do by itself: make the window let the
// desktop through.
//
// Two halves, and they are not the same. The page giving up colour is CSS and
// takes effect at once. The window being translucent at all is settled by
// macOS when the window is created — so it is written down here and read at
// the next start. Above zero this returns false, and the interface then says
// that a restart is needed.
//
// Returns whether it is in effect now.
func (a *App) Seethrough(percent int) bool {
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	_ = daemon.WriteWindow(daemon.WindowFile{Seethrough: percent})

	// Without a translucent window nothing shows through, however transparent
	// the page makes itself — the frame behind it stays opaque.
	if !translucent {
		return percent == 0
	}
	// 0 lets the desktop through, 255 is solid. The page paints its own colour
	// on top; what is set here is only how much of the frame remains.
	wr.WindowSetBackgroundColour(a.ctx, 0, 0, 0, 0)
	return true
}
