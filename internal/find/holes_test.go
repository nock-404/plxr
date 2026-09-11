package find

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

/* Five ways the search answered wrongly, each read out of the code and proved
 * here before it was fixed.
 */

func repo(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := tree(t, files)
	if err := exec.Command("git", "-C", dir, "init", "-q", ".").Run(); err != nil {
		t.Skipf("no git here: %v", err)
	}
	return dir
}

func has(r Report, what string) bool {
	for _, c := range r.Capped {
		if c == what {
			return true
		}
	}
	return false
}

// A link inside the folder must not let the search read outside it.
func TestALinkDoesNotReachOutOfTheFolder(t *testing.T) {
	outside := filepath.Join(t.TempDir(), "id_rsa")
	if err := os.WriteFile(outside, []byte("PRIVATE MATERIAL\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	dir := repo(t, map[string]string{"readme.md": "nothing here\n"})
	if err := os.Symlink(outside, filepath.Join(dir, "key")); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}
	r, err := Search(dir, Query{Text: "PRIVATE MATERIAL"})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Hits) != 0 {
		t.Fatalf("a file outside the folder was read through a link: %+v", r.Hits)
	}
}

// WORD has to work for words that do not begin or end in ASCII.
func TestWordMatchesBeyondASCII(t *testing.T) {
	dir := tree(t, map[string]string{"a.txt": "über alles\nüberhaupt nicht\ncafé\nhello()\n"})
	for _, q := range []string{"über", "café", "hello()"} {
		r, err := Search(dir, Query{Text: q, Word: true})
		if err != nil {
			t.Fatal(err)
		}
		if len(r.Hits) != 1 {
			t.Fatalf("WORD %q found %d lines, expected the one whole-word line: %+v", q, len(r.Hits), r.Hits)
		}
	}
	// And the ordinary case still holds: a word inside a longer one is not it.
	r, _ := Search(dir, Query{Text: "haupt", Word: true})
	if len(r.Hits) != 0 {
		t.Fatalf("WORD matched inside a longer word: %+v", r.Hits)
	}
}

// The glob narrows the set before the ceiling cuts it.
func TestTheGlobComesBeforeTheCeiling(t *testing.T) {
	old := MaxFiles
	MaxFiles = 50
	defer func() { MaxFiles = old }()
	files := map[string]string{}
	for i := 0; i < 60; i++ {
		files[filepath.Join("aaa", strings.Repeat("x", 3)+string(rune('a'+i%26))+strings.Repeat("y", i/26)+".txt")] = "filler\n"
	}
	files["zzz/target.go"] = "the needle is here\n"
	dir := tree(t, files)
	r, err := Search(dir, Query{Text: "needle", Glob: "*.go"})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Hits) != 1 {
		t.Fatalf("the one file the glob selects was cut off by the ceiling: %d hits, capped=%v", len(r.Hits), r.Capped)
	}
}

// A folder that its own repository ignores can still be searched.
func TestAnIgnoredFolderIsStillSearched(t *testing.T) {
	dir := repo(t, map[string]string{
		".gitignore":      "build/\n",
		"build/notes.txt": "hello from the build\n",
	})
	r, err := Search(filepath.Join(dir, "build"), Query{Text: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Hits) != 1 {
		t.Fatalf("the ignored folder answered nothing: %+v", r)
	}
}

// Without git the ignore rules cannot be applied, and that has to be said.
func TestMissingGitIsSaid(t *testing.T) {
	dir := repo(t, map[string]string{
		".gitignore": ".env\n",
		".env":       "SECRET=hello\n",
		"a.txt":      "hello\n",
	})
	t.Setenv("PATH", t.TempDir())
	r, err := Search(dir, Query{Text: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if !has(r, "ignore") {
		t.Fatalf("git is gone, the ignore rules were not applied, and the report does not say so: %+v", r.Capped)
	}
}

// A long line is cut between characters, never inside one.
func TestALongLineIsCutBetweenCharacters(t *testing.T) {
	line := strings.Repeat("€", MaxLineLen) + "\n" // three bytes each: 400 is not a multiple
	dir := tree(t, map[string]string{"a.txt": line})
	r, err := Search(dir, Query{Text: "€"})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Hits) == 0 {
		t.Fatal("no hit")
	}
	for _, h := range r.Hits {
		if !strings.HasSuffix(h.Text, "€") {
			t.Fatalf("the cut landed inside a character: %q", h.Text[len(h.Text)-4:])
		}
	}
}
