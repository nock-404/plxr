package files

import (
	"os/exec"
	"plxr/internal/sys"
	"strings"
)

/* What git thinks of each file, for the browser to show.

   Asked in one call for the whole tree rather than per entry: `git status` on a
   large repository is not free, and one call per row would make opening a
   folder cost as many processes as it has files in it.

   A directory that is not a repository is a normal state, not a fault: the
   answer is then simply that nothing is known, and the browser shows no marks.
*/

// State is what git says about one path, in the words the interface uses.
type State string

const (
	Modified  State = "modified"
	Added     State = "added"
	Deleted   State = "deleted"
	Untracked State = "untracked"
	Conflict  State = "conflict"
)

// Status maps a path, relative to the repository, to its state. Only paths git
// has something to say about appear.
func Status(root string) map[string]State {
	out := map[string]State{}
	// --porcelain is the form promised to stay stable between versions; -z
	// separates with NUL so a file name with a space or a newline in it does not
	// split into two entries.
	cmd := sys.Quiet(exec.Command("git", "-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"))
	b, err := cmd.Output()
	if err != nil {
		return out // not a repository, or no git: nothing is known
	}
	fields := strings.Split(string(b), "\x00")
	for i := 0; i < len(fields); i++ {
		line := fields[i]
		if len(line) < 4 {
			continue
		}
		code, path := line[:2], line[3:]
		// A rename carries its old name in the next field; that name is not a
		// file any more, so it is read and dropped.
		if strings.ContainsRune(code, 'R') && i+1 < len(fields) {
			i++
		}
		out[path] = stateOf(code)
	}
	return out
}

func stateOf(code string) State {
	switch {
	case code == "??":
		return Untracked
	case strings.ContainsAny(code, "U") || code == "AA" || code == "DD":
		return Conflict
	case strings.ContainsRune(code, 'D'):
		return Deleted
	case strings.ContainsAny(code, "AR"):
		return Added
	default:
		return Modified
	}
}
