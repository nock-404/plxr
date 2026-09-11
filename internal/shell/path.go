package shell

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

/* The PATH somebody actually has.

   A program started from the Dock, from Finder or by the system does not inherit
   the environment of anybody's shell. On macOS launchd hands out no PATH at all,
   so what an application gets is /usr/bin:/bin:/usr/sbin:/sbin — and every tool
   installed the way tools are installed these days, in ~/.local/bin or through
   a version manager, is not in it.

   plxr then reported that it could not find claude, on a machine where claude
   was plainly there and worked in any terminal. Started from a terminal it had
   always worked, which is why it took a bundled build to find this at all.

   So the login shell is asked once. It reads the profile files, which is where
   those directories are put, and the answer is the PATH the person types
   commands with.
*/

var (
	loginOnce sync.Once
	loginPath string
)

/* Remembered is the file the answer is kept in, set by whoever knows where
 * plxr keeps its things. Empty means: do not keep it.
 *
 * Asking costs a shell start, and on a machine with a drawn prompt that is
 * seconds — every single time plxr starts. Kept on disk it is paid once. What
 * is read back is used straight away and checked again in the background, so
 * a PATH that changed is right from the next start on rather than never.
 */
var Remembered string

// LoginPath is the PATH of the user's login shell, or "" if it cannot be had.
// Asked once and remembered: it means starting a shell, and the answer does not
// change while plxr runs.
func LoginPath() string {
	loginOnce.Do(func() { loginPath = rememberedOrAsked() })
	return loginPath
}

func rememberedOrAsked() string {
	if kept := readRemembered(); kept != "" {
		// Right away, and asked again behind it: a directory added to a
		// profile today is there the next time plxr starts. What was kept is
		// carried along behind the fresh answer — a shell that answered
		// poorly once, because the machine was busy or a profile misfired,
		// must not cost a directory that was known to be right.
		go func() { writeRemembered(joined(askLoginShell(), kept)) }()
		return kept
	}
	asked := askLoginShell()
	writeRemembered(asked)
	return asked
}

// joined is first, then whatever of second is not already in it.
func joined(first, second string) string {
	sep := string(os.PathListSeparator)
	seen := map[string]bool{}
	out := []string{}
	for _, dir := range append(strings.Split(first, sep), strings.Split(second, sep)...) {
		if dir == "" || seen[dir] {
			continue
		}
		seen[dir] = true
		out = append(out, dir)
	}
	return strings.Join(out, sep)
}

func readRemembered() string {
	if Remembered == "" {
		return ""
	}
	b, err := os.ReadFile(Remembered)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// writeRemembered keeps the answer, and never keeps an empty one: a shell that
// failed once would otherwise be remembered as "this machine has no PATH".
func writeRemembered(path string) {
	if Remembered == "" || strings.TrimSpace(path) == "" {
		return
	}
	// The state directory may not exist yet: on a fresh machine this is the
	// very first thing plxr writes, and the first answer is the expensive one.
	if os.MkdirAll(filepath.Dir(Remembered), 0o755) != nil {
		return
	}
	tmp := Remembered + ".tmp"
	if os.WriteFile(tmp, []byte(path+"\n"), 0o600) != nil {
		return
	}
	_ = os.Rename(tmp, Remembered)
}

/*
AdoptLoginPath puts that PATH into this process.

	Everything that looks for a program — starting a session, working out which
	CLIs exist, calling git — goes through this process's own PATH, so correcting
	it in one place corrects all of them.

	What the process already has is kept and appended: a PLXR_HOME set by hand, a
	PATH set deliberately for a test, both survive.
*/
var adoptOnce sync.Once

/* Prepare starts asking in the background.
 *
 * The daemon used to ask first and listen second — so on a machine whose
 * prompt takes six seconds to draw, daemon.json appeared after six seconds,
 * and the window, which gives up after eight, was one busy afternoon away
 * from "the daemon did not come up" at every first start. The listener does
 * not need the PATH; only a session about to start does, and that one waits
 * in AdoptLoginPath. Everything after the first start has the kept answer and
 * waits for nothing.
 */
func Prepare() { go LoginPath() }

func AdoptLoginPath() { adoptOnce.Do(adopt) }

func adopt() {
	from := LoginPath()
	if from == "" {
		return
	}
	sep := string(os.PathListSeparator)
	seen := map[string]bool{}
	out := []string{}
	for _, dir := range append(strings.Split(from, sep), strings.Split(os.Getenv("PATH"), sep)...) {
		if dir == "" || seen[dir] {
			continue
		}
		seen[dir] = true
		out = append(out, dir)
	}
	_ = os.Setenv("PATH", strings.Join(out, sep))
}
