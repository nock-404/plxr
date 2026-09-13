// Package archive reads the archived Claude Code transcripts.
//
// Claude Code creates a projects/ folder per config directory, with one folder
// per working directory holding the transcripts as .jsonl. The folder name is
// the path with / replaced by -; more reliable however is the cwd field from
// the file itself, because special characters in the path make that name
// ambiguous.
package archive

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"plxr/internal/accounts"
)

type Entry struct {
	ID      string `json:"id"`      // session id = file name without extension
	Account string `json:"account"` // identifier of the account
	Path    string `json:"path"`    // absolute file path
	Cwd     string `json:"cwd"`
	Project string `json:"project"`
	Title   string `json:"title"`
	Branch  string `json:"branch"`
	Model   string `json:"model"`
	Size    int64  `json:"size"`
	Mod     int64  `json:"mod"`
	Loop    bool   `json:"loop"` // started with /loop — invisible in the built-in picker

	// Accounts are all accounts this transcript sits in. Anyone using several
	// accounts in parallel often has the same session on disk several times; it
	// is still shown only once.
	//
	// Sharing is not always a copy: point ~/.claude2/projects at
	// ~/.claude/projects and both accounts read one file. Both are listed here
	// all the same — what this field answers is "who can resume this", and the
	// answer is not made smaller by the accounts agreeing on a directory.
	Accounts []string `json:"accounts"`
}

// HasAccount says whether that account can reach this transcript — as the
// entry's own account or as one of the others the file sits in.
//
// Account alone is not the question to ask. It is whichever of the sharing
// accounts fold put in front, and asking only that one turned "resume this
// under account 3" into "transcript not found" while account 3 had the file
// open.
func (e Entry) HasAccount(name string) bool {
	if name == "" {
		return true
	}
	if e.Account == name {
		return true
	}
	for _, a := range e.Accounts {
		if a == name {
			return true
		}
	}
	return false
}

// header is what we need out of a transcript. Only the start and the end are
// read: with 150 files, some of them many megabytes, reading everything would be
// wasted, and both title and directory sit at the edges anyway.
type header struct {
	Type    string `json:"type"`
	AiTitle string `json:"aiTitle"`
	Cwd     string `json:"cwd"`
	Branch  string `json:"gitBranch"`
	Message struct {
		Model   string `json:"model"`
		Content any    `json:"content"`
	} `json:"message"`
}

const readLimit = 96 << 10

// store is one physical projects directory and every account that reads it.
type store struct {
	dir   string
	names []string
}

// resolve follows symlinks, so that a projects folder pointed at another one is
// recognised as that other one. Whatever cannot be resolved — a directory that
// is not there — is answered as it was asked, and simply turns up empty later.
func resolve(path string) string {
	if real, err := filepath.EvalSymlinks(path); err == nil {
		return real
	}
	return filepath.Clean(path)
}

/* Which directories to read, and who is reading each.
 *
 * Several accounts sharing one transcript store is the ordinary way to keep one
 * history across several logins: ~/.claude2/projects and ~/.claude3/projects
 * are symlinks to ~/.claude/projects. Walking each account separately then
 * reads and parses every file once per account and hands three identical
 * entries to fold — which kept one of them, with one account's name on it.
 *
 * Grouping first says the true thing instead: one directory, read once, and
 * all the accounts that reach it recorded against everything in it.
 */
func stores(accs []accounts.Account) []store {
	out := []store{}
	at := map[string]int{}
	for _, a := range accs {
		dir := resolve(a.ProjectsDir())
		if i, ok := at[dir]; ok {
			out[i].names = append(out[i].names, a.Name)
			continue
		}
		at[dir] = len(out)
		out = append(out, store{dir: dir, names: []string{a.Name}})
	}
	return out
}

// isDir says whether a listed entry is a directory, following a symlink to find
// out. A project folder linked in from somewhere else is a directory to
// everything that opens it, and was skipped here because readdir called it a
// link.
func isDir(path string, d os.DirEntry) bool {
	if d.IsDir() {
		return true
	}
	if d.Type()&os.ModeSymlink == 0 {
		return false
	}
	fi, err := os.Stat(path)
	return err == nil && fi.IsDir()
}

// List collects the transcripts of all accounts, newest first.
func List(accs []accounts.Account, pathFilter string) []Entry {
	out := []Entry{}
	for _, s := range stores(accs) {
		dirs, err := os.ReadDir(s.dir)
		if err != nil {
			continue
		}
		for _, d := range dirs {
			pdir := filepath.Join(s.dir, d.Name())
			if !isDir(pdir, d) {
				continue
			}
			files, err := os.ReadDir(pdir)
			if err != nil {
				continue
			}
			for _, f := range files {
				if !strings.HasSuffix(f.Name(), ".jsonl") {
					continue
				}
				path := filepath.Join(pdir, f.Name())
				info, err := f.Info()
				if err != nil {
					continue
				}
				if info.Mode()&os.ModeSymlink != 0 {
					// The link's own size and date say nothing about the
					// transcript; the file it points at does.
					if info, err = os.Stat(path); err != nil {
						continue
					}
				}
				if info.IsDir() {
					continue
				}
				e := Entry{
					ID:       strings.TrimSuffix(f.Name(), ".jsonl"),
					Account:  s.names[0],
					Accounts: append([]string(nil), s.names...),
					Path:     path,
					Size:     info.Size(),
					Mod:      info.ModTime().UnixMilli(),
				}
				read(&e)
				if e.Cwd == "" {
					e.Cwd = fromFolderName(d.Name())
				}
				e.Project = filepath.Base(e.Cwd)
				if pathFilter != "" && !strings.HasPrefix(e.Cwd, pathFilter) {
					continue
				}
				out = append(out, e)
			}
		}
	}
	return fold(out)
}

// fold merges the same transcript from several stores into one entry. The most
// recent copy leads — that is most likely the one last worked in — but every
// account holding a copy is kept, because which of them leads is an accident of
// modification times and being able to resume it is not.
func fold(in []Entry) []Entry {
	byID := map[string]*Entry{}
	order := []string{}
	for i := range in {
		e := in[i]
		existing, ok := byID[e.ID]
		if !ok {
			dup := e
			byID[e.ID] = &dup
			order = append(order, e.ID)
			continue
		}
		older := *existing
		if e.Mod > existing.Mod {
			*existing = e
		}
		existing.Accounts = append(append([]string(nil), older.Accounts...), e.Accounts...)
		// Fill in missing details from the other copy.
		if existing.Title == "" {
			existing.Title = firstOf(older.Title, e.Title)
		}
		if existing.Cwd == "" {
			existing.Cwd = firstOf(older.Cwd, e.Cwd)
		}
	}

	out := make([]Entry, 0, len(order))
	for _, id := range order {
		e := byID[id]
		e.Accounts = unique(e.Accounts)
		out = append(out, *e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Mod > out[j].Mod })
	return out
}

func firstOf(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// unique sorts and drops repeats: one account is named once even when it
// reaches the same transcript through two directories.
func unique(in []string) []string {
	sort.Strings(in)
	out := make([]string, 0, len(in))
	for i, v := range in {
		if i == 0 || v != in[i-1] {
			out = append(out, v)
		}
	}
	return out
}

// read pulls title, directory, branch and model out of the file.
func read(e *Entry) {
	f, err := os.Open(e.Path)
	if err != nil {
		return
	}
	defer f.Close()

	scan := func(r *bufio.Scanner) {
		r.Buffer(make([]byte, 0, 64*1024), 4<<20)
		for r.Scan() {
			line := r.Bytes()
			if len(line) == 0 || line[0] != '{' {
				continue
			}
			var k header
			if json.Unmarshal(line, &k) != nil {
				continue
			}
			if k.Type == "ai-title" && k.AiTitle != "" && e.Title == "" {
				e.Title = k.AiTitle
			}
			if k.Cwd != "" && e.Cwd == "" {
				e.Cwd = k.Cwd
			}
			if k.Branch != "" && k.Branch != "HEAD" && e.Branch == "" {
				e.Branch = k.Branch
			}
			if m := k.Message.Model; m != "" && m != "<synthetic>" && e.Model == "" {
				e.Model = m
			}
		}
	}

	// Read the start: cwd and the first prompt are there.
	scan(bufio.NewScanner(io.LimitReader(f, readLimit)))

	// Read the end: the most recently assigned title is there.
	if e.Size > readLimit {
		if _, err := f.Seek(-readLimit, io.SeekEnd); err == nil {
			br := bufio.NewReader(f)
			br.ReadString('\n') // drop the partial first line
			scan(bufio.NewScanner(br))
		}
	}
}

// fromFolderName turns "-Users-max-project" back into "/Users/max/project".
// A last resort only: hyphens in the real path cannot be recovered.
func fromFolderName(n string) string {
	if !strings.HasPrefix(n, "-") {
		return n
	}
	return strings.ReplaceAll(n, "-", "/")
}

// Delete removes a transcript. Only that exact file, no directory.
func Delete(e Entry) error { return os.Remove(e.Path) }

// Mirror copies a transcript into the project directory of another account so
// that `claude --resume` finds it there.
//
// Without this an account switch fails: Claude Code looks for transcripts only
// below its own configuration directory.
func Mirror(e Entry, target accounts.Account) (string, error) {
	folder := filepath.Base(filepath.Dir(e.Path))
	targetDir := filepath.Join(target.ProjectsDir(), folder)
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return "", err
	}
	targetPath := filepath.Join(targetDir, filepath.Base(e.Path))

	/* The same file under two names is already where it has to be.
	 *
	 * With ~/.claude2/projects pointed at ~/.claude/projects, source and target
	 * are one file, and copying it onto itself is the one case where this can
	 * destroy what it was asked to preserve: the contents are read, written to
	 * a temporary file and renamed over the original, so everything the running
	 * session appended in between is dropped and the transcript comes back
	 * shorter than it went in. The rename also puts a different file in place,
	 * which anything holding the old one open — Claude Code itself — keeps
	 * reading to no effect.
	 *
	 * The check that was here compared sizes and dates, which does catch this
	 * in a quiet moment, but it is two stat calls of a file that is being
	 * appended to. Identity is not a matter of timing: one file, nothing to do.
	 */
	if same, err := sameFile(e.Path, targetPath); err == nil && same {
		return targetPath, nil
	}

	// Already up to date? Then do nothing.
	if zi, err := os.Stat(targetPath); err == nil {
		if qi, err := os.Stat(e.Path); err == nil &&
			zi.Size() == qi.Size() && !qi.ModTime().After(zi.ModTime()) {
			return targetPath, nil
		}
	}

	data, err := os.ReadFile(e.Path)
	if err != nil {
		return "", err
	}
	tmp := targetPath + ".plxr-tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, targetPath); err != nil {
		os.Remove(tmp)
		return "", err
	}
	_ = os.Chtimes(targetPath, time.Now(), time.Now())
	return targetPath, nil
}

// sameFile says whether two paths are one file — the same inode, however many
// symlinks lead to it. A path that is not there is not the same as anything.
func sameFile(a, b string) (bool, error) {
	ai, err := os.Stat(a)
	if err != nil {
		return false, err
	}
	bi, err := os.Stat(b)
	if err != nil {
		return false, err
	}
	return os.SameFile(ai, bi), nil
}
