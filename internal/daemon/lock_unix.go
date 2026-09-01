//go:build !windows

package daemon

import (
	"os"
	"syscall"
)

// takeLock keeps a second daemon from starting beside the first.
//
// The obvious check — read daemon.json, ask whether anybody answers, start one
// if not — has a gap in the middle: two windows opening at the same moment
// both look, both find nothing, both start a daemon. Two of them were running
// on this machine for a day.
//
// A file lock closes it, because the operating system settles who gets it.
// Held for as long as the process lives; released when it dies, however it
// dies.
func takeLock(path string) (*os.File, bool) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		// Cannot lock, so cannot decide — better one daemon too many than none
		// at all.
		return nil, true
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, false
	}
	return f, true
}
