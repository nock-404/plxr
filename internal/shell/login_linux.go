//go:build linux

package shell

import (
	"os"
	"os/exec"
	"strings"
)

// Linux keeps it in the last field of the passwd entry. getent is asked rather
// than the file being read, so a user who lives in LDAP or systemd-homed is
// found as well.
func loginShell() string {
	user := os.Getenv("USER")
	if user == "" {
		user = os.Getenv("LOGNAME")
	}
	if user == "" {
		return ""
	}
	out, err := exec.Command("getent", "passwd", user).Output()
	if err != nil {
		return ""
	}
	// name:x:uid:gid:gecos:home:shell
	fields := strings.Split(strings.TrimSpace(string(out)), ":")
	if len(fields) >= 7 {
		return fields[6]
	}
	return ""
}
