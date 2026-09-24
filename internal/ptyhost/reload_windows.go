//go:build windows

package ptyhost

// reloadProcess — see reload_unix.go. Windows has no SIGHUP and no foreground
// process group, and there is no console event that means "reload your
// configuration". Saying so is better than sending something that ends the
// program instead.
func reloadProcess(uintptr, int) (bool, string) {
	return false, "reloading is not available on Windows"
}
