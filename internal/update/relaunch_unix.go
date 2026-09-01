//go:build !windows

package update

import (
	"fmt"
	"os/exec"
	"runtime"
	"syscall"
)

// A small shell holds the door: it waits for the old process to disappear, then
// opens the new one. Detached, so it survives the exit it is waiting for.
func relaunch(path string, oldPID int) error {
	open := fmt.Sprintf("open -n %q", path)
	if runtime.GOOS != "darwin" {
		open = fmt.Sprintf("%q &", path)
	}
	/* Waiting with kill -0 does not work here.
	   A process that has exited but has not been reaped is still in the table,
	   and kill -0 succeeds on it — so the wait never ended, and the new version
	   was never opened. Measured, with the old daemon sitting there as <defunct>
	   and the waiting shell looping beside it. The state is asked for instead: a
	   Z means gone as far as anybody else is concerned. */
	script := fmt.Sprintf(
		"while ps -p %d -o stat= 2>/dev/null | grep -q '^[^Z]'; do sleep 0.2; done; %s",
		oldPID, open)

	cmd := exec.Command("sh", "-c", script)
	// Its own session, so it is not taken down with the process it is waiting for.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return cmd.Start()
}
