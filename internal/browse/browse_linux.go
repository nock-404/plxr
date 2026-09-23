//go:build linux

package browse

import "os/exec"

func open(link string) error { return exec.Command("xdg-open", link).Start() }
