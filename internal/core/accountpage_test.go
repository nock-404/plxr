package core

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"plxr/internal/accounts"
	"plxr/internal/hook"
	"plxr/internal/ptyhost"
	"plxr/internal/session"
	"plxr/internal/uierr"
)

/* A fourth account, added from the page, on a machine arranged like his.
 *
 * Three accounts, the second and third reading the first one's projects
 * folder, plxr's hook in all three. An account added there used to get a
 * projects folder of its own and no hook: its sessions reported nothing, and
 * its conversations were invisible to the other three.
 */

// pageHome builds that machine in a temporary home, with the hook in the
// accounts named. It answers with the home and the shared folder.
func pageHome(t *testing.T, hooked ...string) (string, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("needs symlinks")
	}
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PLXR_HOME", filepath.Join(home, ".plxr"))
	t.Setenv("SHELL", "/bin/sh")

	store := filepath.Join(home, ".claude", "projects")
	if err := os.MkdirAll(filepath.Join(store, "-work"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, n := range []string{".claude2", ".claude3"} {
		if err := os.MkdirAll(filepath.Join(home, n), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(store, filepath.Join(home, n, "projects")); err != nil {
			t.Fatal(err)
		}
	}
	for _, n := range hooked {
		writeHooked(t, filepath.Join(home, n))
	}
	return home, store
}

// writeHooked writes the settings plxr's own installer writes, with the
// command where the application lives — the entry hook.Installed recognises.
func writeHooked(t *testing.T, dir string) {
	t.Helper()
	hooks := map[string]any{}
	for _, ev := range hook.Events {
		hooks[ev] = []any{map[string]any{"hooks": []any{map[string]any{
			"type": "command", "command": "/Applications/plxr.app/Contents/MacOS/plxr", "args": []any{"hook"},
		}}}}
	}
	b, _ := json.Marshal(map[string]any{"hooks": hooks})
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), b, 0o644); err != nil {
		t.Fatal(err)
	}
	if !hook.Installed(dir) {
		t.Fatalf("the settings written for %s are not recognised as the hook", dir)
	}
}

func pageCore(t *testing.T, home string) *Core {
	t.Helper()
	reg, err := session.NewRegistry(filepath.Join(home, "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	ptyhost.RecordingDir = filepath.Join(home, "recordings")
	t.Cleanup(func() { ptyhost.RecordingDir = "" })
	return New(reg, os.DirFS("../../assets/themes"), os.DirFS("../../assets/agents"), os.DirFS("../../assets/skins"))
}

// hookEntries is how many of the hook's events carry a command that is the
// running binary — which is what Install writes.
func hookEntries(t *testing.T, dir string) int {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		return 0
	}
	exe, _ := os.Executable()
	exe, _ = filepath.EvalSymlinks(exe)
	var settings struct {
		Hooks map[string][]struct {
			Hooks []struct {
				Command string `json:"command"`
			} `json:"hooks"`
		} `json:"hooks"`
	}
	if err := json.Unmarshal(b, &settings); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, ev := range hook.Events {
		for _, entry := range settings.Hooks[ev] {
			for _, h := range entry.Hooks {
				if h.Command == exe {
					n++
				}
			}
		}
	}
	return n
}

func TestHookWanted(t *testing.T) {
	list := []accounts.Account{{Dir: "/a"}, {Dir: "/b"}, {Dir: "/c"}}
	cases := []struct {
		name   string
		list   []accounts.Account
		hooked []string
		want   bool
	}{
		{"no accounts at all", nil, nil, false},
		{"in every account", list, []string{"/a", "/b", "/c"}, true},
		{"in one of three: it was switched on", list, []string{"/b"}, true},
		{"in none", list, nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := hookWanted(c.list, func(d string) bool { return slices.Contains(c.hooked, d) }); got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

func TestNewcomers(t *testing.T) {
	a := accounts.Account{Name: "claude", Dir: "/h/.claude"}
	b := accounts.Account{Name: "claude2", Dir: "/h/.claude2"}
	c4 := accounts.Account{Name: "claude4", Dir: "/h/.claude4"}
	cases := []struct {
		name          string
		before, after []accounts.Account
		want          []string
	}{
		{"nothing new", []accounts.Account{a, b}, []accounts.Account{a, b}, nil},
		{"one arrived", []accounts.Account{a, b}, []accounts.Account{a, b, c4}, []string{"claude4"}},
		{"one left", []accounts.Account{a, b}, []accounts.Account{a}, nil},
		{"from nothing", nil, []accounts.Account{a}, []string{"claude"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var got []string
			for _, n := range newcomers(c.before, c.after) {
				got = append(got, n.Name)
			}
			if !slices.Equal(got, c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

func TestShareChoice(t *testing.T) {
	home, _ := pageHome(t)
	three := accounts.Discover()
	for _, n := range []string{".apart1", ".apart2"} {
		if err := os.MkdirAll(filepath.Join(home, n, "projects"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	apart := []accounts.Account{
		{Name: "apart1", Dir: filepath.Join(home, ".apart1")},
		{Name: "apart2", Dir: filepath.Join(home, ".apart2")},
	}
	yes, no := true, false
	cases := []struct {
		name  string
		list  []accounts.Account
		share *bool
		want  bool
	}{
		{"asked to share", apart, &yes, true},
		{"asked not to", three, &no, false},
		{"not asked, and the others share", three, nil, true},
		{"not asked, and the others do not", apart, nil, false},
		{"not asked, and nobody is there", nil, nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := shareChoice(c.list, c.share); got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

func TestForgetLimits(t *testing.T) {
	c := &Core{}
	c.limitsAt = time.Now()
	c.forgetLimits()
	if !c.limitsAt.IsZero() {
		t.Fatal("the usage readout is still taken as fresh")
	}
}

func TestAccountsForPage(t *testing.T) {
	pageHome(t, ".claude")
	list := accounts.Discover()
	failed := errors.New("refused")
	cases := []struct {
		name  string
		list  []accounts.Account
		err   error
		count int
	}{
		{"a refusal passes through with no list", list, failed, 0},
		{"a list comes back with what the disk says", list, nil, 3},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := accountsForPage(c.list, c.err)
			if !errors.Is(err, c.err) || len(got) != c.count {
				t.Fatalf("got %d accounts and %v", len(got), err)
			}
			for _, a := range got {
				if a.State == nil {
					t.Fatalf("%s came back without its state", a.Name)
				}
			}
			if c.err == nil && !got[0].State.Hook {
				t.Fatal("the hook in the first account was not reported")
			}
		})
	}
}

// Created from the page: the next free directory, the shared history by
// default, and the hook whenever it is in the accounts already there.
func TestCreateAccountHooksAndSharesTheNewcomer(t *testing.T) {
	cases := []struct {
		name   string
		hooked []string
		want   bool
	}{
		{"hook in all three", []string{".claude", ".claude2", ".claude3"}, true},
		{"hook in one of them", []string{".claude2"}, true},
		{"hook in none", nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			home, store := pageHome(t, c.hooked...)
			core := pageCore(t, home)

			acc, list, err := core.CreateAccount("", nil)
			if err != nil {
				t.Fatal(err)
			}
			if acc.Dir != filepath.Join(home, ".claude4") || len(list) != 4 {
				t.Fatalf("created %s, %d accounts", acc.Dir, len(list))
			}
			projects := filepath.Join(acc.Dir, "projects")
			if real, _ := filepath.EvalSymlinks(projects); real != store {
				t.Fatalf("%s reads %q, not the shared %s", projects, real, store)
			}
			if acc.State == nil || len(acc.State.SharedWith) != 3 {
				t.Fatalf("the new account does not say it shares with three: %+v", acc.State)
			}
			got := hookEntries(t, acc.Dir)
			if c.want && got != len(hook.Events) {
				t.Fatalf("the hook is in %d of %d events of the new account", got, len(hook.Events))
			}
			if !c.want {
				if _, err := os.Stat(filepath.Join(acc.Dir, "settings.json")); !errors.Is(err, fs.ErrNotExist) {
					t.Fatal("the hook was put into a new account while it is switched off everywhere else")
				}
			}
		})
	}
}

// Added with a folder of its own, joined later, and the refusal that leaves a
// folder holding conversations exactly as it was.
func TestAddAccountAndShareLater(t *testing.T) {
	home, store := pageHome(t, ".claude", ".claude2", ".claude3")
	core := pageCore(t, home)
	no := false
	// Made only once the list is saved: before that, discovery probes the
	// numbered siblings and would take .claude5 in as an account of its own.
	holding := filepath.Join(home, ".claude5", "projects", "-w", "c.jsonl")
	holdingFolder := func() {
		if err := os.MkdirAll(filepath.Dir(holding), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(holding, []byte("{}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	steps := []struct {
		name   string
		do     func() ([]accounts.Account, error)
		code   string
		count  int
		shares map[string]int
	}{
		{"added with its own history", func() ([]accounts.Account, error) { return core.AddAccount("~/.claude4", "", &no) },
			"", 4, map[string]int{"claude4": 0, "claude": 2}},
		{"joined to the shared history later", func() ([]accounts.Account, error) { return core.ShareAccountHistory("claude4") },
			"", 4, map[string]int{"claude4": 3, "claude": 3}},
		{"a folder holding conversations is refused when added sharing by default", func() ([]accounts.Account, error) {
			holdingFolder()
			return core.AddAccount("~/.claude5", "", nil)
		},
			uierr.New("err.account.projectsNotEmpty").Error(), 4, nil},
		{"and the page still shows four", func() ([]accounts.Account, error) { return core.AccountsShown(), nil },
			"", 4, map[string]int{"claude4": 3}},
	}
	for _, s := range steps {
		t.Run(s.name, func(t *testing.T) {
			list, err := s.do()
			code, _, _ := strings.Cut(errString(err), uierr.Sep)
			if code != s.code {
				t.Fatalf("got %v, want %q", err, s.code)
			}
			if err != nil {
				list = core.AccountsShown()
			}
			if len(list) != s.count {
				t.Fatalf("%d accounts, want %d", len(list), s.count)
			}
			for _, a := range list {
				if want, ok := s.shares[a.Name]; ok && len(a.State.SharedWith) != want {
					t.Fatalf("%s shares with %v, want %d others", a.Name, a.State.SharedWith, want)
				}
			}
		})
	}
	if real, _ := filepath.EvalSymlinks(filepath.Join(home, ".claude4", "projects")); real != store {
		t.Fatalf("claude4 reads %q after joining", real)
	}
	if hookEntries(t, filepath.Join(home, ".claude4")) != len(hook.Events) {
		t.Fatal("an existing directory taken into the list was not given the hook")
	}
	if _, err := os.Stat(holding); err != nil {
		t.Fatalf("the refused account's conversation is gone: %v", err)
	}
	if info, _ := os.Lstat(filepath.Join(home, ".claude5", "projects")); info == nil || info.Mode()&os.ModeSymlink != 0 {
		t.Fatal("the refused account's folder was turned into a link")
	}
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
