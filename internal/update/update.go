// Package update holt neue Fassungen von GitHub Releases.
//
// The flow is deliberately plain: compare versions, download the archive, swap
// daneben auspacken, tauschen, neu starten. Kein Hintergrunddienst, kein
// no silent swap — the user decides.
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

// Repo is the project the versions come from.
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

type Status struct {
	Current   string `json:"aktuell"`
	Latest    string `json:"neueste"`
	Available bool   `json:"verfuegbar"`
	Notes     string `json:"notizen"`
	AssetURL  string `json:"assetUrl"`
	AssetName string `json:"assetName"`
	Size      int64  `json:"groesse"`
	Error     string `json:"fehler,omitempty"`
}

// assetName is the name CI uploads per platform.
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

// Check asks GitHub for the latest version.
func Check(aktuell string) Status {
	// Without a leading "v", exactly like Latest. Otherwise the update bar read
	// "Fassung 0.3.5 ist da (du hast v0.3.4)" — once with, once without.
	st := Status{Current: strings.TrimPrefix(aktuell, "v")}

	req, _ := http.NewRequest("GET", "https://api.github.com/repos/"+Repo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := (&http.Client{Timeout: 12 * time.Second}).Do(req)
	if err != nil {
		st.Error = "GitHub nicht erreichbar: " + err.Error()
		return st
	}
	defer res.Body.Close()
	if res.StatusCode == 404 {
		st.Error = "noch keine Veröffentlichung im Repo"
		return st
	}
	if res.StatusCode != 200 {
		st.Error = "GitHub antwortet mit " + strconv.Itoa(res.StatusCode)
		return st
	}

	var r Release
	if err := json.NewDecoder(res.Body).Decode(&r); err != nil {
		st.Error = err.Error()
		return st
	}
	st.Latest = strings.TrimPrefix(r.Tag, "v")
	st.Notes = r.Body
	st.Available = isNewer(st.Latest, aktuell)

	want := assetName()
	for _, a := range r.Assets {
		if a.Name == want {
			st.AssetURL, st.AssetName, st.Size = a.URL, a.Name, a.Size
			break
		}
	}
	if st.Available && st.AssetURL == "" {
		st.Error = "Version " + st.Latest + " hat kein Archiv namens " + want
	}
	return st
}

// isNewer compares two versions of the form 1.2.3 component by component.
func isNewer(a, b string) bool {
	if a == "" || b == "" || a == b {
		return false
	}
	if b == "dev" {
		return false // built from source, do not overwrite
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

// Apply downloads the archive and swaps out the running application.
//
// The swap happens through renames: the old version moves aside, the new one
// into its place. If something goes wrong the old one comes back — a half
// overwritten program directory would be the worst outcome.
func Apply(assetURL string, fortschritt func(read, total int64)) (string, error) {
	if assetURL == "" {
		return "", errors.New("keine Adresse für das Archiv")
	}
	target, err := installTarget()
	if err != nil {
		return "", err
	}

	tmp, err := os.MkdirTemp("", "plxr-update-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmp)

	archiv := filepath.Join(tmp, "neu.zip")
	if err := download(assetURL, archiv, fortschritt); err != nil {
		return "", err
	}
	entpackt := filepath.Join(tmp, "aus")
	if err := unzip(archiv, entpackt); err != nil {
		return "", err
	}

	fresh, err := findApp(entpackt)
	if err != nil {
		return "", err
	}

	if err := swap(fresh, target); err != nil {
		return "", err
	}

	// Sign it so the system recognises the app across versions and does not ask
	// for permissions again on every update. If that fails the app still runs —
	// it will simply ask again.
	_ = resign(target)
	return target, nil
}

// installTarget is what gets replaced: the app bundle on macOS, the file otherwise.
func installTarget() (string, error) {
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

// download fetches the archive and does not take an abort for an answer.
//
// A download of several megabytes tears off occasionally — that is not an
// exception but the normal case on a poor line. Giving up then leaves you with
// an updater that works on good WiFi and nowhere else.
// Resumption goes through Range: bytes already fetched stay where they are.
func download(url, nach string, fortschritt func(int64, int64)) error {
	const versuche = 4
	var last error

	for versuch := 0; versuch < versuche; versuch++ {
		if versuch > 0 {
			// Wait a little, but not forever: two seconds, then four, then eight.
			time.Sleep(time.Duration(1<<versuch) * time.Second)
		}

		// Wie weit sind wir schon?
		var bereits int64
		if fi, err := os.Stat(nach); err == nil {
			bereits = fi.Size()
		}

		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return err
		}
		if bereits > 0 {
			req.Header.Set("Range", fmt.Sprintf("bytes=%d-", bereits))
		}

		res, err := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
		if err != nil {
			last = err
			continue
		}

		// 206 means: continuation accepted. 200 means: from the start — then the
		// half file has to go, otherwise two beginnings end up stitched together.
		anhaengen := res.StatusCode == http.StatusPartialContent
		if res.StatusCode != http.StatusOK && !anhaengen {
			res.Body.Close()
			last = fmt.Errorf("Download antwortet mit %d", res.StatusCode)
			continue
		}
		if !anhaengen {
			bereits = 0
			os.Remove(nach)
		}

		flags := os.O_CREATE | os.O_WRONLY
		if anhaengen {
			flags |= os.O_APPEND
		} else {
			flags |= os.O_TRUNC
		}
		f, err := os.OpenFile(nach, flags, 0o644)
		if err != nil {
			res.Body.Close()
			return err
		}

		total := res.ContentLength + bereits
		read := bereits
		buf := make([]byte, 256*1024)
		var readErr error
		for {
			n, err := res.Body.Read(buf)
			if n > 0 {
				if _, werr := f.Write(buf[:n]); werr != nil {
					f.Close()
					res.Body.Close()
					return werr
				}
				read += int64(n)
				if fortschritt != nil {
					fortschritt(read, total)
				}
			}
			if err == io.EOF {
				break
			}
			if err != nil {
				readErr = err
				break
			}
		}
		f.Close()
		res.Body.Close()

		if readErr == nil {
			return nil
		}
		last = readErr
	}
	return fmt.Errorf("Download nach %d Versuchen abgebrochen: %w", versuche, last)
}

func unzip(archiv, nach string) error {
	r, err := zip.OpenReader(archiv)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		target := filepath.Join(nach, f.Name)
		// Zip slip: an archive must not break out of its target folder.
		if !strings.HasPrefix(target, filepath.Clean(nach)+string(os.PathSeparator)) {
			return errors.New("Archiv enthält einen Pfad außerhalb des Ziels: " + f.Name)
		}
		if f.FileInfo().IsDir() {
			os.MkdirAll(target, 0o755)
			continue
		}
		os.MkdirAll(filepath.Dir(target), 0o755)
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, f.Mode())
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

func findApp(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		if runtime.GOOS == "darwin" && strings.HasSuffix(e.Name(), ".app") {
			return filepath.Join(dir, e.Name()), nil
		}
		if runtime.GOOS != "darwin" && !e.IsDir() {
			return filepath.Join(dir, e.Name()), nil
		}
	}
	return "", errors.New("im Archiv war nichts Ausführbares")
}

func copyTree(von, nach string) error {
	if runtime.GOOS == "darwin" {
		// ditto preserves bundle structure, permissions and extended attributes —
		// a plain copy destroys the signature.
		return exec.Command("ditto", von, nach).Run()
	}
	daten, err := os.ReadFile(von)
	if err != nil {
		return err
	}
	return os.WriteFile(nach, daten, 0o755)
}

// Restart starts the swapped-in application and ends the running one.
func Restart(ort string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", "-n", ort).Start()
	}
	c := exec.Command(ort)
	return c.Start()
}

/*
swap puts the new version in the place of the old one.

	The obvious approach would be: move the old version aside and copy the new one
	into its place. But then a half-copied bundle sits at the target for seconds.
	If the daemon dies in that time — crash, power loss, forced termination — the
	app is broken and nobody rolls back: that only happens when the copy reports an
	error, not when the process simply ends.

	So it is copied next to it in full first. Only once that stands do two renames
	follow — they take fractions of a second, and in between the old version is
	still there as .alt.
*/
func swap(fresh, target string) error {
	daneben := target + ".neu"
	os.RemoveAll(daneben)
	if err := copyTree(fresh, daneben); err != nil {
		os.RemoveAll(daneben)
		return errors.New("neue Fassung ließ sich nicht ablegen: " + err.Error())
	}

	beiseite := target + ".alt"
	os.RemoveAll(beiseite)
	if err := os.Rename(target, beiseite); err != nil {
		os.RemoveAll(daneben)
		return errors.New("alte Fassung ließ sich nicht beiseiteschieben: " + err.Error())
	}
	if err := os.Rename(daneben, target); err != nil {
		os.Rename(beiseite, target) // back to the start
		os.RemoveAll(daneben)
		return errors.New("neue Fassung ließ sich nicht einsetzen: " + err.Error())
	}
	os.RemoveAll(beiseite)
	return nil
}
