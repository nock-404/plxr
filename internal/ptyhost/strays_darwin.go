//go:build darwin

package ptyhost

import (
	"os"

	"golang.org/x/sys/unix"
)

// findStrays walks the process table once — kern.proc.all hands out parent,
// group and controlling terminal of every process — and asks the kernel for
// the environment (kern.procargs2) only of those not already matched. The
// environment is only readable for the user's own processes, which is the only
// kind a session starts.
//
// Two lists come back: the processes that carry the mark, which are this
// run's beyond doubt, and those matched by terminal or descent, which the
// caller trusts only while the run is alive.
func findStrays(q strayQuery) (sure, loose []int) {
	all, err := unix.SysctlKinfoProcSlice("kern.proc.all")
	if err != nil {
		return nil, nil
	}
	var dev uint64
	if q.tty != "" {
		var st unix.Stat_t
		if unix.Stat(q.tty, &st) == nil {
			dev = uint64(st.Rdev)
		}
	}
	me := os.Getpid()
	parent := make(map[int]int, len(all))
	for _, kp := range all {
		parent[int(kp.Proc.P_pid)] = int(kp.Eproc.Ppid)
	}
	for _, kp := range all {
		pid := int(kp.Proc.P_pid)
		if pid <= 1 || pid == me || pid == q.root {
			continue
		}
		raw, err := unix.SysctlRaw("kern.procargs2", pid)
		switch {
		case err == nil && carriesMark(raw, q.mark):
			sure = append(sure, pid)
		case dev != 0 && uint64(uint32(kp.Eproc.Tdev)) == dev:
			loose = append(loose, pid)
		case q.root > 0 && descends(parent, pid, q.root):
			loose = append(loose, pid)
		}
	}
	return sure, loose
}
