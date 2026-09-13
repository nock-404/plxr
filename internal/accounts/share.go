package accounts

/* One conversation history for several accounts.

   On this machine ~/.claude2/projects and ~/.claude3/projects are links to
   ~/.claude/projects. That is what lets a conversation be resumed under
   another account, and a session be moved between accounts, without copying
   a transcript anywhere: all three read the same files.

   An account added from the page got a projects folder of its own, empty, and
   nothing it said was visible to the other three — nor theirs to it. So an
   account can join the shared history, when it is added or later.

   The one rule: a projects folder only becomes a link while nothing is in it.
   A folder that holds anything is refused and left exactly as it is. Its
   conversations would otherwise vanish behind the link — still on disk, and
   unreachable from anywhere plxr or Claude Code look.
*/

import (
	"errors"
	"io/fs"
	"os"

	"plxr/internal/uierr"
)

// Store is the transcript directory an account joining the shared history
// would read: the one most accounts in the list already read, every link
// resolved. shared says whether more than one of them does.
//
// The account named skip is left out, so an account asking whom to join is
// not counted as its own company. A tie goes to the account listed first,
// which is the first account unless somebody reordered the list.
func Store(list []Account, skip string) (dir string, shared bool) {
	readers := map[string]int{}
	var order []string
	for _, a := range list {
		if a.Name == skip {
			continue
		}
		real := resolved(a.ProjectsDir())
		if real == "" {
			continue
		}
		if readers[real] == 0 {
			order = append(order, real)
		}
		readers[real]++
	}
	most := 0
	for _, d := range order {
		if readers[d] > most {
			dir, most = d, readers[d]
		}
	}
	return dir, most > 1
}

// linkable says whether projects can become a link to store without anything
// being lost. done is true when it already leads there. It changes nothing.
func linkable(projects, store string) (done bool, err error) {
	if resolved(projects) == store {
		return true, nil
	}
	info, err := os.Lstat(projects)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, uierr.With("err.account.notLinked", err.Error())
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return false, uierr.With("err.account.projectsLinked", projects)
	}
	if !info.IsDir() {
		return false, uierr.With("err.account.projectsNotEmpty", projects)
	}
	f, err := os.Open(projects)
	if err != nil {
		return false, uierr.With("err.account.notLinked", err.Error())
	}
	defer f.Close()
	if names, _ := f.Readdirnames(1); len(names) > 0 {
		return false, uierr.With("err.account.projectsNotEmpty", projects)
	}
	return false, nil
}

// link makes projects a link to store, under the rule linkable checks. The
// check is made again right here: a folder that was empty when the page was
// drawn need not be any more.
func link(projects, store string) error {
	done, err := linkable(projects, store)
	if err != nil || done {
		return err
	}
	_, statErr := os.Lstat(projects)
	existed := statErr == nil
	if existed {
		// Remove takes only an empty directory, so a file that arrived after
		// the check still stops it here, with the file where it was.
		if err := os.Remove(projects); err != nil {
			return uierr.With("err.account.projectsNotEmpty", projects)
		}
	}
	if err := os.Symlink(store, projects); err != nil {
		if existed {
			_ = os.Mkdir(projects, 0o755) // back to the empty folder it was
		}
		return uierr.With("err.account.notLinked", err.Error())
	}
	return nil
}

// Share joins an account that is already in the list to the history the
// others share. An account that already reads it is left as it is.
func Share(name string) ([]Account, error) {
	list := Discover()
	acc, ok := ByName(list, name)
	if !ok {
		return nil, uierr.With("err.account.unknown", name)
	}
	store, _ := Store(list, name)
	if store == "" {
		return nil, uierr.New("err.account.noStore")
	}
	if err := link(acc.ProjectsDir(), store); err != nil {
		return nil, err
	}
	return count(list), nil
}
