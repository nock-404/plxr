package theme

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// The built-in skins must survive the handler.
//
// The first version swallowed every /skins/ request and only looked on disk.
// crt, pixel, sketch and win95 live in the binary — all four answered 404, and
// the whole window stood there without a skin.
func TestBuiltInSkinsStillReachable(t *testing.T) {
	served := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { served = true })
	h := SkinHandler(next)

	r := httptest.NewRequest("GET", "/skins/crt/skin.css", nil)
	h.ServeHTTP(httptest.NewRecorder(), r)
	if !served {
		t.Fatal("a built-in skin did not reach the fallback")
	}
}

func TestOwnSkinWins(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir())
	p := SkinPath("mine")
	if p == "" {
		t.Fatal("SkinPath refused a clean name")
	}
	os.MkdirAll(filepath.Dir(p), 0o755)
	os.WriteFile(p, []byte(".x{color:red}"), 0o644)

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("fell through although the skin is on disk") })
	w := httptest.NewRecorder()
	SkinHandler(next).ServeHTTP(w, httptest.NewRequest("GET", "/skins/mine/skin.css", nil))
	if w.Body.String() != ".x{color:red}" {
		t.Errorf("body %q", w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Error("a cached sheet makes every save look like it did nothing")
	}
}

// A name out of an HTTP request must not reach any file on the disk.
func TestSkinPathRefusesTraversal(t *testing.T) {
	for _, bad := range []string{"../etc", "a/b", "a.b", "", `x\y`} {
		if SkinPath(bad) != "" {
			t.Errorf("SkinPath(%q) allowed", bad)
		}
	}
}
