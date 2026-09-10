//go:build !windows

package shell

import (
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

/* Patience is how long a shell may take to say what its PATH is.
 *
 * It was four seconds, which is generous for a shell and not generous for a
 * prompt: the machine this was written for takes 5.6 seconds to start an
 * interactive shell, because of the theme it draws. Over the limit the shell
 * was killed and its answer thrown away — and that answer was the only one
 * that knew about ~/.local/bin, where claude is installed. plxr then said it
 * could not find claude on a machine where claude works in every terminal.
 *
 * It is paid once, at the start of a daemon that runs for days, and only the
 * first time: the answer is kept, see path.go.
 */
var Patience = 20 * time.Second

/*
Asking the shell where the tools are.

	There is no single question that gets the whole answer. A login shell reads
	.zprofile and .zshenv; an interactive one reads .zshrc — and that is where
	people put their PATH, because that is where every guide tells them to. Asked
	as a login shell on this machine the answer came back 550 characters long and
	without ~/.local/bin, which is exactly where claude lives. Asked
	interactively: 657 characters, and there it was.

	So all the forms are asked and the answers put together. Two or three shell
	starts, once, at the start of a daemon that then runs for days.
*/
func askLoginShell() string {
	argv := Default()
	if len(argv) == 0 {
		return ""
	}

	/* All the forms at once, not one after the other.
	 *
	 * Asked in turn, a shell that takes six seconds to start costs six
	 * seconds per form, and the slowest form is the first one. Asked
	 * together it costs six seconds altogether — and the answers are still
	 * put back in the same order, most complete first, because that order is
	 * what decides which directory comes before which.
	 */
	forms := [][]string{{"-i", "-l"}, {"-i"}, {"-l"}}
	answers := make([]string, len(forms))
	var wg sync.WaitGroup
	for i, flags := range forms {
		wg.Add(1)
		go func(i int, flags []string) {
			defer wg.Done()
			answers[i] = ask(argv[0], flags)
		}(i, flags)
	}
	wg.Wait()

	sep := string(os.PathListSeparator)
	seen := map[string]bool{}
	out := []string{}
	for _, answer := range answers {
		for _, dir := range strings.Split(answer, sep) {
			if dir == "" || seen[dir] {
				continue
			}
			seen[dir] = true
			out = append(out, dir)
		}
	}
	return strings.Join(out, sep)
}

/* marker is how the answer is told apart from everything else the shell says.
 *
 * A profile prints things. Somebody's .zshrc calls a theme helper that, with no
 * terminal to draw on, writes its usage to standard output — and the first
 * version of this took whatever came back as the PATH, because it checked only
 * that the text contained a colon, and "Usage: prompt <options>" does. That
 * usage text then became the front of the PATH of every session plxr started.
 * It still worked, because the real directories were appended behind it, which
 * is exactly why it went unnoticed.
 *
 * So the shell is asked to mark its answer, and only the marked line is read.
 */
const marker = "PLXR-PATH:"

func ask(shell string, flags []string) string {
	// printf rather than echo: some shells add a newline that then travels
	// inside the value.
	args := append(append([]string{}, flags...), "-c", `printf '`+marker+`%s\n' "$PATH"`)
	cmd := exec.Command(shell, args...)
	cmd.Env = os.Environ()
	// An interactive shell with nothing to read from would otherwise sit there.
	cmd.Stdin = nil

	done := make(chan struct{})
	var out []byte
	var err error
	go func() {
		out, err = cmd.Output()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(Patience):
		// A profile that waits for something must not hold up the start.
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return ""
	}
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.HasPrefix(line, marker) {
			continue
		}
		return usable(strings.TrimSpace(strings.TrimPrefix(line, marker)))
	}
	return ""
}

// usable keeps the entries that are actually directories to look in. Anything
// else a shell may have said on the way is not one, and a PATH with rubbish at
// the front is worse than no answer: every lookup walks past it first.
func usable(list string) string {
	sep := string(os.PathListSeparator)
	out := []string{}
	for _, dir := range strings.Split(list, sep) {
		if strings.HasPrefix(dir, "/") && !strings.ContainsAny(dir, " \t") {
			out = append(out, dir)
		}
	}
	if len(out) == 0 {
		return ""
	}
	return strings.Join(out, sep)
}
