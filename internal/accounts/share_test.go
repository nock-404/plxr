package accounts

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"plxr/internal/uierr"
)

// fakeHome is a home of the test's own, with the temporary directory's links
// resolved: on macOS it lives under /var, which is a link to /private/var, and
// a store compared against an unresolved home would never match.
func fakeHome(t *testing.T) string {
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
	return home
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func put(t *testing.T, path, body string) {
	t.Helper()
	must(t, os.MkdirAll(filepath.Dir(path), 0o755))
	must(t, os.WriteFile(path, []byte(body), 0o644))
}

// hisMachine is the arrangement on the machine this was built for: three
// accounts, the second and third reading the first one's projects folder, one
// conversation in it. It answers with the accounts and that folder.
func hisMachine(t *testing.T, home string) ([]Account, string) {
	t.Helper()
	store := filepath.Join(home, ".claude", "projects")
	put(t, filepath.Join(store, "-work", "a1.jsonl"), "{}\n")
	for _, n := range []string{".claude2", ".claude3"} {
		must(t, os.MkdirAll(filepath.Join(home, n), 0o755))
		must(t, os.Symlink(store, filepath.Join(home, n, "projects")))
	}
	return []Account{
		{Name: "claude", Number: 1, Dir: filepath.Join(home, ".claude")},
		{Name: "claude2", Number: 2, Dir: filepath.Join(home, ".claude2")},
		{Name: "claude3", Number: 3, Dir: filepath.Join(home, ".claude3")},
	}, store
}

// own makes an account with a projects folder of its own, holding the files
// named.
func own(t *testing.T, home, name string, files ...string) Account {
	t.Helper()
	dir := filepath.Join(home, "."+name)
	must(t, os.MkdirAll(filepath.Join(dir, "projects"), 0o755))
	for _, f := range files {
		put(t, filepath.Join(dir, "projects", f), "{}\n")
	}
	return Account{Name: name, Dir: dir}
}

// codeOf is the code an error reaches the window as, without its detail.
func codeOf(err error) string {
	if err == nil {
		return ""
	}
	code, _, _ := strings.Cut(err.Error(), uierr.Sep)
	return code
}

func isLink(t *testing.T, p string) bool {
	t.Helper()
	info, err := os.Lstat(p)
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeSymlink != 0
}

func TestStore(t *testing.T) {
	home := fakeHome(t)
	three, store := hisMachine(t, home)
	apart := own(t, home, "claude4")
	holding := own(t, home, "claude5", "-x/b.jsonl")
	missing := Account{Name: "claude6", Dir: filepath.Join(home, ".claude6")}

	cases := []struct {
		name   string
		list   []Account
		skip   string
		dir    string
		shared bool
	}{
		{"nobody at all", nil, "", "", false},
		{"one account on its own", three[:1], "", store, false},
		{"his three accounts read the first one's folder", three, "", store, true},
		{"with the first left out the other two still share it", three, "claude", store, true},
		{"two accounts apart: the first listed", []Account{apart, holding}, "", filepath.Join(apart.Dir, "projects"), false},
		{"a folder that is not there is nobody's store", []Account{missing}, "", "", false},
		{"the most readers win over the first listed", append([]Account{apart}, three...), "", store, true},
		{"asking for itself it finds the others", []Account{apart, three[0]}, "claude4", store, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dir, shared := Store(c.list, c.skip)
			if dir != c.dir || shared != c.shared {
				t.Fatalf("got %q shared=%v, want %q shared=%v", dir, shared, c.dir, c.shared)
			}
		})
	}
}

func TestLinkable(t *testing.T) {
	home := fakeHome(t)
	_, store := hisMachine(t, home)
	elsewhere := filepath.Join(home, "elsewhere")
	must(t, os.MkdirAll(elsewhere, 0o755))
	linkTo := func(target string) func(*testing.T, string) {
		return func(t *testing.T, p string) {
			must(t, os.MkdirAll(filepath.Dir(p), 0o755))
			must(t, os.Symlink(target, p))
		}
	}

	cases := []struct {
		name string
		make func(t *testing.T, p string)
		done bool
		code string
	}{
		{"not there yet", func(*testing.T, string) {}, false, ""},
		{"an empty folder", func(t *testing.T, p string) { must(t, os.MkdirAll(p, 0o755)) }, false, ""},
		{"a folder holding a conversation", func(t *testing.T, p string) { put(t, filepath.Join(p, "-w", "c.jsonl"), "{}") }, false, uierr.New("err.account.projectsNotEmpty").Error()},
		{"a folder holding only a hidden file", func(t *testing.T, p string) { put(t, filepath.Join(p, ".DS_Store"), "x") }, false, uierr.New("err.account.projectsNotEmpty").Error()},
		{"a file where the folder should be", func(t *testing.T, p string) { put(t, p, "x") }, false, uierr.New("err.account.projectsNotEmpty").Error()},
		{"a link to the store already", linkTo(store), true, ""},
		{"a link somewhere else", linkTo(elsewhere), false, uierr.New("err.account.projectsLinked").Error()},
		{"a link that leads nowhere", linkTo(filepath.Join(home, "gone")), false, uierr.New("err.account.projectsLinked").Error()},
	}
	for i, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := filepath.Join(home, fmt.Sprintf(".case%d", i), "projects")
			c.make(t, p)
			done, err := linkable(p, store)
			if done != c.done || codeOf(err) != c.code {
				t.Fatalf("got done=%v %q, want done=%v %q", done, codeOf(err), c.done, c.code)
			}
		})
	}
	t.Run("the store itself", func(t *testing.T) {
		if done, err := linkable(store, store); !done || err != nil {
			t.Fatalf("the store was not taken as already there: done=%v %v", done, err)
		}
	})
}

func TestLink(t *testing.T) {
	cases := []struct {
		name   string
		make   func(t *testing.T, p, store string)
		linked bool
		code   string
		kept   string
	}{
		{"not there: made a link", func(t *testing.T, p, _ string) { must(t, os.MkdirAll(filepath.Dir(p), 0o755)) }, true, "", ""},
		{"an empty folder: made a link", func(t *testing.T, p, _ string) { must(t, os.MkdirAll(p, 0o755)) }, true, "", ""},
		{"a folder holding a conversation: left as it was", func(t *testing.T, p, _ string) { put(t, filepath.Join(p, "-w", "c.jsonl"), "{}") }, false, uierr.New("err.account.projectsNotEmpty").Error(), "-w/c.jsonl"},
		{"a link to the store: left as it is", func(t *testing.T, p, store string) {
			must(t, os.MkdirAll(filepath.Dir(p), 0o755))
			must(t, os.Symlink(store, p))
		}, true, "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			home := fakeHome(t)
			_, store := hisMachine(t, home)
			p := filepath.Join(home, ".claude4", "projects")
			c.make(t, p, store)

			err := link(p, store)
			if codeOf(err) != c.code {
				t.Fatalf("got %v, want %q", err, c.code)
			}
			if c.linked {
				if !isLink(t, p) || resolved(p) != store {
					t.Fatalf("%s does not lead to %s", p, store)
				}
				return
			}
			if isLink(t, p) {
				t.Fatal("a refused folder was turned into a link")
			}
			if _, err := os.Stat(filepath.Join(p, c.kept)); err != nil {
				t.Fatalf("what the folder held is gone: %v", err)
			}
		})
	}
}

func TestShare(t *testing.T) {
	withThree := func(extra ...func(*testing.T, string) Account) func(*testing.T, string) []Account {
		return func(t *testing.T, home string) []Account {
			list, _ := hisMachine(t, home)
			for _, e := range extra {
				list = append(list, e(t, home))
			}
			return list
		}
	}
	ownFolder := func(files ...string) func(*testing.T, string) Account {
		return func(t *testing.T, home string) Account { return own(t, home, "claude4", files...) }
	}

	cases := []struct {
		name    string
		make    func(t *testing.T, home string) []Account
		account string
		code    string
		linked  bool
		kept    string
	}{
		{"an account with an empty folder of its own joins", withThree(ownFolder()), "claude4", "", true, ""},
		{"an account holding conversations is refused and left alone", withThree(ownFolder("-w/c.jsonl")), "claude4", uierr.New("err.account.projectsNotEmpty").Error(), false, "-w/c.jsonl"},
		{"an account that already shares stays as it is", withThree(), "claude2", "", true, ""},
		{"an account with nobody else to share with", func(t *testing.T, home string) []Account {
			return []Account{own(t, home, "claude4")}
		}, "claude4", uierr.New("err.account.noStore").Error(), false, ""},
		{"a name that is not in the list", withThree(), "claude9", uierr.New("err.account.unknown").Error(), false, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			home := fakeHome(t)
			list := c.make(t, home)
			must(t, Save(list))

			got, err := Share(c.account)
			if codeOf(err) != c.code {
				t.Fatalf("got %v, want %q", err, c.code)
			}
			if err == nil && len(got) != len(list) {
				t.Fatalf("the list came back with %d accounts, not %d", len(got), len(list))
			}
			projects := filepath.Join(home, "."+c.account, "projects")
			store := resolved(filepath.Join(home, ".claude", "projects"))
			if c.linked && resolved(projects) != store {
				t.Fatalf("%s does not read %s", projects, store)
			}
			if c.kept != "" {
				if isLink(t, projects) {
					t.Fatal("a folder holding conversations was turned into a link")
				}
				if _, err := os.Stat(filepath.Join(projects, c.kept)); err != nil {
					t.Fatalf("a conversation is gone: %v", err)
				}
			}
		})
	}
}

func TestAddShares(t *testing.T) {
	nothing := func(*testing.T, string) {}
	three := func(t *testing.T, home string) []Account {
		list, _ := hisMachine(t, home)
		return list
	}

	cases := []struct {
		name   string
		list   func(t *testing.T, home string) []Account
		before func(t *testing.T, home string)
		share  bool
		code   string
		linked bool
		count  int
	}{
		{"a fresh account joins the history", three, nothing, true, "", true, 4},
		{"a fresh account keeps its own when asked to", three, nothing, false, "", false, 4},
		{"an empty folder already there is linked", three, func(t *testing.T, home string) {
			must(t, os.MkdirAll(filepath.Join(home, ".claude4", "projects"), 0o755))
		}, true, "", true, 4},
		{"a folder holding a conversation is refused and nothing changes", three, func(t *testing.T, home string) {
			put(t, filepath.Join(home, ".claude4", "projects", "-w", "c.jsonl"), "{}")
		}, true, uierr.New("err.account.projectsNotEmpty").Error(), false, 3},
		{"sharing with nobody is refused before anything is made", func(*testing.T, string) []Account { return nil }, nothing, true, uierr.New("err.account.noStore").Error(), false, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			home := fakeHome(t)
			if list := c.list(t, home); list != nil {
				must(t, Save(list))
			}
			c.before(t, home)
			saved, _ := os.ReadFile(configPath())
			projects := filepath.Join(home, ".claude4", "projects")
			store := resolved(filepath.Join(home, ".claude", "projects"))

			got, err := Add("~/.claude4", "", c.share)
			if codeOf(err) != c.code {
				t.Fatalf("got %v, want %q", err, c.code)
			}
			if c.code != "" {
				after, _ := os.ReadFile(configPath())
				if !bytes.Equal(saved, after) {
					t.Fatal("a refused account changed the saved list")
				}
				if n := len(Discover()); n != c.count {
					t.Fatalf("%d accounts after a refusal, want %d", n, c.count)
				}
				if isLink(t, projects) {
					t.Fatal("a refused folder was turned into a link")
				}
				if c.code == uierr.New("err.account.noStore").Error() {
					if _, err := os.Stat(filepath.Join(home, ".claude4")); !errors.Is(err, fs.ErrNotExist) {
						t.Fatal("a refused account left a directory behind")
					}
				}
				return
			}
			if len(got) != c.count {
				t.Fatalf("%d accounts, want %d", len(got), c.count)
			}
			if c.linked != isLink(t, projects) {
				t.Fatalf("projects is a link: %v, want %v", isLink(t, projects), c.linked)
			}
			if c.linked && resolved(projects) != store {
				t.Fatalf("%s does not lead to %s", projects, store)
			}
			if !c.linked {
				if info, err := os.Stat(projects); err != nil || !info.IsDir() {
					t.Fatal("an account keeping its own history has no projects folder")
				}
			}
		})
	}
}
