// Package ports zeigt, welcher Prozess welchen Port belegt.
//
// Anlass sind vergessene Dev-Server: ein Nuxt auf 3000, das seit Tagen läuft
// und den nächsten Start blockiert. lsof ist dafür das einzige Werkzeug, das
// ohne Root auskommt und trotzdem Prozess und Port zusammenbringt.
package ports

import (
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

type Eintrag struct {
	PID     int    `json:"pid"`
	Command string `json:"command"`
	Port    int    `json:"port"`
	Addr    string `json:"addr"`
	User    string `json:"user"`
	Eigen   bool   `json:"eigen"` // gehört zu einer plxr-Session
}

// List liest die lauschenden TCP-Ports. eigene ordnet PIDs plxr-Sessions zu.
func List(eigene map[int]bool) []Eintrag {
	// -F erzwingt ein zeilenweises Format, das sich verlässlich parsen lässt;
	// die Spaltenausgabe von lsof bricht bei Leerzeichen im Prozessnamen.
	out, err := exec.Command("lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-FpcnuL").Output()
	if err != nil && len(out) == 0 {
		return []Eintrag{}
	}

	res := []Eintrag{}
	var pid int
	var cmd, user string
	gesehen := map[string]bool{}

	for _, line := range strings.Split(string(out), "\n") {
		if len(line) < 2 {
			continue
		}
		wert := line[1:]
		switch line[0] {
		case 'p':
			pid, _ = strconv.Atoi(wert)
			cmd, user = "", ""
		case 'c':
			cmd = wert
		case 'L':
			user = wert
		case 'n':
			addr := wert
			i := strings.LastIndex(addr, ":")
			if i < 0 {
				continue
			}
			port, err := strconv.Atoi(addr[i+1:])
			if err != nil {
				continue
			}
			schluessel := strconv.Itoa(pid) + ":" + addr[i+1:]
			if gesehen[schluessel] {
				continue
			}
			gesehen[schluessel] = true
			res = append(res, Eintrag{
				PID: pid, Command: cmd, Port: port,
				Addr: addr[:i], User: user, Eigen: eigene[pid],
			})
		}
	}

	sort.Slice(res, func(i, j int) bool { return res[i].Port < res[j].Port })
	return res
}
