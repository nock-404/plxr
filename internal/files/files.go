// Package files provides the file tree of a session.
//
// Every access is tied to the working directory of the session. That is not a
// formality: the UI sends paths, and without a leash a "../../.ssh/id_rsa" could
// walk out of the tree. So every function checks the resolved path against the
// resolved root — after following symlinks, not before.
package files

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"plxr/internal/uierr"
	"sort"
	"strings"
	"unicode/utf8"
)

// MaxRead limits how much a preview reads.
const MaxRead = 512 << 10

// Noise that does not show up in the tree by default. The user can reveal it;
// the default is to hide, because node_modules drowns every tree and
// makes it unusable.
var noise = map[string]bool{
	".git": true, "node_modules": true, ".DS_Store": true,
	".next": true, ".nuxt": true, ".turbo": true, ".cache": true,
	"dist": true, "build": true, "target": true, "vendor": true,
	"__pycache__": true, ".venv": true, ".pytest_cache": true,
}

type Entry struct {
	Name  string `json:"name"`
	Path  string `json:"path"` // absolute
	Dir   bool   `json:"dir"`
	Size  int64  `json:"size"`
	Mod   int64  `json:"mod"`
	Noise bool   `json:"noise"` // belongs to the hidden noise
}

// resolve resolves a path and makes sure it stays below root.
func resolve(root, path string) (string, error) {
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	if path == "" {
		return realRoot, nil
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(realRoot, path)
	}
	real, err := filepath.EvalSymlinks(filepath.Clean(path))
	if err != nil {
		return "", err
	}
	// Append the separator, otherwise /project-secret passes for /project.
	if real != realRoot && !strings.HasPrefix(real, realRoot+string(filepath.Separator)) {
		return "", uierr.New("err.file.outsideSession")
	}
	return real, nil
}

// List returns the contents of a directory: folders first, then
// alphabetically, with the noise last.
func List(root, dir string) ([]Entry, error) {
	real, err := resolve(root, dir)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(real)
	if err != nil {
		return nil, err
	}

	out := make([]Entry, 0, len(entries))
	for _, de := range entries {
		info, err := de.Info()
		if err != nil {
			continue
		}
		name := de.Name()
		e := Entry{
			Name: name,
			Path: filepath.Join(real, name),
			Dir:  de.IsDir(),
			Mod:  info.ModTime().UnixMilli(),
			// noise is known names plus everything starting with a dot.
			Noise: noise[name] || (strings.HasPrefix(name, ".") && name != ".env.example"),
		}
		if !e.Dir {
			e.Size = info.Size()
		}
		out = append(out, e)
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Noise != out[j].Noise {
			return !out[i].Noise
		}
		if out[i].Dir != out[j].Dir {
			return out[i].Dir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

type Content struct {
	Path      string `json:"path"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
	Binary    bool   `json:"binary"`
	Size      int64  `json:"size"`
	Lines     int    `json:"lines"`
	// Mod is the state the text is based on. It is sent back when saving: if it
	// no longer matches, somebody else has written in the meantime and we do
	// not blindly overwrite.
	Mod int64 `json:"mod"`
}

// Read returns the beginning of a file as text.
func Read(root, path string) (*Content, error) {
	real, err := resolve(root, path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(real)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, uierr.New("err.file.isDirectory")
	}

	f, err := os.Open(real)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	buf := make([]byte, MaxRead)
	n, err := io.ReadFull(f, buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return nil, err
	}
	buf = buf[:n]

	c := &Content{Path: real, Size: info.Size(), Truncated: info.Size() > int64(n),
		Mod: info.ModTime().UnixMilli()}

	// A null byte near the start is the usual, sufficiently reliable sign of
	// "not displayable". Invalid UTF-8 counts as well.
	if bytes.IndexByte(buf, 0) >= 0 || !utf8.Valid(buf) {
		c.Binary = true
		return c, nil
	}
	c.Text = string(buf)
	c.Lines = countLines(buf)
	return c, nil
}

// countLines counts what an editor shows as lines.
//
// The obvious `Count('\n') + 1` is wrong for the normal case: nearly every
// text file ends in a newline, and that closes the last line, it does not open
// a new one. A one-line file was showing "2 lines". An empty file has none.
func countLines(buf []byte) int {
	if len(buf) == 0 {
		return 0
	}
	n := bytes.Count(buf, []byte{'\n'})
	if buf[len(buf)-1] != '\n' {
		n++ // the last line has no closing newline and still counts
	}
	return n
}

// MaxWrite limits what may be written through the UI.
const MaxWrite = 4 << 20

// Write saves a file.
//
// Three safeguards, because real work can be lost here: the path has to sit
// below the session, the file has to have existed before (plxr is not a file
// manager), and the state has to be the one the text is based on — otherwise
// somebody else has written in the meantime.
//
// Writing goes through a sibling file and a rename: an interrupted write
// leaves no half-written file behind.
func Write(root, path, text string, expectedState int64) (*Content, error) {
	if len(text) > MaxWrite {
		return nil, uierr.New("err.file.tooLarge")
	}
	real, err := resolve(root, path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(real)
	if err != nil {
		return nil, uierr.New("err.file.gone")
	}
	if info.IsDir() {
		return nil, uierr.New("err.file.isDirectory")
	}
	if expectedState != 0 && info.ModTime().UnixMilli() != expectedState {
		return nil, uierr.New("err.file.changedOutside")
	}

	tmp := real + ".plxr-tmp"
	if err := os.WriteFile(tmp, []byte(text), info.Mode().Perm()); err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, real); err != nil {
		os.Remove(tmp)
		return nil, err
	}
	return Read(root, real)
}

// Suggestions returns subdirectories for a partially typed path.
//
// Unlike the rest of this package NOT tied to a session: the point here is to
// find a directory in which no session is running yet. Only directory names are
// read — no file contents.
func Suggestions(input string, max int) []string {
	if input == "" {
		input = "~/"
	}
	if strings.HasPrefix(input, "~") {
		home, _ := os.UserHomeDir()
		input = home + input[1:]
	}

	// If the input ends on a separator it is the directory itself; otherwise the
	// last part is a name being typed.
	dir, stem := input, ""
	if !strings.HasSuffix(input, string(filepath.Separator)) {
		dir, stem = filepath.Split(input)
	}
	if dir == "" {
		dir = "."
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return []string{}
	}

	small := strings.ToLower(stem)
	out := []string{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		// Only show hidden entries when they are explicitly being typed.
		if strings.HasPrefix(name, ".") && !strings.HasPrefix(stem, ".") {
			continue
		}
		if small != "" && !strings.HasPrefix(strings.ToLower(name), small) {
			continue
		}
		out = append(out, filepath.Join(dir, name))
		if len(out) >= max {
			break
		}
	}
	sort.Strings(out)
	return out
}

// ---- Changing things, not only looking at them ----

// Create makes a file or a directory below root. It refuses to overwrite: a
// name that is already taken is a mistake, not an instruction.
func Create(root, path string, dir bool) (*Entry, error) {
	full, err := resolveNew(root, path)
	if err != nil {
		return nil, err
	}
	if _, err := os.Lstat(full); err == nil {
		return nil, uierr.New("err.file.exists")
	}
	if dir {
		if err := os.MkdirAll(full, 0o755); err != nil {
			return nil, uierr.With("err.file.notCreated", err.Error())
		}
	} else {
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return nil, uierr.With("err.file.notCreated", err.Error())
		}
		f, err := os.OpenFile(full, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			return nil, uierr.With("err.file.notCreated", err.Error())
		}
		_ = f.Close()
	}
	return describe(full)
}

// Rename moves a file or directory, within the session's tree at both ends.
func Rename(root, from, to string) (*Entry, error) {
	src, err := resolve(root, from)
	if err != nil {
		return nil, err
	}
	dst, err := resolveNew(root, to)
	if err != nil {
		return nil, err
	}
	if _, err := os.Lstat(dst); err == nil {
		return nil, uierr.New("err.file.exists")
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return nil, uierr.With("err.file.notMoved", err.Error())
	}
	if err := os.Rename(src, dst); err != nil {
		return nil, uierr.With("err.file.notMoved", err.Error())
	}
	return describe(dst)
}

// Remove deletes a file, or a directory with everything under it.
//
// There is no undo behind this and no wastebasket to fish it back out of, so
// the interface asks first. That is the interface's job; this one does what it
// was told.
func Remove(root, path string) error {
	full, err := resolve(root, path)
	if err != nil {
		return err
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	// The session's own directory is not one of the things inside it.
	if full == realRoot {
		return uierr.New("err.file.notTheRoot")
	}
	if err := os.RemoveAll(full); err != nil {
		return uierr.With("err.file.notRemoved", err.Error())
	}
	return nil
}

/* resolveNew is resolve for a path that does not exist yet.
 *
 * The file itself cannot be followed to its real place, so the question moves to
 * its parent — and the parent has to be followed, not merely read. Checking the
 * written path was enough until somebody put a symlink inside the session: the
 * text "way-out/new.txt" begins with the session's directory and passes any test
 * made of string comparison, while the place it actually lands is wherever the
 * link points. Creating and deleting were added to this package, so that is no
 * longer the wrong file being read — it is a file written, or removed, anywhere
 * the link reaches.
 *
 * So the deepest part of the path that already exists is resolved for real, and
 * the containment question is asked there. Whatever does not exist yet is added
 * back afterwards; a directory that is not there cannot be a link to anywhere.
 */
func resolveNew(root, path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", uierr.New("err.file.noName")
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	full := path
	if !filepath.IsAbs(full) {
		full = filepath.Join(realRoot, full)
	}
	full = filepath.Clean(full)

	// Walk up to the first thing that is actually there.
	dir := filepath.Dir(full)
	rest := []string{filepath.Base(full)}
	for {
		if _, err := os.Lstat(dir); err == nil {
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", uierr.New("err.file.outsideSession")
		}
		rest = append([]string{filepath.Base(dir)}, rest...)
		dir = parent
	}

	realDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", uierr.With("err.file.unreadable", err.Error())
	}
	if realDir != realRoot && !strings.HasPrefix(realDir, realRoot+string(filepath.Separator)) {
		return "", uierr.New("err.file.outsideSession")
	}
	return filepath.Join(append([]string{realDir}, rest...)...), nil
}

func describe(full string) (*Entry, error) {
	st, err := os.Lstat(full)
	if err != nil {
		return nil, uierr.With("err.file.unreadable", err.Error())
	}
	return &Entry{
		Name: st.Name(),
		Path: full,
		Dir:  st.IsDir(),
		Size: st.Size(),
		Mod:  st.ModTime().UnixMilli(),
	}, nil
}
