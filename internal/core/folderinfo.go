package core

import (
	"path/filepath"

	"plxr/internal/folder"
	"plxr/internal/git"
)

/* Everything the overview of an open folder shows, in one answer.
 *
 * One route rather than eight. The half of the folders view that this fills
 * was an empty box reading "pick a file", and the reason it stayed one is
 * that every fact on it — where the branch stands, what HEAD did, where the
 * remote is, what the folder is written in — lived behind a different call or
 * behind no call at all. Eight round trips would also mean eight moments at
 * which the panel is half drawn, which is the shape the rest of this window
 * spent a long time getting rid of.
 */

// FolderReport is the state of one open folder, git and otherwise.
type FolderReport struct {
	Path string `json:"path"`
	Name string `json:"name"`
	// Repo says whether there is a repository here at all. A plain folder is
	// an ordinary thing to have open, not a failure, so it gets the facts that
	// apply to it and none of the git sections.
	Repo  bool       `json:"repo"`
	Where *git.Where `json:"where,omitempty"`
	// What differs right now, counted the way the changes panel groups it.
	Staged    int  `json:"staged"`
	Unstaged  int  `json:"unstaged"`
	Untracked int  `json:"untracked"`
	Dirty     bool `json:"dirty"`
	Stashes   int  `json:"stashes"`
	// Fetched is when the repository last heard from a remote, in
	// milliseconds; 0 when it never has.
	Fetched int64             `json:"fetched"`
	Head    *git.CommitDetail `json:"head,omitempty"`
	Log     []git.Entry       `json:"log"`
	Remotes []git.Remote      `json:"remotes"`
	Facts   folder.Facts      `json:"facts"`
}

// FolderReport reads everything the overview shows about one folder.
func (c *Core) FolderReport(id string) (FolderReport, error) {
	root, err := c.root(id)
	if err != nil {
		return FolderReport{}, err
	}
	out := FolderReport{
		Path:    root,
		Name:    filepath.Base(root),
		Log:     []git.Entry{},
		Remotes: []git.Remote{},
		Facts:   folder.Survey(root),
	}
	if !git.IsRepo(root) {
		return out, nil
	}
	out.Repo = true

	/* Every git call below is allowed to fail on its own.
	 *
	 * A repository with no commits has no HEAD and no history, a repository
	 * with no remote has no remotes, and none of that is a fault to report —
	 * it is the state of a folder somebody just ran `git init` in. Refusing
	 * the whole answer because one of six calls found nothing is how a view
	 * ends up blank for the exact folder that most needed explaining.
	 */
	if where, err := git.Position(root); err == nil {
		out.Where = &where
	}
	if changes, err := git.Changes(root); err == nil {
		for _, one := range changes {
			if one.Untracked() {
				out.Untracked++
				continue
			}
			if one.Staged() {
				out.Staged++
			}
			if one.Work != " " && one.Work != "" {
				out.Unstaged++
			}
		}
		out.Dirty = len(changes) > 0
	}
	out.Stashes = git.StashCount(root)
	out.Fetched = git.Fetched(root)
	if head, err := git.Show(root, "HEAD"); err == nil {
		out.Head = &head
	}
	if log, err := git.Log(root, 12); err == nil {
		out.Log = log
	}
	if remotes, err := git.Remotes(root); err == nil {
		out.Remotes = remotes
	}
	return out, nil
}

// ShowCommit reads one commit of a folder's repository in full.
func (c *Core) ShowCommit(id, ref string) (git.CommitDetail, error) {
	root, err := c.repo(id)
	if err != nil {
		return git.CommitDetail{}, err
	}
	return git.Show(root, ref)
}
