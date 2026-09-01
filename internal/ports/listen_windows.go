//go:build windows

package ports

import (
	"os/exec"
	"strconv"
	"strings"
)

/* Windows keeps the same information in two places.
 *
 * netstat pairs a listening address with the process that holds it, and knows
 * the number but not the name. tasklist knows the names. Neither needs
 * administrator rights, which is the whole point — the list is meant to be
 * looked at, not fought for.
 */
func listening(own map[int]bool) []Entry {
	out, err := exec.Command("netstat", "-ano", "-p", "TCP").Output()
	if err != nil && len(out) == 0 {
		return nil
	}

	names := commandNames()
	res := []Entry{}
	seen := map[string]bool{}

	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		// Proto  Local Address  Foreign Address  State  PID
		if len(fields) < 5 || !strings.EqualFold(fields[3], "LISTENING") {
			continue
		}
		local := fields[1]
		cut := strings.LastIndex(local, ":")
		if cut < 0 {
			continue
		}
		port, err := strconv.Atoi(local[cut+1:])
		if err != nil {
			continue
		}
		pid, err := strconv.Atoi(fields[4])
		if err != nil {
			continue
		}
		key := fields[4] + ":" + local[cut+1:]
		if seen[key] {
			continue
		}
		seen[key] = true
		res = append(res, Entry{
			PID: pid, Command: names[pid], Port: port,
			Addr: local[:cut], Own: own[pid],
		})
	}
	return res
}

// commandNames maps a process id to the name of its program. A failure here
// costs the names and nothing else, so the list is still worth showing.
func commandNames() map[int]string {
	out, err := exec.Command("tasklist", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return map[int]string{}
	}
	names := map[int]string{}
	for _, line := range strings.Split(string(out), "\n") {
		// "name.exe","1234","Console","1","1,234 K"
		parts := strings.Split(line, `","`)
		if len(parts) < 2 {
			continue
		}
		pid, err := strconv.Atoi(strings.Trim(parts[1], `"`))
		if err != nil {
			continue
		}
		names[pid] = strings.TrimSuffix(strings.Trim(parts[0], `"`), ".exe")
	}
	return names
}
