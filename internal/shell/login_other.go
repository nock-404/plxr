//go:build !darwin && !linux

package shell

// Windows does not have a login shell in this sense: what to start is decided
// by which of its shells is installed, in windowsShell.
func loginShell() string { return "" }
