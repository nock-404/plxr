package files

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/* Ways this package could destroy work, each one found by reading it and then
 * proved here before it was fixed.
 */

// A file too big to be read whole must not be writable through the editor.
//
// Read stops at MaxRead and marks the answer truncated. Write took that same
// text back and renamed it over the original, so one save on a 600 KB file cut
// it down to 512 KB — the rest was gone, with nothing said.
func TestSavingATruncatedFileIsRefused(t *testing.T) {
	root := t.TempDir()
	name := filepath.Join(root, "big.md")
	body := strings.Repeat("a line of perfectly ordinary text\n", 20000) // ~660 KB
	if err := os.WriteFile(name, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	before, _ := os.Stat(name)

	c, err := Read(root, name)
	if err != nil {
		t.Fatal(err)
	}
	if !c.Truncated {
		t.Fatalf("a %d byte file was not reported as truncated", before.Size())
	}

	if _, err := Write(root, name, c.Text+"x", c.Mod); err == nil {
		after, _ := os.Stat(name)
		t.Fatalf("the save went through: %d bytes became %d — %d bytes of the user's file are gone",
			before.Size(), after.Size(), before.Size()-after.Size())
	}
	after, _ := os.Stat(name)
	if after.Size() != before.Size() {
		t.Fatalf("the file changed size although the save was refused: %d -> %d", before.Size(), after.Size())
	}
}

// Deleting a link deletes the link, never what it points at.
func TestDeletingALinkKeepsItsTarget(t *testing.T) {
	root := t.TempDir()
	real := filepath.Join(root, "releases")
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatal(err)
	}
	keep := filepath.Join(real, "important.txt")
	if err := os.WriteFile(keep, []byte("work"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "current")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}

	if err := Remove(root, link); err != nil {
		t.Fatalf("the link could not be deleted: %v", err)
	}
	if _, err := os.Lstat(link); err == nil {
		t.Error("the link is still there — something else was deleted instead")
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatalf("deleting the link took the real directory with it: %v", err)
	}
}

// Renaming a link renames the link.
func TestRenamingALinkLeavesItsTargetWhereItIs(t *testing.T) {
	root := t.TempDir()
	real := filepath.Join(root, "releases")
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "current")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}

	if _, err := Rename(root, link, "previous"); err != nil {
		t.Fatalf("the link could not be renamed: %v", err)
	}
	if _, err := os.Lstat(real); err != nil {
		t.Fatalf("the real directory was moved instead of the link: %v", err)
	}
	if fi, err := os.Lstat(filepath.Join(root, "previous")); err != nil || fi.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("the new name is not a link: %v", err)
	}
}

// A text file whose 512 KB mark falls inside a character is still a text file.
func TestACutInsideACharacterDoesNotMakeItBinary(t *testing.T) {
	root := t.TempDir()
	name := filepath.Join(root, "notes.md")
	// The euro sign is three bytes; put its first byte at the very last
	// position the reader takes.
	body := strings.Repeat("a", MaxRead-1) + "€" + strings.Repeat("b", 1000)
	if err := os.WriteFile(name, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := Read(root, name)
	if err != nil {
		t.Fatal(err)
	}
	if c.Binary {
		t.Fatal("an ordinary text file was declared binary because the read stopped mid-character")
	}
	if c.Lines == 0 || c.Text == "" {
		t.Fatalf("nothing to show: lines=%d text=%d bytes", c.Lines, len(c.Text))
	}
}
