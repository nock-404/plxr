package update

import (
	"archive/zip"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

/* The half of updating that had never been run.
 *
 * Whether a new version is noticed was checked from the beginning: the daemon
 * asks, compares, and the band appears. What was never exercised is everything
 * after somebody presses the button — fetching the archive, opening it, finding
 * the program inside it, and putting it where the old one was. That is the part
 * that can leave a machine with no working plxr at all, and it was the part
 * nothing had ever touched.
 *
 * A local server stands in for GitHub. Everything else is the real code.
 */

// makeBundle writes something shaped like what a release carries: on macOS an
// app bundle, elsewhere a single file.
func makeBundle(t *testing.T, dir, marker string) string {
	t.Helper()
	if runtime.GOOS == "darwin" {
		app := filepath.Join(dir, "plxr.app")
		inner := filepath.Join(app, "Contents", "MacOS")
		if err := os.MkdirAll(inner, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(inner, "plxr"), []byte(marker), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(app, "Contents", "Info.plist"), []byte("<plist/>"), 0o644); err != nil {
			t.Fatal(err)
		}
		return app
	}
	file := filepath.Join(dir, "plxr")
	if err := os.WriteFile(file, []byte(marker), 0o755); err != nil {
		t.Fatal(err)
	}
	return file
}

func zipUp(t *testing.T, root, dest string) {
	t.Helper()
	f, err := os.Create(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	w := zip.NewWriter(f)
	defer w.Close()

	base := filepath.Dir(root)
	err = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(base, path)
		if err != nil {
			return err
		}
		if info.IsDir() {
			_, err := w.Create(rel + "/")
			return err
		}
		head, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		head.Name = rel
		head.Method = zip.Deflate
		out, err := w.CreateHeader(head)
		if err != nil {
			return err
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		_, err = out.Write(body)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestAnArchiveIsOpenedAndTheProgramFoundInIt(t *testing.T) {
	tmp := t.TempDir()
	src := filepath.Join(tmp, "src")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	makeBundle(t, src, "the fresh one")

	archive := filepath.Join(tmp, "plxr.zip")
	zipUp(t, filepath.Join(src, filepath.Base(mustOne(t, src))), archive)

	out := filepath.Join(tmp, "unpacked")
	if err := unzip(archive, out); err != nil {
		t.Fatalf("unzip: %v", err)
	}
	found, err := findApp(out)
	if err != nil {
		t.Fatalf("the program was not found in the archive: %v", err)
	}
	if !strings.Contains(found, "plxr") {
		t.Fatalf("found %q", found)
	}
}

func TestAnArchiveWithNothingUsableIsRefused(t *testing.T) {
	tmp := t.TempDir()
	empty := filepath.Join(tmp, "empty")
	if err := os.MkdirAll(empty, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := findApp(empty); err == nil {
		t.Fatal("an empty archive was accepted")
	}
}

func TestTheSwapPutsTheNewOneWhereTheOldOneWas(t *testing.T) {
	tmp := t.TempDir()

	freshDir := filepath.Join(tmp, "fresh")
	installed := filepath.Join(tmp, "installed")
	for _, d := range []string{freshDir, installed} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	fresh := makeBundle(t, freshDir, "the new one")
	target := makeBundle(t, installed, "the old one")

	if err := swap(fresh, target); err != nil {
		t.Fatalf("swap: %v", err)
	}

	got := readMarker(t, target)
	if got != "the new one" {
		t.Fatalf("after the swap the installed program still says %q", got)
	}
	// Nothing may be left lying beside it: a half-finished update is worse than
	// none, and a leftover .fresh would be picked up as an application.
	for _, leftover := range []string{target + ".fresh", target + ".old"} {
		if _, err := os.Stat(leftover); err == nil {
			t.Errorf("%s was left behind", filepath.Base(leftover))
		}
	}
}

func TestTheWholeWayFromAServerToTheInstalledProgram(t *testing.T) {
	tmp := t.TempDir()

	// What the release carries.
	srcDir := filepath.Join(tmp, "release")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatal(err)
	}
	makeBundle(t, srcDir, "version two")
	archive := filepath.Join(tmp, "plxr.zip")
	zipUp(t, mustOne(t, srcDir), archive)

	// Standing in for GitHub.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, archive)
	}))
	defer server.Close()

	// What is installed today.
	installed := filepath.Join(tmp, "installed")
	if err := os.MkdirAll(installed, 0o755); err != nil {
		t.Fatal(err)
	}
	target := makeBundle(t, installed, "version one")

	// The steps Apply takes, with the one thing it cannot be told — where it
	// lives — supplied here instead.
	work := filepath.Join(tmp, "work")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	zipPath := filepath.Join(work, "fresh.zip")
	var readBytes, totalBytes int64
	if err := download(server.URL+"/plxr.zip", zipPath, func(read, total int64) {
		readBytes, totalBytes = read, total
	}); err != nil {
		t.Fatalf("download: %v", err)
	}
	if readBytes == 0 {
		t.Fatal("the download reported no progress at all")
	}
	if totalBytes > 0 && readBytes != totalBytes {
		t.Fatalf("read %d of %d bytes", readBytes, totalBytes)
	}

	unpacked := filepath.Join(work, "unpacked")
	if err := unzip(zipPath, unpacked); err != nil {
		t.Fatalf("unzip: %v", err)
	}
	fresh, err := findApp(unpacked)
	if err != nil {
		t.Fatalf("findApp: %v", err)
	}
	if err := swap(fresh, target); err != nil {
		t.Fatalf("swap: %v", err)
	}
	if got := readMarker(t, target); got != "version two" {
		t.Fatalf("after the whole way the installed program says %q", got)
	}
}

// An address that leads nowhere must fail rather than leave a broken install.
func TestADownloadThatFailsChangesNothing(t *testing.T) {
	// The real waits are seconds long, on purpose — a poor line is the normal
	// case, not an exception. Here they only need to happen, not to take time.
	was := retryWait
	retryWait = func(int) time.Duration { return time.Millisecond }
	defer func() { retryWait = was }()

	tmp := t.TempDir()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusNotFound)
	}))
	defer server.Close()

	dest := filepath.Join(tmp, "fresh.zip")
	if err := download(server.URL+"/nothing.zip", dest, nil); err == nil {
		t.Fatal("a missing archive was reported as downloaded")
	}
}

func mustOne(t *testing.T, dir string) string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) == 0 {
		t.Fatalf("nothing in %s", dir)
	}
	return filepath.Join(dir, entries[0].Name())
}

func readMarker(t *testing.T, target string) string {
	t.Helper()
	path := target
	if runtime.GOOS == "darwin" {
		path = filepath.Join(target, "Contents", "MacOS", "plxr")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading the installed program: %v", err)
	}
	return string(b)
}
