// plxr — a control room for coding CLI sessions.
//
// Two processes with clearly divided roles:
//
//	plxr daemon   holds the terminals, listens on 127.0.0.1 with a token
//	plxr          the window; starts the daemon if needed and attaches to it
//
// The separation is the point of the whole exercise: as long as the pseudo
// terminals are children of the window, closing it takes everything down. This
// way the work carries on, and several clients may watch at the same time.
package main

import (
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"plxr/internal/ptyhost"
	"runtime"
	"strings"

	"plxr/internal/cli"
	"plxr/internal/core"
	"plxr/internal/daemon"
	"plxr/internal/hook"
	"plxr/internal/server"
	"plxr/internal/session"
	"plxr/internal/update"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:web
var embedded embed.FS

// version is set at build time: -ldflags "-X main.version=1.2.3".
// "dev" means: built from source, and then the updater leaves everything alone.
var version = "dev"

func main() {
	// Subcommands come before the flags, so that `plxr ls` stays plain.
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		if kommando(os.Args[1], os.Args[2:]) {
			return
		}
	}

	browser := flag.Bool("browser", false, "statt des Fensters den Browser öffnen")
	zeigeVersion := flag.Bool("version", false, "Fassung ausgeben")
	// Anyone looking for help types --help, not "help". Without this the flag
	// package shows only the two switches and hides every subcommand.
	flag.Usage = func() {
		cli.Help()
		fmt.Fprintln(os.Stderr, "\nSchalter:")
		flag.PrintDefaults()
	}
	flag.Parse()

	if *zeigeVersion {
		fmt.Println("plxr", version)
		return
	}

	info, err := daemon.Ensure()
	if err != nil {
		log.Fatal("Daemon: ", err)
	}

	if *browser {
		url := fmt.Sprintf("%s/?token=%s", info.URL(), info.Token)
		fmt.Printf("\n  plxr läuft. Daemon PID %d, Port %d\n  %s\n\n", info.PID, info.Port, url)
		openBrowser(url)
		return
	}
	runWindow(info)
}

// command handles the subcommands. Returning true means: done, the window is not
// opened any more.
func kommando(name string, rest []string) bool {
	if name == "daemon" {
		runDaemon()
		return true
	}
	if name == "hook" {
		// Errors stay silent: a hook that floods Claude Code with output or aborts
		// is worse than a missing piece of state.
		_ = hook.Run(os.Stdin)
		return true
	}
	if name == "setup-hook" || name == "unsetup-hook" {
		entfernen := name == "unsetup-hook"
		path, err := hook.Install(strings.Join(rest, " "), entfernen)
		if err != nil {
			fmt.Fprintln(os.Stderr, "plxr:", err)
			os.Exit(1)
		}
		if entfernen {
			fmt.Println("aus", path, "entfernt")
		} else {
			fmt.Println("eingetragen in", path)
			fmt.Println("Neue Claude-Code-Sessions melden ihren Zustand ab sofort an plxr.")
		}
		return true
	}
	if name == "help" || name == "hilfe" {
		cli.Help()
		return true
	}
	if name == "version" {
		fmt.Println("plxr", version)
		return true
	}

	bekannt := map[string]bool{"ls": true, "new": true, "attach": true, "kill": true, "ports": true, "update": true}
	if !bekannt[name] {
		return false
	}

	c, err := cli.Connect()
	if err != nil {
		fmt.Fprintln(os.Stderr, "plxr:", err)
		os.Exit(1)
	}

	switch name {
	case "ls":
		err = cli.Ls(c)
	case "new":
		path, cmd := "", []string(nil)
		for i, a := range rest {
			if a == "--" {
				cmd = rest[i+1:]
				break
			}
			if path == "" {
				path = a
			}
		}
		err = cli.New(c, path, cmd)
	case "attach":
		if len(rest) == 0 {
			err = errors.New("welche Session? `plxr ls` zeigt sie")
		} else {
			err = cli.Attach(c, rest[0])
		}
	case "kill":
		if len(rest) == 0 {
			err = errors.New("welche Session? `plxr ls` zeigt sie")
		} else {
			err = cli.Kill(c, rest[0])
		}
	case "ports":
		err = cli.Ports(c)
	case "update":
		err = selbstUpdate()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "plxr:", err)
		os.Exit(1)
	}
	return true
}

// selfUpdate fetches the latest version from GitHub.
func selbstUpdate() error {
	st := update.Check(version)
	if st.Error != "" {
		return errors.New(st.Error)
	}
	if !st.Available {
		fmt.Printf("plxr %s ist aktuell (neueste: %s)\n", version, st.Latest)
		return nil
	}
	fmt.Printf("neue Fassung %s (aktuell %s), %.1f MB\n", st.Latest, version, float64(st.Size)/(1<<20))

	last := -1
	ort, err := update.Apply(st.AssetURL, func(read, total int64) {
		if total <= 0 {
			return
		}
		p := int(read * 100 / total)
		if p != last && p%5 == 0 {
			last = p
			fmt.Printf("\r  laden … %d%%", p)
		}
	})
	if err != nil {
		fmt.Println()
		return err
	}
	fmt.Printf("\r  eingesetzt: %s\n", ort)
	fmt.Println("  fertig. Beim nächsten Start läuft die neue Fassung.")
	return nil
}

// runDaemon is the process that owns the terminals.
func runDaemon() {
	reg, err := session.NewRegistry(filepath.Join(daemon.Root(), "sessions"))
	if err != nil {
		log.Fatal(err)
	}

	core.Version = version
	ptyhost.Version = version
	// The recording sits next to the rest of the state. That way the scrollback
	// survives every restart — with tmux it is gone.
	ptyhost.RecordingDir = filepath.Join(daemon.Root(), "mitschnitt")
	c := core.New(reg, sub("web/themes"), sub("web/agents"), sub("web/skins"))
	srv := server.New(c, sub("web"))

	ln, info, err := daemon.Listen()
	if err != nil {
		log.Fatal(err)
	}
	defer daemon.Forget()

	// Clean up once at startup; more often is not worth it.
	go c.PruneRecordings()

	log.Printf("plxr daemon auf %s (PID %d)", info.URL(), info.PID)
	log.Fatal(http.Serve(ln, daemon.CORS(daemon.Guard(info.Token, srv.Routes()))))
}

// runWindow is only a shell now: it serves the UI and tells it where the daemon
// sits. Everything else runs directly between those two.
func runWindow(info daemon.Info) {
	app := NewApp(info)
	err := wails.Run(&options.App{
		Title:       "plxr",
		Width:       1440,
		Height:      900,
		MinWidth:    900,
		MinHeight:   560,
		AssetServer: &assetserver.Options{Assets: sub("web")},
		// Without this Ctrl/Cmd +/- zooms the entire UI. In a terminal the font of
		// the terminal should change, not the whole window — plxr binds those
		// shortcuts itself.
		Windows: &windows.Options{
			ZoomFactor:           1.0,
			IsZoomControlEnabled: false,
		},
		// The frame stays with the system, but the background belongs to the skin —
		// otherwise white flashes through on every theme change.
		BackgroundColour: &options.RGBA{R: 11, G: 9, B: 6, A: 1},
		OnStartup:        app.startup,
		Bind:             []any{app},
		// Without a native Edit menu WKWebView does not pass Cmd+C and Cmd+V through
		// to the page at all — the shortcuts would simply be dead.
		// The menu stays invisible while the title bar is inset; the only point is
		// that macOS knows the shortcuts.
		Menu: menu.NewMenuFromItems(
			menu.SubMenu("plxr", menu.NewMenuFromItems(
				menu.Text("Über plxr", nil, func(*menu.CallbackData) {}),
				menu.Separator(),
				menu.Text("plxr ausblenden", keys.CmdOrCtrl("h"), func(*menu.CallbackData) {}),
				menu.Separator(),
				menu.Text("plxr beenden", keys.CmdOrCtrl("q"), func(*menu.CallbackData) { os.Exit(0) }),
			)),
			menu.EditMenu(),
		),
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
			About: &mac.AboutInfo{
				Title:   "plxr",
				Message: "Leitstand für Coding-CLI-Sessions",
			},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

func sub(dir string) fs.FS {
	f, err := fs.Sub(embedded, dir)
	if err != nil {
		log.Fatal(err)
	}
	return f
}

func openBrowser(url string) {
	switch runtime.GOOS {
	case "darwin":
		exec.Command("open", url).Run()
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Run()
	default:
		exec.Command("xdg-open", url).Run()
	}
}
