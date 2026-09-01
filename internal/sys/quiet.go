// Package sys holds the few things that have to be done differently depending
// on the system, and that do not belong to any one feature.
package sys

import "os/exec"

/* Quiet runs a helper without a window of its own.
 *
 * On Windows a program with no console gets one made for it the moment it starts
 * another program — and it is a black box that appears on screen, in front of
 * whatever somebody was doing. plxr runs helpers all the time: git status while
 * a file tree is open, the list of listening ports, a notification. Every one of
 * them flashed a console up.
 *
 * Everywhere else there is nothing to hide and this changes nothing.
 */
func Quiet(c *exec.Cmd) *exec.Cmd {
	quiet(c)
	return c
}
