//go:build darwin

package browse

import "os/exec"

func open(link string) error { return exec.Command("open", link).Start() }
