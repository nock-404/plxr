package template

import (
	"os"
	"path/filepath"
	"testing"
)

// Earlier versions stored templates under the German directory name. After the
// rename they must still show up — otherwise an update silently loses them.
func TestAeltereAblageWirdUebernommen(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "vorlagen")
	if err := os.MkdirAll(old, 0o755); err != nil {
		t.Fatal(err)
	}
	content := `{"name":"arbeitstag","label":"Arbeitstag","sessions":[{"cwd":"/tmp"}]}`
	if err := os.WriteFile(filepath.Join(old, "arbeitstag.json"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	liste := Load(root)
	if len(liste) != 1 || liste[0].Name != "arbeitstag" {
		t.Fatalf("alte Vorlage ging verloren: %+v", liste)
	}
	if _, err := os.Stat(Dir(root)); err != nil {
		t.Error("neuer Ordner wurde nicht angelegt")
	}
}

// Liegt schon etwas im neuen Ordner, darf die Übernahme nichts überschreiben.
func TestNeueAblageGewinnt(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "vorlagen"), 0o755)
	os.WriteFile(filepath.Join(root, "vorlagen", "a.json"),
		[]byte(`{"name":"a","sessions":[{"cwd":"/tmp"}]}`), 0o644)
	os.MkdirAll(Dir(root), 0o755)
	os.WriteFile(filepath.Join(Dir(root), "b.json"),
		[]byte(`{"name":"b","sessions":[{"cwd":"/tmp"}]}`), 0o644)

	liste := Load(root)
	if len(liste) != 1 || liste[0].Name != "b" {
		t.Fatalf("neue Ablage wurde überschrieben: %+v", liste)
	}
}

func TestSpeichernUndLoeschen(t *testing.T) {
	root := t.TempDir()
	v := Template{Name: "probe", Label: "Probe", Sessions: []Entry{{Cwd: "/tmp"}}}
	if err := Save(root, v); err != nil {
		t.Fatal(err)
	}
	if len(Load(root)) != 1 {
		t.Fatal("gespeicherte Vorlage fehlt")
	}
	if err := Delete(root, "probe"); err != nil {
		t.Fatal(err)
	}
	if len(Load(root)) != 0 {
		t.Error("gelöschte Vorlage ist noch da")
	}
}

func TestNamenPruefung(t *testing.T) {
	gut := []string{"arbeitstag", "a-b-c", "x1"}
	schlecht := []string{"", "Gross", "mit punkt.", "mit/schraeg", `{"json":1}`}
	for _, n := range gut {
		if !ValidName(n) {
			t.Errorf("%q sollte erlaubt sein", n)
		}
	}
	for _, n := range schlecht {
		if ValidName(n) {
			t.Errorf("%q sollte abgelehnt werden", n)
		}
	}
}
