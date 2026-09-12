//go:build !darwin && !linux

package ptyhost

// findStrays finds nothing here: on Windows the job object holds the session
// together, and the other systems have no portable way to read another
// process's environment.
func findStrays(strayQuery) (sure, loose []int) { return nil, nil }
