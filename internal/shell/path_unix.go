//go:build !windows

package shell

import (
	"os"
	"os/exec"
	"strings"
	"time"
)

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
	sep := string(os.PathListSeparator)
	seen := map[string]bool{}
	out := []string{}

	// Most complete first. An interactive login shell reads both sets of files,
	// where it works at all — without a terminal some shells answer nothing to
	// it, which is why the plainer forms follow.
	for _, flags := range [][]string{{"-i", "-l"}, {"-i"}, {"-l"}} {
		for _, dir := range strings.Split(ask(argv[0], flags), sep) {
			if dir == "" || seen[dir] {
				continue
			}
			seen[dir] = true
			out = append(out, dir)
		}
	}
	return strings.Join(out, sep)
}

func ask(shell string, flags []string) string {
	// printf rather than echo: some shells add a newline that then travels
	// inside the value.
	args := append(append([]string{}, flags...), "-c", `printf %s "$PATH"`)
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
	case <-time.After(4 * time.Second):
		// A profile that waits for something must not hold up the start.
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return ""
	}
	if err != nil {
		return ""
	}
	got := strings.TrimSpace(string(out))
	if !strings.Contains(got, string(os.PathListSeparator)) {
		return "" // not a path list; something answered with something else
	}
	return got
}
