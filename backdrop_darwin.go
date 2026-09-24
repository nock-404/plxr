//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fmodules
#cgo LDFLAGS: -framework Cocoa -framework QuartzCore
void plxrSetBackdrop(void *nsWindow, int kind);
void plxrFollowScreen(void *nsWindow);
void plxrTakeFirstClick(void);
int plxrFirstMouseAnswer(void);
*/
import "C"

import "unsafe"

// applyBackdrop changes what lies between the window and the desktop, while the
// window is open.
func applyBackdrop(nsWindow unsafe.Pointer, kind string) {
	n := 1
	switch kind {
	case "clear":
		n = 0
	case "glass":
		n = 2
	case "solid":
		n = 3
	}
	C.plxrSetBackdrop(nsWindow, C.int(n))
}

// followScreen keeps the window drawing at the scale of the screen it is on.
// Without it a window moved to a screen of another scale keeps the old one and
// is drawn soft — see the note in backdrop_darwin.m.
func followScreen(nsWindow unsafe.Pointer) {
	C.plxrFollowScreen(nsWindow)
}

// takeFirstClick makes the first click into an inactive window count, instead
// of only waking it — see the note in backdrop_darwin.m.
func takeFirstClick() { C.plxrTakeFirstClick() }

// firstMouseAnswer is what a fresh view answers when asked whether it takes
// the first click: 1 yes, 0 no. For the check, not for the window.
func firstMouseAnswer() int { return int(C.plxrFirstMouseAnswer()) }
