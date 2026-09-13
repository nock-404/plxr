package folder

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func put(t *testing.T, dir, name, text string) {
	t.Helper()
	full := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSurveyCountsWhatIsThere(t *testing.T) {
	dir := t.TempDir()
	put(t, dir, "main.go", "package main\n")
	put(t, dir, "lib/one.go", "package lib\n")
	put(t, dir, "lib/two.go", "package lib\n")
	put(t, dir, "web/app.ts", "export const a = 1;\n")
	put(t, dir, "notes.txt", "nothing in particular\n")

	f := Survey(dir)
	if f.Files != 5 {
		t.Fatalf("files: %d", f.Files)
	}
	if f.Folders != 2 {
		t.Fatalf("folders: %d", f.Folders)
	}
	if f.Size <= 0 {
		t.Fatalf("size: %d", f.Size)
	}
	if f.Touched <= 0 {
		t.Fatalf("touched: %d", f.Touched)
	}
	if f.Partial {
		t.Fatal("a five-file folder was reported as partially walked")
	}
	// Three .go against one .ts, and .txt says nothing about a language.
	if len(f.Languages) != 2 {
		t.Fatalf("languages: %+v", f.Languages)
	}
	if f.Languages[0].Name != "Go" || f.Languages[0].Files != 3 || f.Languages[0].Share != 75 {
		t.Fatalf("first language: %+v", f.Languages[0])
	}
	if f.Languages[1].Name != "TypeScript" || f.Languages[1].Share != 25 {
		t.Fatalf("second language: %+v", f.Languages[1])
	}
}

/* The whole point of leaving some directories out.
 *
 * A folder with node_modules in it is four fifths somebody else's JavaScript.
 * Counted, the answer to "what is this written in" for a Go project is
 * "JavaScript" — which is worse than no answer, because it looks like one.
 */
func TestSurveyLeavesTheNoiseOutAndSaysSo(t *testing.T) {
	dir := t.TempDir()
	put(t, dir, "main.go", "package main\n")
	for i := 0; i < 20; i++ {
		put(t, dir, filepath.Join("node_modules", "pkg", string(rune('a'+i))+".js"), "module.exports = 1;\n")
	}
	put(t, dir, "dist/bundle.js", "// built\n")
	put(t, dir, ".git/HEAD", "ref: refs/heads/main\n")

	f := Survey(dir)
	if f.Files != 1 {
		t.Fatalf("the noise was counted: %d files", f.Files)
	}
	if len(f.Languages) != 1 || f.Languages[0].Name != "Go" {
		t.Fatalf("languages: %+v", f.Languages)
	}
	// What was left out is named, so the count can be read for what it is.
	if !strings.Contains(strings.Join(f.Ignored, ","), "node_modules") {
		t.Fatalf("ignored: %+v", f.Ignored)
	}
	if !strings.Contains(strings.Join(f.Ignored, ","), "dist") {
		t.Fatalf("ignored: %+v", f.Ignored)
	}
	// .git is never named: it is left out of every count and nobody is
	// surprised by that.
	for _, name := range f.Ignored {
		if name == ".git" {
			t.Fatalf("ignored names .git: %+v", f.Ignored)
		}
	}
}

func TestSurveyFindsAReadmeWhateverItIsCalled(t *testing.T) {
	for _, name := range []string{"README.md", "readme.txt", "README", "ReadMe.markdown"} {
		dir := t.TempDir()
		put(t, dir, name, "the beginning\nand more\n")
		f := Survey(dir)
		if f.ReadmePath != name {
			t.Fatalf("%s was not found: %q", name, f.ReadmePath)
		}
		if !strings.HasPrefix(f.Readme, "the beginning") {
			t.Fatalf("%s read as %q", name, f.Readme)
		}
		if f.ReadmeMore {
			t.Fatalf("%s: a short file was reported as cut off", name)
		}
	}
}

// Markdown wins when there is more than one, because that is the one people
// write; and nothing at all is an empty answer, not a wrong one.
func TestSurveyPrefersTheMarkdownReadmeAndCopesWithNone(t *testing.T) {
	dir := t.TempDir()
	put(t, dir, "README", "the plain one\n")
	put(t, dir, "README.md", "the markdown one\n")
	if got := Survey(dir); got.ReadmePath != "README.md" {
		t.Fatalf("picked %q", got.ReadmePath)
	}

	bare := t.TempDir()
	put(t, bare, "a.txt", "nothing\n")
	f := Survey(bare)
	if f.Readme != "" || f.ReadmePath != "" || f.ReadmeMore {
		t.Fatalf("a folder with no README reported %q from %q", f.Readme, f.ReadmePath)
	}
}

func TestSurveyCutsALongReadmeAndSaysThatToo(t *testing.T) {
	dir := t.TempDir()
	put(t, dir, "README.md", strings.Repeat("a line of readme\n", 2000))
	f := Survey(dir)
	if len(f.Readme) != ReadmeMax {
		t.Fatalf("read %d bytes", len(f.Readme))
	}
	if !f.ReadmeMore {
		t.Fatal("a cut-off README did not say so")
	}
}

// A README that is not text is not one to put on a screen.
func TestSurveyRefusesAReadmeThatIsNotText(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "README"), []byte{0xff, 0xfe, 0x00, 0x01, 0xff}, 0o644); err != nil {
		t.Fatal(err)
	}
	if f := Survey(dir); f.Readme != "" {
		t.Fatalf("a binary README came back as %q", f.Readme)
	}
}

// An empty folder is an ordinary folder: nothing is claimed about it that is
// not true, and nothing crashes.
func TestSurveyOfAnEmptyFolder(t *testing.T) {
	f := Survey(t.TempDir())
	if f.Files != 0 || f.Folders != 0 || f.Size != 0 {
		t.Fatalf("%+v", f)
	}
	if f.Languages == nil || f.Ignored == nil {
		t.Fatalf("a list came back nil: %+v", f)
	}
	if f.Partial {
		t.Fatal("an empty folder was reported as partially walked")
	}
}

// A directory that cannot be read is skipped rather than taking the answer
// down with it.
func TestSurveyWalksPastWhatItCannotRead(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root reads everything")
	}
	dir := t.TempDir()
	put(t, dir, "a.go", "package a\n")
	shut := filepath.Join(dir, "shut")
	if err := os.Mkdir(shut, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(shut, 0o755) })

	f := Survey(dir)
	if f.Files != 1 {
		t.Fatalf("files: %d", f.Files)
	}
	if len(f.Languages) != 1 || f.Languages[0].Name != "Go" {
		t.Fatalf("languages: %+v", f.Languages)
	}
}
