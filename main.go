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
	"crypto/sha256"
	"embed"
	"encoding/hex"
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
	"time"

	"plxr/internal/cli"
	"plxr/internal/core"
	"plxr/internal/daemon"
	"plxr/internal/hook"
	"plxr/internal/queue"
	"plxr/internal/server"
	"plxr/internal/session"
	"plxr/internal/update"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/out
var embedded embed.FS

// version is set at build time: -ldflags "-X main.version=1.2.3".
// "dev" means: built from source, and then the updater leaves everything alone.
var version = "dev"

func main() {
	/* Before anything asks for a daemon.
	 *
	 * Ensure compares this build against the one already running, and it cannot
	 * do that without knowing which build this is. Set further down — after the
	 * daemon had already been asked for — the comparison read "dev" against a
	 * perfectly good daemon and replaced it on every single start. */
	core.Version = version
	daemon.Version = version

	// Subcommands come before the flags, so that `plxr ls` stays plain.
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		if command(os.Args[1], os.Args[2:]) {
			return
		}
	}

	browser := flag.Bool("browser", false, "open the browser instead of the window")
	showVersion := flag.Bool("version", false, "print the version")
	// Anyone looking for help types --help, not "help". Without this the flag
	// package shows only the two switches and hides every subcommand.
	flag.Usage = func() {
		cli.Help()
		fmt.Fprintln(os.Stderr, "\nOptions:")
		flag.PrintDefaults()
	}
	flag.Parse()

	if *showVersion {
		fmt.Println("plxr", version)
		return
	}

	info, err := daemon.Ensure()
	if err != nil {
		log.Fatal("daemon: ", err)
	}

	if *browser {
		url := fmt.Sprintf("%s/?token=%s", info.URL(), info.Token)
		fmt.Printf("\n  plxr is running. Daemon PID %d, port %d\n  %s\n\n", info.PID, info.Port, url)
		openBrowser(url)
		return
	}
	runWindow(info)
}

// command handles the subcommands. Returning true means: done, the window is not
// opened any more.
func command(name string, rest []string) bool {
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
		remove := name == "unsetup-hook"
		path, err := hook.Install(strings.Join(rest, " "), remove)
		if err != nil {
			fmt.Fprintln(os.Stderr, "plxr:", err)
			os.Exit(1)
		}
		if remove {
			fmt.Println("removed from", path)
		} else {
			fmt.Println("entered into", path)
			fmt.Println("New Claude Code sessions report their state to plxr from now on.")
		}
		return true
	}
	if name == "help" {
		cli.Help()
		return true
	}
	if name == "version" {
		fmt.Println("plxr", version)
		return true
	}

	known := map[string]bool{"ls": true, "new": true, "attach": true, "kill": true, "ports": true, "update": true}
	if !known[name] {
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
			err = errors.New("which session? `plxr ls` lists them")
		} else {
			err = cli.Attach(c, rest[0])
		}
	case "kill":
		if len(rest) == 0 {
			err = errors.New("which session? `plxr ls` lists them")
		} else {
			err = cli.Kill(c, rest[0])
		}
	case "ports":
		err = cli.Ports(c)
	case "update":
		err = selfUpdate()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "plxr:", err)
		os.Exit(1)
	}
	return true
}

// selfUpdate fetches the latest version from GitHub.
func selfUpdate() error {
	st := update.Check(version)
	if st.Error != "" {
		return errors.New(st.Error)
	}
	if !st.Available {
		fmt.Printf("plxr %s is up to date (latest: %s)\n", version, st.Latest)
		return nil
	}
	fmt.Printf("new version %s (current %s), %.1f MB\n", st.Latest, version, float64(st.Size)/(1<<20))

	last := -1
	path, err := update.Apply(st.AssetURL, func(read, total int64) {
		if total <= 0 {
			return
		}
		p := int(read * 100 / total)
		if p != last && p%5 == 0 {
			last = p
			fmt.Printf("\r  downloading … %d%%", p)
		}
	})
	if err != nil {
		fmt.Println()
		return err
	}
	fmt.Printf("\r  put in place: %s\n", path)
	fmt.Println("  done. The next start runs the new version.")
	return nil
}

// runDaemon is the process that owns the terminals.
func runDaemon() {
	reg, err := session.NewRegistry(filepath.Join(daemon.Root(), "sessions"))
	if err != nil {
		log.Fatal(err)
	}

	core.Version = version
	daemon.Version = version
	ptyhost.Version = version
	// The recording sits next to the rest of the state. That way the scrollback
	// survives every restart — with tmux it is gone.
	ptyhost.RecordingDir = filepath.Join(daemon.Root(), "recordings")
	// Lined-up instructions live beside the rest of the state, so they survive
	// a restart the way the sessions themselves do.
	queue.Dir = filepath.Join(daemon.Root(), "queue")
	migrateRecordings(daemon.Root())
	c := core.New(reg, sub("frontend/out/themes"), sub("frontend/out/agents"), sub("frontend/out/skins"))
	srv := server.New(c, sub("frontend/out"))

	ln, info, err := daemon.Listen()
	if errors.Is(err, daemon.ErrAlreadyRunning) {
		// Not a fault: somebody else got there first, and one is what is
		// wanted. Said out loud all the same, because a process that ends
		// without a word is the kind of thing you look for in the wrong place.
		log.Println("another daemon is already running — stepping aside")
		return
	}
	if err != nil {
		log.Fatal(err)
	}
	defer daemon.Forget()

	// Clean up once at startup; more often is not worth it.
	go c.PruneRecordings()
	// Send what is lined up, as soon as each agent is ready for it.
	go c.WatchQueues()

	log.Printf("plxr daemon on %s (PID %d)", info.URL(), info.PID)
	log.Fatal(http.Serve(ln, daemon.CORS(daemon.Guard(info.Token, srv.Routes()))))
}

// raiseWindow brings the window that is already open to the front, for when
// plxr is launched a second time. Set once the window exists — a callback that
// runs before there is anything to raise would be a crash instead of a window.
var raiseWindow = func(application.SecondInstanceData) {}

// runWindow opens the v3 window.
//
// The window is a frameless frosted-glass shell pointed straight at the local
// daemon over HTTP. Everything real — sessions, files, usage — already goes
// over that HTTP/WebSocket API, so the window needs no native bindings for the
// core; it is, in effect, a chrome-less browser on the daemon.
//
// The frost is native, from macOS: MacBackdropLiquidGlass on macOS 15+, which
// blurs whatever is behind the window. The page gives up its own background so
// that blur shows through. This is the one thing v2 could not do on this macOS
// — see the week that led here.
/* The window follows the setting, instead of being rebuilt for it.
 *
 * What lies between the window and the desktop is the operating system's doing,
 * and Wails only sets it when the window is created. The page cannot reach it
 * either: this window loads the daemon's own address, so Wails' bindings — which
 * live on the asset server's origin — do not exist here. That is deliberate,
 * because it is what lets the same page run in an ordinary browser.
 *
 * So the window watches the setting itself and changes the material live. The
 * daemon stays the one place the setting is kept, which is also what makes two
 * windows agree; nothing is restarted, and nothing has to be bound.
 */
func followBackdrop(win *application.WebviewWindow) {
	current := ""
	for {
		theme, _ := daemon.ReadPrefs()["theme"].(map[string]any)
		want, _ := theme["backdrop"].(string)
		if want == "" {
			want = "frosted"
		}
		if want != current {
			current = want
			applyBackdrop(win.NativeWindow(), want)
		}
		time.Sleep(500 * time.Millisecond)
	}
}

/* How the window meets what is behind it.
 *
 * macOS decides this, not the page. The frost around a translucent window is
 * the system's own, at the system's own strength, and no stylesheet can turn it
 * up or down — a slider called "how much it blurs" sat next to it for a long
 * time doing nothing to the window at all, because there was nothing there for
 * it to do.
 *
 * What does exist is a choice of three, and it is made once when the window is
 * built. So it is read from the settings here and changing it restarts the
 * window — the daemon keeps the terminals, so nothing is lost by that.
 */
func chosenBackdrop() application.MacBackdrop {
	theme, _ := daemon.ReadPrefs()["theme"].(map[string]any)
	switch theme["backdrop"] {
	case "clear":
		// Nothing between the page and the desktop: what the window paints is
		// all there is, and the see-through settings alone decide the look.
		return application.MacBackdropTransparent
	case "glass":
		// Apple's own, macOS 15+; it falls back to frosted where there is none.
		return application.MacBackdropLiquidGlass
	default:
		return application.MacBackdropTranslucent
	}
}

// roomID names this control room by the state it owns, short and stable.
func roomID() string {
	sum := sha256.Sum256([]byte(daemon.Root()))
	return hex.EncodeToString(sum[:6])
}

func runWindow(info daemon.Info) {
	app := application.New(application.Options{
		Name:        "plxr",
		Description: "A control room for coding CLI sessions",
		// One window per control room, not one per machine.
		//
		// Opening plxr again from the Dock should bring the window you already
		// have to the front: a second control room showing the same sessions is
		// two of everything and one of nothing. But "the same sessions" is what
		// makes them the same room, and that is the home directory — not the
		// program. Keyed globally, a build started against its own PLXR_HOME
		// was refused and quietly raised somebody else's window instead: no new
		// window ever appeared, and the one that came forward was a different
		// build showing different sessions. A test build could not be looked at
		// at all, and it looked as though nothing had been rebuilt.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:               "dev.plxr.app." + roomID(),
			OnSecondInstanceLaunch: raiseWindow,
		},
	})

	win := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "plxr",
		Width:            1440,
		Height:           900,
		MinWidth:         900,
		MinHeight:        560,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		// Straight at the daemon, with the token. The page runs the same way it
		// does in a browser — a mode the interface already supports.
		URL: fmt.Sprintf("%s/?token=%s", info.URL(), info.Token),
		Mac: application.MacWindow{
			Backdrop:                chosenBackdrop(),
			TitleBar:                application.MacTitleBarHiddenInset,
			InvisibleTitleBarHeight: 30,
		},
	})
	raiseWindow = func(application.SecondInstanceData) {
		win.Show()
		win.Focus()
	}
	go followBackdrop(win)
	win.Show()

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// migrateRecordings moves the scrollback written by earlier versions, which
// kept it under a German directory name. Without this the recorded output of
// every existing session would quietly stop being found after an update — the
// same shape as the templates directory, which already carries this.
func migrateRecordings(root string) {
	fresh := filepath.Join(root, "recordings")
	if _, err := os.Stat(fresh); err == nil {
		return
	}
	old := filepath.Join(root, "mitschnitt") // german-ok: migrating away from the old name
	if _, err := os.Stat(old); err != nil {
		return
	}
	_ = os.Rename(old, fresh)
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
