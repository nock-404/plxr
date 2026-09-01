//go:build windows

package daemon

import (
	"os"

	"golang.org/x/sys/windows"
)

// takeLock — see lock_unix.go. Windows locks byte ranges rather than files,
// and one byte is enough for the question being asked here.
func takeLock(path string) (*os.File, bool) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, true
	}
	var overlapped windows.Overlapped
	err = windows.LockFileEx(windows.Handle(f.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY,
		0, 1, 0, &overlapped)
	if err != nil {
		f.Close()
		return nil, false
	}
	return f, true
}
