package archive

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"

	"plxr/internal/accounts"
)

/* One transcript store behind three accounts.
 *
 * Running several Claude Code accounts means several configuration
 * directories, and each of them keeps its own projects/ folder. Anybody who
 * wants one conversation history across all of them points the extra folders
 * at the first: ~/.claude2/projects and ~/.claude3/projects are symlinks to
 * ~/.claude/projects, so all three accounts read and write the same files.
 *
 * Then the same transcript is found three times, once per account, and folding
 * them into one entry used to keep whichever account happened to come first as
 * the entry's own. The other two were left in Accounts, and a lookup for them
 * found nothing — picking account 3 from a session's menu answered "Transcript
 * not found" about a file that account 3 was reading at that very moment.
 */

// sharedHome builds a home with three accounts, the second and third of which
// are the first one's projects folder under another name, and puts one
// transcript in it. It answers with the accounts and the transcript's id.
func sharedHome(t *testing.T) ([]accounts.Account, string, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need a privilege we do not ask for on Windows")
	}
	home := t.TempDir()
	cwd := filepath.Join(home, "work", "plxr")
	folder := strings.ReplaceAll(cwd, string(filepath.Separator), "-")

	first := filepath.Join(home, ".claude", "projects")
	if err := os.MkdirAll(filepath.Join(first, folder), 0o755); err != nil {
		t.Fatal(err)
	}
	id := "11111111-2222-3333-4444-555555555555"
	path := filepath.Join(first, folder, id+".jsonl")
	body := `{"type":"user","cwd":"` + cwd + `","gitBranch":"main","message":{"model":"opus","content":"hello"}}` + "\n" +
		`{"type":"ai-title","aiTitle":"One store, three accounts"}` + "\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}

	accs := []accounts.Account{{Name: "claude", Number: 1, Dir: filepath.Join(home, ".claude")}}
	for _, n := range []string{"claude2", "claude3"} {
		dir := filepath.Join(home, "."+n)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(first, filepath.Join(dir, "projects")); err != nil {
			t.Fatal(err)
		}
		accs = append(accs, accounts.Account{Name: n, Number: len(accs) + 1, Dir: dir})
	}
	// On macOS the temporary directory is itself reached through a symlink, so
	// the path is resolved once here and everything below compares like for
	// like.
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	return accs, id, real
}

func TestOneStoreIsListedOnceAndBelongsToEveryAccountReadingIt(t *testing.T) {
	accs, id, _ := sharedHome(t)

	got := List(accs, "")
	if len(got) != 1 {
		t.Fatalf("one transcript in one directory came back %d times", len(got))
	}
	e := got[0]
	if e.ID != id {
		t.Fatalf("id is %q", e.ID)
	}
	want := []string{"claude", "claude2", "claude3"}
	if strings.Join(e.Accounts, ",") != strings.Join(want, ",") {
		t.Fatalf("the transcript is readable for %v, recorded as %v", want, e.Accounts)
	}
	for _, name := range want {
		if !e.HasAccount(name) {
			t.Fatalf("%s reads the file and is not counted as holding it", name)
		}
	}
	if e.Title != "One store, three accounts" {
		t.Fatalf("title is %q", e.Title)
	}
}

// Two accounts with a store of their own each stay two, and a transcript that
// only one of them has stays that one's.
func TestSeparateStoresKeepTheirOwnAccounts(t *testing.T) {
	home := t.TempDir()
	accs := []accounts.Account{}
	for i, name := range []string{"claude", "claude2"} {
		dir := filepath.Join(home, "."+name)
		if err := os.MkdirAll(filepath.Join(dir, "projects", "-work"), 0o755); err != nil {
			t.Fatal(err)
		}
		body := `{"type":"user","cwd":"/work","message":{"model":"opus"}}` + "\n"
		if err := os.WriteFile(filepath.Join(dir, "projects", "-work", name+".jsonl"), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		accs = append(accs, accounts.Account{Name: name, Number: i + 1, Dir: dir})
	}

	got := List(accs, "")
	if len(got) != 2 {
		t.Fatalf("two separate transcripts came back as %d", len(got))
	}
	for _, e := range got {
		if len(e.Accounts) != 1 || e.Accounts[0] != e.ID {
			t.Fatalf("transcript %q belongs to %v, and to nothing else", e.ID, e.Accounts)
		}
		if e.HasAccount("claude9") {
			t.Fatal("an account that has no such file is counted as holding it")
		}
	}
}

/* Copying a file onto itself.
 *
 * Mirror exists because Claude Code only resumes what is below its own
 * configuration directory. With the directories shared there is nothing to
 * copy: source and target are one file, and read-then-replace over it puts a
 * live transcript at risk for no gain — anything appended between the read and
 * the rename is gone, and the rename swaps the file underneath whoever has it
 * open. So the same file is recognised and left alone.
 */
func TestMirrorOntoTheSameFileChangesNothing(t *testing.T) {
	accs, _, path := sharedHome(t)
	e := List(accs, "")[0]

	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	sum := func() string {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		h := sha256.Sum256(b)
		return hex.EncodeToString(h[:])
	}
	want := sum()

	for _, a := range accs[1:] {
		got, err := Mirror(e, a)
		if err != nil {
			t.Fatalf("mirroring into %s: %v", a.Name, err)
		}
		if got == "" {
			t.Fatalf("mirroring into %s answered with no path", a.Name)
		}
		real, err := filepath.EvalSymlinks(got)
		if err != nil {
			t.Fatal(err)
		}
		if real != path {
			t.Fatalf("mirroring into %s pointed at %s instead of the file itself", a.Name, real)
		}
	}

	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if after.Size() != before.Size() {
		t.Fatalf("the transcript went from %d to %d bytes", before.Size(), after.Size())
	}
	if sum() != want {
		t.Fatal("the transcript's contents changed")
	}
	if !os.SameFile(before, after) {
		t.Fatal("the transcript was replaced by another file, so anyone reading it lost it")
	}
	if !after.ModTime().Equal(before.ModTime()) {
		t.Fatalf("the transcript was rewritten: %s became %s", before.ModTime(), after.ModTime())
	}
}

/* The same file, while a session is writing to it.
 *
 * Measured against the implementation this replaces: mirroring 60 times onto a
 * four-megabyte transcript that was being appended to lost between ten and
 * twenty-four kilobytes of what had just been written, and put a different file
 * in place of it five to thirteen times. The size-and-date check it relied on
 * is two stat calls of a file that grows between them, so it loses that race
 * and then reads, writes and renames over a live conversation.
 *
 * This is the guard against that coming back. It is not a race the test has to
 * win: with the identity check there is no copying at all, so nothing can be
 * lost, and a single lost byte fails it.
 */
func TestMirrorLeavesALiveSharedTranscriptAlone(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need a privilege we do not ask for on Windows")
	}
	home := t.TempDir()
	first := filepath.Join(home, ".claude", "projects")
	if err := os.MkdirAll(filepath.Join(first, "-work"), 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(first, "-work", "s.jsonl")
	body := strings.Repeat(`{"pad":"`+strings.Repeat("x", 200)+`"}`+"\n", 20000)
	if err := os.WriteFile(src, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	second := filepath.Join(home, ".claude2")
	if err := os.MkdirAll(second, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(first, filepath.Join(second, "projects")); err != nil {
		t.Fatal(err)
	}
	target := accounts.Account{Name: "claude2", Number: 2, Dir: second}
	e := Entry{ID: "s", Account: "claude", Accounts: []string{"claude", "claude2"}, Path: src}

	// A session appending to the transcript throughout, as Claude Code does.
	var stop atomic.Bool
	var written atomic.Int64
	done := make(chan struct{})
	go func() {
		defer close(done)
		for !stop.Load() {
			f, err := os.OpenFile(src, os.O_APPEND|os.O_WRONLY, 0o600)
			if err != nil {
				continue
			}
			n, _ := f.Write([]byte(`{"type":"user"}` + "\n"))
			written.Add(int64(n))
			f.Close()
		}
	}()

	swapped := 0
	for i := 0; i < 60; i++ {
		before, err := os.Stat(src)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := Mirror(e, target); err != nil {
			t.Fatal(err)
		}
		after, err := os.Stat(src)
		if err != nil {
			t.Fatal(err)
		}
		if !os.SameFile(before, after) {
			swapped++
		}
	}
	stop.Store(true)
	<-done

	fi, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}
	if lost := int64(len(body)) + written.Load() - fi.Size(); lost != 0 {
		t.Fatalf("%d bytes of the conversation are gone — the file is %d where %d was written",
			lost, fi.Size(), int64(len(body))+written.Load())
	}
	if swapped != 0 {
		t.Fatalf("the transcript was replaced %d times, so whoever had it open was writing into nothing", swapped)
	}
}

// Into an account with a store of its own, Mirror still copies.
func TestMirrorIntoASeparateStoreCopies(t *testing.T) {
	accs, id, path := sharedHome(t)
	e := List(accs, "")[0]

	lone := accounts.Account{Name: "claude4", Number: 4, Dir: filepath.Join(t.TempDir(), ".claude4")}
	got, err := Mirror(e, lone)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(got, lone.ProjectsDir()) || filepath.Base(got) != id+".jsonl" {
		t.Fatalf("the copy landed at %s", got)
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	copied, err := os.ReadFile(got)
	if err != nil {
		t.Fatal(err)
	}
	if string(copied) != string(want) {
		t.Fatal("the copy is not what the original says")
	}
	if List([]accounts.Account{lone}, "")[0].ID != id {
		t.Fatal("the copy is not listed under the account it was copied into")
	}
}
