// Package ports zeigt, welcher Prozess welchen Port belegt.
//
// The reason are forgotten dev servers: a Nuxt on 3000 that has been running
// for days and blocks the next start. lsof is the only tool for this that gets
// by without root and still pairs up process and port.
package ports

import (
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

type Entry struct {
	PID     int    `json:"pid"`
	Command string `json:"command"`
	Port    int    `json:"port"`
	Addr    string `json:"addr"`
	User    string `json:"user"`
	Eigen   bool   `json:"eigen"` // belongs to a plxr session
}

// List reads the listening TCP ports. own maps PIDs to plxr sessions.
func List(own map[int]bool) []Entry {
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
				Addr: addr[:i], User: user, Eigen: own[pid],
			})
		}
	}

	sort.Slice(res, func(i, j int) bool { return res[i].Port < res[j].Port })
	return res
}
