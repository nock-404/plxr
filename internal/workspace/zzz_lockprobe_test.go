package workspace

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"
)

// probe: is the stat loop in List held under mu, and does it delay RootOf?
func TestZZZLockProbe(t *testing.T) {
	home := t.TempDir()
	real := t.TempDir()

	const n = 4000
	list := make([]Workspace, 0, n+1)
	now := time.Now().UnixMilli()
	for i := 0; i < n; i++ {
		list = append(list, Workspace{
			ID:       fmt.Sprintf("w-%08x", i),
			Path:     fmt.Sprintf("/nope/does/not/exist/%d", i),
			Real:     fmt.Sprintf("/nope/does/not/exist/%d", i),
			OpenedAt: now, UsedAt: now - int64(i),
		})
	}
	rw, err := Open(home, real)
	if err != nil {
		t.Fatal(err)
	}
	list = append(list, rw)
	b, _ := json.MarshalIndent(list, "", "  ")
	if err := os.WriteFile(file(home), b, 0o644); err != nil {
		t.Fatal(err)
	}
	st, _ := os.Stat(file(home))
	t.Logf("workspaces.json = %d bytes, %d entries", st.Size(), len(list))

	// warm the page cache
	_ = List(home)
	_, _ = Get(home, rw.ID)

	t0 := time.Now()
	_ = List(home)
	dList := time.Since(t0)

	t0 = time.Now()
	_, _ = Get(home, rw.ID)
	dGet := time.Since(t0)

	t0 = time.Now()
	_, _ = RootOf(home, rw.ID)
	dRoot := time.Since(t0)
	t.Logf("solo: List=%v  Get=%v (read+scan only)  RootOf=%v", dList, dGet, dRoot)

	// concurrent: RootOf while List holds the lock
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		s := time.Now()
		_ = List(home)
		t.Logf("List in goroutine took %v", time.Since(s))
	}()
	time.Sleep(2 * time.Millisecond)
	s := time.Now()
	if _, err := RootOf(home, rw.ID); err != nil {
		t.Fatalf("RootOf: %v", err)
	}
	dBlocked := time.Since(s)
	wg.Wait()
	t.Logf("RootOf while List runs: %v  (solo %v)  ratio %.1fx", dBlocked, dRoot, float64(dBlocked)/float64(dRoot))
}
