//go:build darwin

package shell

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// macOS keeps it in the directory service rather than in /etc/passwd.
func loginShell() string {
	user := os.Getenv("USER")
	if user == "" {
		return ""
	}
	out, err := exec.Command("dscl", ".", "-read", filepath.Join("/Users", user), "UserShell").Output()
	if err != nil {
		return ""
	}
	// "UserShell: /bin/zsh"
	if f := strings.Fields(string(out)); len(f) == 2 {
		return f[1]
	}
	return ""
}
