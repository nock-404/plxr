package template

import (
	"os"
	"path/filepath"
	"testing"
)

// Earlier versions stored templates under the German directory name. After the
// rename they must still show up — otherwise an update silently loses them.
func TestOlderStorageIsAdopted(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "vorlagen")
	if err := os.MkdirAll(old, 0o755); err != nil {
		t.Fatal(err)
	}
	content := `{"name":"arbeitstag","label":"Arbeitstag","sessions":[{"cwd":"/tmp"}]}`
	if err := os.WriteFile(filepath.Join(old, "arbeitstag.json"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	list := Load(root)
	if len(list) != 1 || list[0].Name != "arbeitstag" {
		t.Fatalf("old template was lost: %+v", list)
	}
	if _, err := os.Stat(Dir(root)); err != nil {
		t.Error("the new folder was not created")
	}
}

// If something already sits in the new folder, the migration must not overwrite it.
func TestNewStorageWins(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "vorlagen"), 0o755)
	os.WriteFile(filepath.Join(root, "vorlagen", "a.json"),
		[]byte(`{"name":"a","sessions":[{"cwd":"/tmp"}]}`), 0o644)
	os.MkdirAll(Dir(root), 0o755)
	os.WriteFile(filepath.Join(Dir(root), "b.json"),
		[]byte(`{"name":"b","sessions":[{"cwd":"/tmp"}]}`), 0o644)

	list := Load(root)
	if len(list) != 1 || list[0].Name != "b" {
		t.Fatalf("the new storage was overwritten: %+v", list)
	}
}

func TestSaveAndDelete(t *testing.T) {
	root := t.TempDir()
	v := Template{Name: "probe", Label: "Probe", Sessions: []Entry{{Cwd: "/tmp"}}}
	if err := Save(root, v); err != nil {
		t.Fatal(err)
	}
	if len(Load(root)) != 1 {
		t.Fatal("the saved template is missing")
	}
	if err := Delete(root, "probe"); err != nil {
		t.Fatal(err)
	}
	if len(Load(root)) != 0 {
		t.Error("the deleted template is still there")
	}
}

func TestNameValidation(t *testing.T) {
	valid := []string{"arbeitstag", "a-b-c", "x1"}
	invalid := []string{"", "Gross", "mit punkt.", "mit/schraeg", `{"json":1}`}
	for _, n := range valid {
		if !ValidName(n) {
			t.Errorf("%q should be allowed", n)
		}
	}
	for _, n := range invalid {
		if ValidName(n) {
			t.Errorf("%q should be rejected", n)
		}
	}
}
