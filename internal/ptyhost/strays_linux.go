//go:build linux

package ptyhost

import (
	"bytes"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// findStrays reads /proc: the environment of every own process is there in
// full — a zombie's is empty — and /proc/<pid>/stat carries the parent. The
// mark alone finds everything a session started; descent is kept as the
// second opinion for a program that scrubbed its environment, and is only
// trusted by the caller while the run is alive.
func findStrays(q strayQuery) (sure, loose []int) {
	dirs, _ := filepath.Glob("/proc/[0-9]*")
	me := os.Getpid()
	parent := map[int]int{}
	pids := make([]int, 0, len(dirs))
	for _, d := range dirs {
		pid, err := strconv.Atoi(filepath.Base(d))
		if err != nil {
			continue
		}
		pids = append(pids, pid)
		if q.root > 0 {
			parent[pid] = ppidOf(d)
		}
	}
	for _, pid := range pids {
		if pid <= 1 || pid == me || pid == q.root {
			continue
		}
		raw, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "environ"))
		switch {
		case err == nil && carriesMark(raw, q.mark):
			sure = append(sure, pid)
		case q.root > 0 && descends(parent, pid, q.root):
			loose = append(loose, pid)
		}
	}
	return sure, loose
}

// ppidOf reads the parent out of /proc/<pid>/stat. The command name in
// parentheses may hold spaces, so the fields are counted from its closing one.
func ppidOf(dir string) int {
	raw, err := os.ReadFile(filepath.Join(dir, "stat"))
	if err != nil {
		return 0
	}
	i := bytes.LastIndexByte(raw, ')')
	if i < 0 {
		return 0
	}
	fields := strings.Fields(string(raw[i+1:]))
	if len(fields) < 2 {
		return 0
	}
	ppid, _ := strconv.Atoi(fields[1])
	return ppid
}
