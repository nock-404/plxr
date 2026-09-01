//go:build windows

package ports

import (
	"os/exec"
	"plxr/internal/sys"
	"strconv"
	"strings"
)

/* Which ports are being listened on, asked in a way that does not depend on the
   language Windows is installed in.

   The first version read `netstat -ano` and kept the rows whose fourth column
   said LISTENING. On a German Windows that column says something else, on a French one
   something else again — so the filter matched nothing and the ports view was
   empty on every machine that was not set to English. It looked like the feature
   had simply not been built.

   PowerShell hands the same information back as data rather than as a table
   somebody has to read, and the field names are the same everywhere. netstat
   stays as a fallback, matched on the shape of a listening row instead of on a
   word: a listening socket has no remote end, which every language writes as
   0.0.0.0:0 or [::]:0.
*/

func listening(own map[int]bool) []Entry {
	if res := fromPowerShell(own); len(res) > 0 {
		return res
	}
	return fromNetstat(own)
}

func fromPowerShell(own map[int]bool) []Entry {
	const script = `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
ForEach-Object {
  $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  "$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)|$($p.ProcessName)"
}`
	out, err := sys.Quiet(exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)).Output()
	if err != nil {
		return nil
	}

	res := []Entry{}
	seen := map[string]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		parts := strings.Split(strings.TrimSpace(line), "|")
		if len(parts) < 4 {
			continue
		}
		port, err := strconv.Atoi(parts[1])
		if err != nil {
			continue
		}
		pid, err := strconv.Atoi(parts[2])
		if err != nil {
			continue
		}
		key := parts[2] + ":" + parts[1]
		if seen[key] {
			continue
		}
		seen[key] = true
		res = append(res, Entry{
			PID: pid, Command: parts[3], Port: port,
			Addr: parts[0], Own: own[pid],
		})
	}
	return res
}

func fromNetstat(own map[int]bool) []Entry {
	out, err := sys.Quiet(exec.Command("netstat", "-ano", "-p", "TCP")).Output()
	if err != nil && len(out) == 0 {
		return nil
	}

	names := commandNames()
	res := []Entry{}
	seen := map[string]bool{}

	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		// Proto  Local  Remote  State  PID — and the state is in whatever
		// language this Windows speaks, so it is the remote end that is read:
		// a socket that is listening has nobody at the other end.
		if len(fields) < 5 || !strings.EqualFold(fields[0], "TCP") {
			continue
		}
		if !strings.HasSuffix(fields[2], ":0") {
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
		pid, err := strconv.Atoi(fields[len(fields)-1])
		if err != nil {
			continue
		}
		key := fields[len(fields)-1] + ":" + local[cut+1:]
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
	out, err := sys.Quiet(exec.Command("tasklist", "/FO", "CSV", "/NH")).Output()
	if err != nil {
		return map[int]string{}
	}
	names := map[int]string{}
	for _, line := range strings.Split(string(out), "\n") {
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
