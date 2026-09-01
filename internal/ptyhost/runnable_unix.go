//go:build !windows

package ptyhost

// On unix a command is a program and the PTY starts it. Nothing to unwrap.
func runnable(argv []string) []string { return argv }
