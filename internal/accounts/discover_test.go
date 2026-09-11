package accounts

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

/* Discovery probes the known names; it never lists the home directory.
 *
 * Reading the whole of ~ is what macOS 15 flags as "wants to access data from
 * other apps", and the daemon did it after every start. plxr already knows the
 * only names an account can have — .claude and its numbered siblings — so those
 * are stat'd directly and nothing else in the home directory is touched.
 */
func TestDiscoverProbesTheKnownNamesOnly(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("PLXR_HOME", filepath.Join(home, ".plxr")) // so load() finds no saved list

	mk := func(name string) {
		if err := os.MkdirAll(filepath.Join(home, name, "projects"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	mk(".claude")       // account 1
	mk(".claude3")      // account 3
	mk(".claude-fleet") // another tool's dir — must be ignored
	mk(".claudezoo")    // not a numbered sibling — must be ignored
	mk(".config")       // unrelated — must be ignored

	got := Discover()
	sort.Slice(got, func(i, j int) bool { return got[i].Number < got[j].Number })
	if len(got) != 2 {
		names := []string{}
		for _, a := range got {
			names = append(names, a.Name)
		}
		t.Fatalf("expected .claude and .claude3, got %v", names)
	}
	if got[0].Name != "claude" || got[0].Number != 1 {
		t.Fatalf("first account wrong: %+v", got[0])
	}
	if got[1].Name != "claude3" || got[1].Number != 3 {
		t.Fatalf("second account wrong: %+v", got[1])
	}
}
