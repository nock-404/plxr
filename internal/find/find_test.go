package find

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func tree(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, text := range files {
		full := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestFindsPlainTextAndSaysWhere(t *testing.T) {
	dir := tree(t, map[string]string{
		"a.go":      "package a\n\nfunc Hello() {}\n",
		"sub/b.txt": "nothing\nhello there\n",
		"c.md":      "HELLO in capitals\n",
	})
	r, err := Search(dir, Query{Text: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Hits) != 3 {
		t.Fatalf("expected three lines, got %d: %+v", len(r.Hits), r.Hits)
	}
	if r.Files != 3 {
		t.Fatalf("expected three files, got %d", r.Files)
	}
	for _, h := range r.Hits {
		if filepath.IsAbs(h.Path) {
			t.Fatalf("path should be relative to the folder: %q", h.Path)
		}
		if len(h.Ranges) == 0 {
			t.Fatalf("a hit with no range: %+v", h)
		}
		got := h.Text[h.Ranges[0][0]:h.Ranges[0][1]]
		if !strings.EqualFold(got, "hello") {
			t.Fatalf("the range does not sit on the match: %q in %q", got, h.Text)
		}
	}
}

func TestCaseAndWordAndGlob(t *testing.T) {
	dir := tree(t, map[string]string{
		"one.go":  "Hello\nhello\nhelloworld\n",
		"two.txt": "hello\n",
	})
	if r, _ := Search(dir, Query{Text: "hello", Case: true}); len(r.Hits) != 3 {
		t.Fatalf("case-sensitive: expected three, got %d", len(r.Hits))
	}
	// A word, so helloworld is not one.
	if r, _ := Search(dir, Query{Text: "hello", Word: true}); len(r.Hits) != 3 {
		t.Fatalf("whole word: expected three, got %+v", r.Hits)
	}
	if r, _ := Search(dir, Query{Text: "hello", Glob: "*.go"}); len(r.Hits) != 3 {
		t.Fatalf("glob *.go: expected three, got %+v", r.Hits)
	}
	if r, _ := Search(dir, Query{Text: "hello", Glob: "*.txt"}); len(r.Hits) != 1 {
		t.Fatalf("glob *.txt: expected one, got %+v", r.Hits)
	}
}

func TestBinaryAndBigFilesAreLeftOut(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "pic.bin"), append([]byte("hello"), 0, 1, 2), 0o644); err != nil {
		t.Fatal(err)
	}
	big := strings.Repeat("hello\n", MaxFileSize/6+10)
	if err := os.WriteFile(filepath.Join(dir, "big.txt"), []byte(big), 0o644); err != nil {
		t.Fatal(err)
	}
	r, err := Search(dir, Query{Text: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Hits) != 0 {
		t.Fatalf("read something it should not have: %+v", r.Hits)
	}
	var said bool
	for _, c := range r.Capped {
		if c == "size" {
			said = true
		}
	}
	if !said {
		t.Fatalf("a file was skipped for its size and the report does not say so: %+v", r.Capped)
	}
}

func TestALongLineIsCutAndTheRangesWithIt(t *testing.T) {
	dir := tree(t, map[string]string{
		"long.txt": strings.Repeat("x", MaxLineLen+50) + "hello\n",
	})
	r, err := Search(dir, Query{Text: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	// The match sits past the cut, so there is a hit with no range — and the
	// report says the line was cut rather than leaving somebody to wonder.
	if len(r.Hits) != 1 {
		t.Fatalf("expected one hit, got %d", len(r.Hits))
	}
	if len(r.Hits[0].Text) > MaxLineLen {
		t.Fatalf("line was not cut: %d characters", len(r.Hits[0].Text))
	}
	for _, rg := range r.Hits[0].Ranges {
		if rg[1] > len(r.Hits[0].Text) {
			t.Fatalf("a range points past the text: %v in %d", rg, len(r.Hits[0].Text))
		}
	}
	var said bool
	for _, c := range r.Capped {
		if c == "line" {
			said = true
		}
	}
	if !said {
		t.Fatalf("a line was cut and the report does not say so: %+v", r.Capped)
	}
}

func TestGitDecidesWhatIsIgnored(t *testing.T) {
	dir := tree(t, map[string]string{
		".gitignore":        "secret/\n",
		"open.txt":          "hello\n",
		"secret/hidden.txt": "hello\n",
	})
	cmd := exec.Command("git", "-C", dir, "init", "-q", ".")
	if err := cmd.Run(); err != nil {
		t.Skipf("no git here: %v", err)
	}
	r, err := Search(dir, Query{Text: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range r.Hits {
		if strings.HasPrefix(h.Path, "secret/") {
			t.Fatalf("an ignored file was searched: %q", h.Path)
		}
	}
	if len(r.Hits) != 1 {
		t.Fatalf("expected the one open file, got %+v", r.Hits)
	}
}

func TestABadPatternIsAnError(t *testing.T) {
	dir := tree(t, map[string]string{"a.txt": "hello\n"})
	if _, err := Search(dir, Query{Text: "([", Regex: true}); err == nil {
		t.Fatalf("a broken expression was accepted")
	}
}
