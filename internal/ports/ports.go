// Package ports shows which process holds which port.
//
// The reason are forgotten dev servers: a Nuxt on 3000 that has been running
// for days and blocks the next start.
//
// How the list is obtained is the one part that differs by system, so it lives
// in a file per system. It used to be lsof for everybody, which is a program
// Windows does not have: there the list was simply always empty, with nothing
// anywhere saying why.
package ports

import "sort"

type Entry struct {
	PID     int    `json:"pid"`
	Command string `json:"command"`
	Port    int    `json:"port"`
	Addr    string `json:"addr"`
	User    string `json:"user"`
	Own     bool   `json:"own"` // belongs to a plxr session
}

// List reads the listening TCP ports. own maps PIDs to plxr sessions.
func List(own map[int]bool) []Entry {
	res := listening(own)
	if res == nil {
		res = []Entry{}
	}
	sort.Slice(res, func(i, j int) bool { return res[i].Port < res[j].Port })
	return res
}
