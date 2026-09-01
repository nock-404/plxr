//go:build !windows

package ports

import (
	"os/exec"
	"strconv"
	"strings"
)

// lsof is the one tool for this that gets by without root and still pairs up
// process and port.
func listening(own map[int]bool) []Entry {
	// -F forces a line-oriented format that can be parsed reliably; the column
	// output of lsof breaks on spaces in the process name.
	out, err := exec.Command("lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-FpcnuL").Output()
	if err != nil && len(out) == 0 {
		return []Entry{}
	}

	res := []Entry{}
	var pid int
	var cmd, user string
	seen := map[string]bool{}

	for _, line := range strings.Split(string(out), "\n") {
		if len(line) < 2 {
			continue
		}
		value := line[1:]
		switch line[0] {
		case 'p':
			pid, _ = strconv.Atoi(value)
			cmd, user = "", ""
		case 'c':
			cmd = value
		case 'L':
			user = value
		case 'n':
			addr := value
			i := strings.LastIndex(addr, ":")
			if i < 0 {
				continue
			}
			port, err := strconv.Atoi(addr[i+1:])
			if err != nil {
				continue
			}
			key := strconv.Itoa(pid) + ":" + addr[i+1:]
			if seen[key] {
				continue
			}
			seen[key] = true
			res = append(res, Entry{
				PID: pid, Command: cmd, Port: port,
				Addr: addr[:i], User: user, Own: own[pid],
			})
		}
	}

	return res
}
