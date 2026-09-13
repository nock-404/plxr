package find

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func namesTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, rel := range []string{
		"frontend/lib/keymap.ts",
		"frontend/lib/keymap.test.mjs",
		"docs/keys.md",
		"internal/core/core.go",
		"node_modules/pkg/keymap.ts",
	} {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestNamesRanksTheFilesOwnNameFirst(t *testing.T) {
	root := namesTree(t)
	cases := []struct {
		q    string
		want []string
	}{
		{"keymap", []string{"frontend/lib/keymap.ts", "frontend/lib/keymap.test.mjs"}},
		{"core.go", []string{"internal/core/core.go"}},
		// Letters in order match further down the list as well; what matters is
		// which one leads.
		{"kmts", []string{"frontend/lib/keymap.ts"}},
		{"KEYS", []string{"docs/keys.md"}},
		{"nothing-like-this", []string{}},
	}
	for _, c := range cases {
		got, err := Names(root, c.q, 10)
		if err != nil {
			t.Fatalf("%q: %v", c.q, err)
		}
		if len(c.want) == 0 {
			if len(got.Paths) != 0 {
				t.Errorf("%q: got %v, want nothing", c.q, got.Paths)
			}
			continue
		}
		if len(got.Paths) < len(c.want) || !reflect.DeepEqual(got.Paths[:len(c.want)], c.want) {
			t.Errorf("%q: got %v, want it to start with %v", c.q, got.Paths, c.want)
		}
	}
}

func TestNamesStepsOverTheHeapsAndSaysWhenItIsShort(t *testing.T) {
	root := namesTree(t)
	all, err := Names(root, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range all.Paths {
		if filepath.Base(filepath.Dir(filepath.Dir(p))) == "node_modules" || p == "node_modules/pkg/keymap.ts" {
			t.Errorf("a file under node_modules was listed: %s", p)
		}
	}
	if all.Total != 4 {
		t.Errorf("considered %d files, want 4", all.Total)
	}
	short, err := Names(root, "", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(short.Paths) != 2 || !reflect.DeepEqual(short.Capped, []string{"names"}) {
		t.Errorf("limit 2: got %v capped %v, want two paths and capped [names]", short.Paths, short.Capped)
	}
}
