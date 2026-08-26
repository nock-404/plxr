// plxr — Leitstand für Coding-CLI-Sessions.
//
// Zwei Prozesse mit klarer Rollenteilung:
//
//	plxr daemon   hält die Terminals, lauscht auf 127.0.0.1 mit Token
//	plxr          Fenster; startet den Daemon bei Bedarf und hängt sich dran
//
// Die Trennung ist der Punkt der ganzen Übung: solange die Pseudo-Terminals
// Kinder des Fensters sind, stirbt beim Schließen alles mit. So läuft die
// Arbeit weiter, und es dürfen auch mehrere Clients gleichzeitig zusehen.
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

// version wird beim Bauen gesetzt: -ldflags "-X main.version=1.2.3".
// "dev" heißt: aus dem Quelltext gebaut, dann rührt der Updater nichts an.
var version = "dev"

func main() {
	// Unterbefehle stehen vor den Flags, damit `plxr ls` schlicht bleibt.
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		if kommando(os.Args[1], os.Args[2:]) {
			return
		}
	}

	browser := flag.Bool("browser", false, "statt des Fensters den Browser öffnen")
	zeigeVersion := flag.Bool("version", false, "Fassung ausgeben")
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

// kommando behandelt die Unterbefehle. Rückgabe true heißt: erledigt, das
// Fenster wird nicht mehr geöffnet.
func kommando(name string, rest []string) bool {
	if name == "daemon" {
		runDaemon()
		return true
	}
	if name == "hook" {
		// Fehler bleiben stumm: ein Hook, der Claude Code mit Ausgabe
		// zumüllt oder abbricht, ist schlimmer als ein fehlender Zustand.
		_ = hook.Lauf(os.Stdin)
		return true
	}
	if name == "setup-hook" || name == "unsetup-hook" {
		entfernen := name == "unsetup-hook"
		pfad, err := hook.Einrichten(strings.Join(rest, " "), entfernen)
		if err != nil {
			fmt.Fprintln(os.Stderr, "plxr:", err)
			os.Exit(1)
		}
		if entfernen {
			fmt.Println("aus", pfad, "entfernt")
		} else {
			fmt.Println("eingetragen in", pfad)
			fmt.Println("Neue Claude-Code-Sessions melden ihren Zustand ab sofort an plxr.")
		}
		return true
	}
	if name == "help" || name == "hilfe" {
		cli.Hilfe()
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

	c, err := cli.Verbinden()
	if err != nil {
		fmt.Fprintln(os.Stderr, "plxr:", err)
		os.Exit(1)
	}

	switch name {
	case "ls":
		err = cli.Ls(c)
	case "new":
		pfad, cmd := "", []string(nil)
		for i, a := range rest {
			if a == "--" {
				cmd = rest[i+1:]
				break
			}
			if pfad == "" {
				pfad = a
			}
		}
		err = cli.New(c, pfad, cmd)
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

// selbstUpdate holt die neueste Fassung von GitHub.
func selbstUpdate() error {
	st := update.Prüfen(version)
	if st.Fehler != "" {
		return errors.New(st.Fehler)
	}
	if !st.Verfügbar {
		fmt.Printf("plxr %s ist aktuell (neueste: %s)\n", version, st.Neueste)
		return nil
	}
	fmt.Printf("neue Fassung %s (aktuell %s), %.1f MB\n", st.Neueste, version, float64(st.Größe)/(1<<20))

	letzte := -1
	ort, err := update.Anwenden(st.AssetURL, func(gelesen, gesamt int64) {
		if gesamt <= 0 {
			return
		}
		p := int(gelesen * 100 / gesamt)
		if p != letzte && p%5 == 0 {
			letzte = p
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

// runDaemon ist der Prozess, dem die Terminals gehören.
func runDaemon() {
	reg, err := session.NewRegistry(filepath.Join(daemon.Root(), "sessions"))
	if err != nil {
		log.Fatal(err)
	}

	core.Version = version
	ptyhost.Fassung = version
	// Der Mitschnitt liegt neben dem übrigen Zustand. Damit überlebt der
	// Scrollback jeden Neustart — bei tmux ist er weg.
	ptyhost.MitschnittDir = filepath.Join(daemon.Root(), "mitschnitt")
	c := core.New(reg, sub("web/themes"), sub("web/agents"), sub("web/skins"))
	srv := server.New(c, sub("web"))

	ln, info, err := daemon.Listen()
	if err != nil {
		log.Fatal(err)
	}
	defer daemon.Forget()

	// Einmal beim Start aufräumen; häufiger lohnt nicht.
	go c.MitschnitteAufraeumen()

	log.Printf("plxr daemon auf %s (PID %d)", info.URL(), info.PID)
	log.Fatal(http.Serve(ln, daemon.Guard(info.Token, srv.Routes())))
}

// runWindow ist nur noch eine Hülle: sie liefert die Oberfläche aus und sagt
// ihr, wo der Daemon sitzt. Alles Weitere läuft direkt zwischen beiden.
func runWindow(info daemon.Info) {
	app := NewApp(info)
	err := wails.Run(&options.App{
		Title:       "plxr",
		Width:       1440,
		Height:      900,
		MinWidth:    900,
		MinHeight:   560,
		AssetServer: &assetserver.Options{Assets: sub("web")},
		// Ohne das zoomt Strg/Cmd +/- die gesamte Oberfläche. In einem Terminal
		// soll sich die Schrift des Terminals ändern, nicht das ganze Fenster —
		// plxr belegt die Kürzel selbst.
		Windows: &windows.Options{
			ZoomFactor:           1.0,
			IsZoomControlEnabled: false,
		},
		// Der Rahmen bleibt vom System, aber der Hintergrund gehört dem Skin —
		// sonst blitzt bei jedem Themewechsel Weiß durch.
		BackgroundColour: &options.RGBA{R: 11, G: 9, B: 6, A: 1},
		OnStartup:        app.startup,
		Bind:             []any{app},
		// Ohne ein natives Bearbeiten-Menü reicht WKWebView Cmd+C und Cmd+V
		// gar nicht erst an die Seite durch — die Kürzel wären schlicht tot.
		// Das Menü bleibt unsichtbar, solange die Titelleiste eingelassen ist;
		// es geht allein darum, dass macOS die Kürzel kennt.
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
