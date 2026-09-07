package find

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// A named pipe in the folder used to hang the search for ever.
//
// os.Open on a fifo blocks until somebody writes to it, and the deadline in
// Search is a context, which os.Open never consults. So the request never came
// back — measured at fifteen seconds and counting — and every repeat left
// another goroutine stuck on the same pipe. Devices and sockets are the same
// trap. Only ordinary files are read now.
func TestAPipeDoesNotHangTheSearch(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	pipe := filepath.Join(dir, "pipe")
	if out, err := exec.Command("mkfifo", pipe).CombinedOutput(); err != nil {
		t.Skipf("no mkfifo here: %v %s", err, out)
	}

	done := make(chan Report, 1)
	go func() {
		r, err := Search(dir, Query{Text: "hello"})
		if err != nil {
			t.Errorf("Search: %v", err)
		}
		done <- r
	}()

	select {
	case r := <-done:
		if len(r.Hits) != 1 || r.Hits[0].Path != "a.txt" {
			t.Fatalf("expected the one ordinary file, got %+v", r.Hits)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("the search never came back — the pipe is still being waited on")
	}
}
