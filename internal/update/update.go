// Package update fetches new versions from GitHub releases.
//
// The flow is deliberately plain: compare versions, download the archive,
// unpack it beside the old one, swap, restart. No background service, no
// silent swap — the user decides.
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
	"plxr/internal/uierr"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Repo is the project the versions come from.
const Repo = "nock-404/plxr"

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
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	Notes     string `json:"notes"`
	AssetURL  string `json:"assetUrl"`
	AssetName string `json:"assetName"`
	Size      int64  `json:"size"`
	Error     string `json:"error,omitempty"`
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
//
// The website first, the API only to fill in. That order is the point.
//
// The API allows sixty calls an hour per address, without a token and shared
// with everything else on the machine — one afternoon on the gh command and it
// answers 403. It was asked first because it carries the release notes and the
// size of the archive. That is a poor reason to make the whole check depend on
// it: the tag is what matters, and /releases/latest redirects straight to it,
// with no limit worth speaking of.
//
// So the version and the download address come from the redirect and always
// work. The API is asked afterwards, and when it refuses, all that is missing
// is the notes and a number of bytes.
func Check(current string) Status {
	// Without a leading "v", exactly like Latest. Otherwise the update bar read
	// "Version 0.3.5 is out (you have v0.3.4)" — once with, once without.
	st := Status{Current: strings.TrimPrefix(current, "v")}

	tag, err := latestFromWeb()
	if err != nil {
		// Only now the API, and only so the message can say something better
		// than "the website did not answer".
		if r, apiErr := latestFromAPI(); apiErr == nil {
			fillFromRelease(&st, r, current)
			return st
		}
		st.Error = uierr.With("err.update.unreachable", err.Error()).Error()
		return st
	}

	st.Latest = strings.TrimPrefix(tag, "v")
	st.Available = isNewer(st.Latest, current)
	if st.Available {
		st.AssetName = assetName()
		st.AssetURL = "https://github.com/" + Repo + "/releases/download/" +
			tag + "/" + st.AssetName
	}

	// Notes and size are a bonus. A refusal here changes nothing about the
	// update itself, so it is not reported as a fault.
	//
	// The address is NOT taken from here. The API hands out its own download
	// address, and using it would put the download back under the same sixty an
	// hour that this whole detour exists to get out from under. The one from
	// the website works without a token and without a limit.
	if r, apiErr := latestFromAPI(); apiErr == nil {
		st.Notes = r.Body
		for _, a := range r.Assets {
			if a.Name == st.AssetName {
				st.Size = a.Size
				break
			}
		}
	}
	return st
}

// fillFromRelease takes what the API gives when the website could not be
// reached at all.
func fillFromRelease(st *Status, r *Release, current string) {
	st.Latest = strings.TrimPrefix(r.Tag, "v")
	st.Notes = r.Body
	st.Available = isNewer(st.Latest, current)

	want := assetName()
	for _, a := range r.Assets {
		if a.Name == want {
			st.AssetURL, st.AssetName, st.Size = a.URL, a.Name, a.Size
			break
		}
	}
	if st.Available && st.AssetURL == "" {
		st.Error = uierr.With("err.update.noArchive", st.Latest+" · "+want).Error()
	}
}

func latestFromAPI() (*Release, error) {
	req, _ := http.NewRequest("GET", "https://api.github.com/repos/"+Repo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := (&http.Client{Timeout: 12 * time.Second}).Do(req)
	if err != nil {
		return nil, uierr.With("err.update.unreachable", err.Error())
	}
	defer res.Body.Close()
	if res.StatusCode == 404 {
		return nil, uierr.New("err.update.noRelease")
	}
	if res.StatusCode != 200 {
		return nil, uierr.With("err.update.status", strconv.Itoa(res.StatusCode))
	}
	var r Release
	if err := json.NewDecoder(res.Body).Decode(&r); err != nil {
		return nil, uierr.With("err.update.unreadable", err.Error())
	}
	return &r, nil
}

// latestFromWeb reads the tag out of the redirect that /releases/latest sends.
// No API, so no sixty-an-hour limit.
func latestFromWeb() (string, error) {
	c := &http.Client{
		Timeout: 12 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	res, err := c.Get("https://github.com/" + Repo + "/releases/latest")
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	loc := res.Header.Get("Location")
	i := strings.LastIndex(loc, "/releases/tag/")
	if i < 0 {
		return "", errors.New("no tag in the redirect")
	}
	tag := loc[i+len("/releases/tag/"):]
	if tag == "" || strings.ContainsAny(tag, "/?#") {
		return "", errors.New("tag in the redirect is not usable")
	}
	return tag, nil
}

// isNewer compares two versions of the form 1.2.3 component by component.
func isNewer(a, b string) bool {
	if a == "" || b == "" || a == b {
		return false
	}
	if b == "dev" {
		return false // built from source, do not overwrite
	}
	parts := func(v string) []int {
		var out []int
		for _, s := range strings.Split(strings.TrimPrefix(v, "v"), ".") {
			n, _ := strconv.Atoi(strings.TrimFunc(s, func(r rune) bool { return r < '0' || r > '9' }))
			out = append(out, n)
		}
		return out
	}
	x, y := parts(a), parts(b)
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
func Apply(assetURL string, progress func(read, total int64)) (string, error) {
	if assetURL == "" {
		return "", uierr.New("err.update.noAssetURL")
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

	zipPath := filepath.Join(tmp, "fresh.zip")
	if err := download(assetURL, zipPath, progress); err != nil {
		return "", err
	}
	unpacked := filepath.Join(tmp, "unpacked")
	if err := unzip(zipPath, unpacked); err != nil {
		return "", err
	}

	fresh, err := findApp(unpacked)
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
// How long to wait before trying again: two seconds, then four, then eight.
// A variable rather than a constant so a test can exercise the retries without
// sitting through fourteen seconds of them on every run.
var retryWait = func(attempt int) time.Duration {
	return time.Duration(1<<attempt) * time.Second
}

func download(url, dest string, progress func(int64, int64)) error {
	const attempts = 4
	var last error

	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 {
			time.Sleep(retryWait(attempt))
		}

		// How far along are we already?
		var have int64
		if fi, err := os.Stat(dest); err == nil {
			have = fi.Size()
		}

		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return err
		}
		if have > 0 {
			req.Header.Set("Range", fmt.Sprintf("bytes=%d-", have))
		}

		res, err := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
		if err != nil {
			last = err
			continue
		}

		// 206 means: continuation accepted. 200 means: from the start — then the
		// half file has to go, otherwise two beginnings end up stitched together.
		resuming := res.StatusCode == http.StatusPartialContent
		if res.StatusCode != http.StatusOK && !resuming {
			res.Body.Close()
			last = fmt.Errorf("download answered with %d", res.StatusCode)
			continue
		}
		if !resuming {
			have = 0
			os.Remove(dest)
		}

		flags := os.O_CREATE | os.O_WRONLY
		if resuming {
			flags |= os.O_APPEND
		} else {
			flags |= os.O_TRUNC
		}
		f, err := os.OpenFile(dest, flags, 0o644)
		if err != nil {
			res.Body.Close()
			return err
		}

		total := res.ContentLength + have
		read := have
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
				if progress != nil {
					progress(read, total)
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
	return fmt.Errorf("download gave up after %d attempts: %w", attempts, last)
}

func unzip(zipPath, dest string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		target := filepath.Join(dest, f.Name)
		// Zip slip: an archive must not break out of its target folder.
		if !strings.HasPrefix(target, filepath.Clean(dest)+string(os.PathSeparator)) {
			return uierr.With("err.archive.escapes", f.Name)
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
	return "", uierr.New("err.archive.noBinary")
}

func copyTree(src, dest string) error {
	if runtime.GOOS == "darwin" {
		// ditto preserves bundle structure, permissions and extended attributes —
		// a plain copy destroys the signature.
		return exec.Command("ditto", src, dest).Run()
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dest, data, 0o755)
}

/* Restart brings the new version up once this one has gone.
 *
 * Not before it. Starting the new one first looked right and did nothing at all:
 * plxr allows one window per control room, so the fresh instance found the old
 * one still holding that place, handed itself over to it as a second launch, and
 * exited. Seven hundred milliseconds later the old one exited too, as planned,
 * and the machine was left with no plxr running. The button appeared to do
 * nothing, which is exactly what it did.
 *
 * So what is started is something that waits for the window to be gone and only
 * then opens the application. Waiting on the process itself rather than on a
 * guessed number of seconds: a slow machine must not end up with two, and a fast
 * one must not wait for nothing.
 */
func Restart(path string, waitFor int) error {
	return relaunch(path, waitFor)
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
	still there as .old.
*/
func swap(fresh, target string) error {
	beside := target + ".fresh"
	os.RemoveAll(beside)
	if err := copyTree(fresh, beside); err != nil {
		os.RemoveAll(beside)
		return uierr.With("err.update.copyFailed", err.Error())
	}

	aside := target + ".old"
	os.RemoveAll(aside)
	if err := os.Rename(target, aside); err != nil {
		os.RemoveAll(beside)
		return uierr.With("err.update.moveAsideFailed", err.Error())
	}
	if err := os.Rename(beside, target); err != nil {
		os.Rename(aside, target) // back to the start
		os.RemoveAll(beside)
		return uierr.With("err.update.installFailed", err.Error())
	}
	os.RemoveAll(aside)
	return nil
}
