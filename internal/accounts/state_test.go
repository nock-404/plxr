package accounts

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestStateFile(t *testing.T) {
	home := fakeHome(t)
	cases := []struct {
		name string
		dir  string
		want string
	}{
		{"the default account keeps it beside the directory", filepath.Join(home, ".claude"), filepath.Join(home, ".claude.json")},
		{"a numbered account keeps it inside", filepath.Join(home, ".claude2"), filepath.Join(home, ".claude2", ".claude.json")},
		{"a directory anywhere else keeps it inside", "/work/acct", "/work/acct/.claude.json"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := StateFile(Account{Dir: c.dir}); got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestReadState(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		name     string
		body     string
		absent   bool
		folder   bool
		signedIn bool
		usageAt  int64
	}{
		{name: "no file at all", absent: true},
		{name: "a folder where the file should be", folder: true},
		{name: "not JSON", body: "{ half"},
		{name: "nothing of ours in it", body: `{"numStartups":3}`},
		{name: "signed in", body: `{"oauthAccount":{"accountUuid":"not-read"}}`, signedIn: true},
		{name: "the key alone decides, whatever it holds", body: `{"oauthAccount":null}`, signedIn: true},
		{name: "a usage reading and no sign-in", body: `{"cachedUsageUtilization":{"fetchedAtMs":1757750000123}}`, usageAt: 1757750000123},
		{name: "both", body: `{"oauthAccount":{},"cachedUsageUtilization":{"fetchedAtMs":42}}`, signedIn: true, usageAt: 42},
		{name: "a reading of an odd shape does not hide the sign-in", body: `{"oauthAccount":{},"cachedUsageUtilization":"soon"}`, signedIn: true},
	}
	for i, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			path := filepath.Join(dir, fmt.Sprintf("%d.json", i))
			switch {
			case c.folder:
				must(t, os.MkdirAll(path, 0o755))
			case !c.absent:
				put(t, path, c.body)
			}
			signedIn, usageAt := readState(path)
			if signedIn != c.signedIn || usageAt != c.usageAt {
				t.Fatalf("got signedIn=%v usageAt=%d, want %v %d", signedIn, usageAt, c.signedIn, c.usageAt)
			}
		})
	}
}

// The sign-in is a key, and what it holds has nowhere to go: the field that
// receives it is a bool. Should somebody widen it to a struct or a string, the
// signed-in account would be decoded into memory — this says so first.
func TestTheSignInIsReadAsAKeyAndNothingMore(t *testing.T) {
	f, ok := reflect.TypeOf(stateOnDisk{}).FieldByName("SignedIn")
	if !ok {
		t.Fatal("no SignedIn field")
	}
	if f.Type.Kind() != reflect.Bool {
		t.Fatalf("the sign-in is decoded into a %s, which can hold what the key holds", f.Type.Kind())
	}
}

// The answer is kept against the file's size and time, and a changed file is
// read again — a sign-in finishing is exactly such a change.
func TestReadStateSeesTheFileChange(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".claude.json")
	steps := []struct {
		body     string
		signedIn bool
	}{
		{`{}`, false},
		{`{}`, false},
		{`{"oauthAccount":{"emailAddress":"x"}}`, true},
		{`{"numStartups":1}`, false},
	}
	for i, s := range steps {
		put(t, path, s.body)
		if got, _ := readState(path); got != s.signedIn {
			t.Fatalf("step %d: signedIn=%v, want %v", i, got, s.signedIn)
		}
	}
}

func TestDescribe(t *testing.T) {
	home := fakeHome(t)
	three, _ := hisMachine(t, home)
	four := own(t, home, "claude4")
	list := append(three, four)
	put(t, filepath.Join(home, ".claude.json"), `{"oauthAccount":{"x":1},"cachedUsageUtilization":{"fetchedAtMs":1000}}`)
	put(t, filepath.Join(home, ".claude2", ".claude.json"), `{"oauthAccount":{}}`)
	// claude3: nothing on disk, as after it was made and never signed in to.
	put(t, filepath.Join(home, ".claude4", ".claude.json"), `{"cachedUsageUtilization":{"fetchedAtMs":4000}}`)
	hooked := func(dir string) bool { return dir != four.Dir }

	got := Describe(list, hooked)
	want := []State{
		{SignedIn: true, Hook: true, Projects: "~/.claude/projects", SharedWith: []string{"claude2", "claude3"}, UsageAt: 1000, File: "~/.claude.json"},
		{SignedIn: true, Hook: true, Projects: "~/.claude/projects", SharedWith: []string{"claude", "claude3"}, File: "~/.claude2/.claude.json"},
		{Hook: true, Projects: "~/.claude/projects", SharedWith: []string{"claude", "claude2"}, File: "~/.claude3/.claude.json"},
		{Projects: "~/.claude4/projects", SharedWith: []string{}, UsageAt: 4000, File: "~/.claude4/.claude.json"},
	}
	for i := range want {
		t.Run(list[i].Name, func(t *testing.T) {
			if got[i].State == nil {
				t.Fatal("no state")
			}
			if !reflect.DeepEqual(*got[i].State, want[i]) {
				t.Fatalf("got %+v\nwant %+v", *got[i].State, want[i])
			}
		})
	}
	if list[0].State != nil {
		t.Fatal("Describe wrote into the list it was handed")
	}
	if Describe(list, nil)[0].State.Hook {
		t.Fatal("with nobody to ask, the hook was reported as there")
	}
}

func TestSaveKeepsNoState(t *testing.T) {
	home := fakeHome(t)
	three, _ := hisMachine(t, home)
	must(t, Save(Describe(three, func(string) bool { return true })))
	b, err := os.ReadFile(configPath())
	must(t, err)
	if bytes.Contains(b, []byte(`"state"`)) {
		t.Fatalf("the saved list carries what the disk said: %s", b)
	}
	for _, a := range Discover() {
		if a.State != nil {
			t.Fatalf("%s came back from the saved list with a state", a.Name)
		}
	}
}
