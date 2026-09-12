package ptyhost

import "bytes"

// carriesMark says whether a NUL-separated environment block carries this
// run's mark. The block is searched with a NUL on either side so that a mark
// which is a prefix of another — or an argument that merely mentions the
// variable — cannot match.
func carriesMark(raw []byte, mark string) bool {
	want := []byte("\x00" + SessionMark + "=" + mark + "\x00")
	block := make([]byte, 0, len(raw)+2)
	block = append(block, 0)
	block = append(block, raw...)
	block = append(block, 0)
	return bytes.Contains(block, want)
}

// descends says whether pid is below root in the process tree. Bounded, since
// a table read in one go can still hold a cycle from a pid reused mid-read.
func descends(parent map[int]int, pid, root int) bool {
	for hops := 0; hops < 64; hops++ {
		p, ok := parent[pid]
		if !ok || p <= 1 {
			return false
		}
		if p == root {
			return true
		}
		pid = p
	}
	return false
}
