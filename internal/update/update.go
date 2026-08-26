// Package update holt neue Fassungen von GitHub Releases.
//
// Der Ablauf ist bewusst schlicht: Version vergleichen, Archiv laden, App
// daneben auspacken, tauschen, neu starten. Kein Hintergrunddienst, kein
// stiller Austausch — der Nutzer entscheidet.
package update

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Repo ist das Projekt, aus dem Fassungen kommen.
const Repo = "mg-pr/plxr"

type Release struct {
	Tag        string    `json:"tag_name"`
	Name       string    `json:"name"`
	Body       string    `json:"body"`
	Prerelease bool      `json:"prerelease"`
	Published  time.Time `json:"published_at"`
	Assets     []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
		Size int64  `json:"size"`
	} `json:"assets"`
}

type Stand struct {
	Aktuell   string `json:"aktuell"`
	Neueste   string `json:"neueste"`
	Verfügbar bool   `json:"verfuegbar"`
	Notizen   string `json:"notizen"`
	AssetURL  string `json:"assetUrl"`
	AssetName string `json:"assetName"`
	Größe     int64  `json:"groesse"`
	Fehler    string `json:"fehler,omitempty"`
}

// assetName ist der Name, den das CI je Plattform hochlädt.
func assetName() string {
	switch runtime.GOOS {
	case "darwin":
		return "plxr-macos-" + runtime.GOARCH + ".zip"
	case "windows":
		return "plxr-windows-" + runtime.GOARCH + ".zip"
	default:
		return "plxr-linux-" + runtime.GOARCH + ".zip"
	}
}

// Prüfen fragt GitHub nach der neuesten Fassung.
func Prüfen(aktuell string) Stand {
	st := Stand{Aktuell: aktuell}

	req, _ := http.NewRequest("GET", "https://api.github.com/repos/"+Repo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := (&http.Client{Timeout: 12 * time.Second}).Do(req)
	if err != nil {
		st.Fehler = "GitHub nicht erreichbar: " + err.Error()
		return st
	}
	defer res.Body.Close()
	if res.StatusCode == 404 {
		st.Fehler = "noch keine Veröffentlichung im Repo"
		return st
	}
	if res.StatusCode != 200 {
		st.Fehler = "GitHub antwortet mit " + strconv.Itoa(res.StatusCode)
		return st
	}

	var r Release
	if err := json.NewDecoder(res.Body).Decode(&r); err != nil {
		st.Fehler = err.Error()
		return st
	}
	st.Neueste = strings.TrimPrefix(r.Tag, "v")
	st.Notizen = r.Body
	st.Verfügbar = neuer(st.Neueste, aktuell)

	want := assetName()
	for _, a := range r.Assets {
		if a.Name == want {
			st.AssetURL, st.AssetName, st.Größe = a.URL, a.Name, a.Size
			break
		}
	}
	if st.Verfügbar && st.AssetURL == "" {
		st.Fehler = "Version " + st.Neueste + " hat kein Archiv namens " + want
	}
	return st
}

// neuer vergleicht zwei Versionen der Form 1.2.3 stellenweise.
func neuer(a, b string) bool {
	if a == "" || b == "" || a == b {
		return false
	}
	if b == "dev" {
		return false // aus dem Quelltext gebaut, nicht überschreiben
	}
	teile := func(v string) []int {
		var out []int
		for _, s := range strings.Split(strings.TrimPrefix(v, "v"), ".") {
			n, _ := strconv.Atoi(strings.TrimFunc(s, func(r rune) bool { return r < '0' || r > '9' }))
			out = append(out, n)
		}
		return out
	}
	x, y := teile(a), teile(b)
	for i := 0; i < len(x) || i < len(y); i++ {
		var xi, yi int
		if i < len(x) {
			xi = x[i]
		}
		if i < len(y) {
			yi = y[i]
		}
		if xi != yi {
			return xi > yi
		}
	}
	return false
}

// Anwenden lädt das Archiv und tauscht die laufende Anwendung aus.
//
// Getauscht wird über ein Umbenennen: die alte Fassung wandert zur Seite, die
// neue an ihren Platz. Geht dabei etwas schief, kommt die alte zurück — ein
// halb überschriebenes Programmverzeichnis wäre der schlimmste Ausgang.
func Anwenden(assetURL string, fortschritt func(gelesen, gesamt int64)) (string, error) {
	if assetURL == "" {
		return "", errors.New("keine Adresse für das Archiv")
	}
	ziel, err := installOrt()
	if err != nil {
		return "", err
	}

	tmp, err := os.MkdirTemp("", "plxr-update-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmp)

	archiv := filepath.Join(tmp, "neu.zip")
	if err := laden(assetURL, archiv, fortschritt); err != nil {
		return "", err
	}
	entpackt := filepath.Join(tmp, "aus")
	if err := entpacken(archiv, entpackt); err != nil {
		return "", err
	}

	neu, err := findeApp(entpackt)
	if err != nil {
		return "", err
	}

	beiseite := ziel + ".alt"
	os.RemoveAll(beiseite)
	if err := os.Rename(ziel, beiseite); err != nil {
		return "", errors.New("alte Fassung ließ sich nicht beiseiteschieben: " + err.Error())
	}
	if err := kopieren(neu, ziel); err != nil {
		os.RemoveAll(ziel)
		os.Rename(beiseite, ziel) // zurück auf Anfang
		return "", errors.New("neue Fassung ließ sich nicht einsetzen: " + err.Error())
	}
	os.RemoveAll(beiseite)
	return ziel, nil
}

// installOrt ist das, was ersetzt wird: auf macOS das App-Bündel, sonst die Datei.
func installOrt() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, _ = filepath.EvalSymlinks(exe)
	if runtime.GOOS == "darwin" {
		if i := strings.Index(exe, ".app/"); i > 0 {
			return exe[:i+4], nil
		}
	}
	return exe, nil
}

func laden(url, nach string, fortschritt func(int64, int64)) error {
	res, err := http.Get(url)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("Download antwortet mit %d", res.StatusCode)
	}
	f, err := os.Create(nach)
	if err != nil {
		return err
	}
	defer f.Close()

	gesamt := res.ContentLength
	var gelesen int64
	buf := make([]byte, 256*1024)
	for {
		n, err := res.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				return werr
			}
			gelesen += int64(n)
			if fortschritt != nil {
				fortschritt(gelesen, gesamt)
			}
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func entpacken(archiv, nach string) error {
	r, err := zip.OpenReader(archiv)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		ziel := filepath.Join(nach, f.Name)
		// Zip-Slip: ein Archiv darf nicht aus seinem Zielordner ausbrechen.
		if !strings.HasPrefix(ziel, filepath.Clean(nach)+string(os.PathSeparator)) {
			return errors.New("Archiv enthält einen Pfad außerhalb des Ziels: " + f.Name)
		}
		if f.FileInfo().IsDir() {
			os.MkdirAll(ziel, 0o755)
			continue
		}
		os.MkdirAll(filepath.Dir(ziel), 0o755)
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(ziel, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, f.Mode())
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		out.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func findeApp(dir string) (string, error) {
	eintraege, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	for _, e := range eintraege {
		if runtime.GOOS == "darwin" && strings.HasSuffix(e.Name(), ".app") {
			return filepath.Join(dir, e.Name()), nil
		}
		if runtime.GOOS != "darwin" && !e.IsDir() {
			return filepath.Join(dir, e.Name()), nil
		}
	}
	return "", errors.New("im Archiv war nichts Ausführbares")
}

func kopieren(von, nach string) error {
	if runtime.GOOS == "darwin" {
		// ditto erhält Bündelstruktur, Rechte und erweiterte Attribute —
		// eine einfache Kopie zerstört die Signatur.
		return exec.Command("ditto", von, nach).Run()
	}
	daten, err := os.ReadFile(von)
	if err != nil {
		return err
	}
	return os.WriteFile(nach, daten, 0o755)
}

// NeuStarten startet die getauschte Anwendung und beendet die laufende.
func NeuStarten(ort string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", "-n", ort).Start()
	}
	c := exec.Command(ort)
	return c.Start()
}
