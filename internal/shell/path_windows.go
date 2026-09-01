//go:build windows

package shell

// Windows keeps the PATH in the registry and every process gets it, however it
// was started. There is no profile to read and nothing to correct.
func askLoginShell() string { return "" }
