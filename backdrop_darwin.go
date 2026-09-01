//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fmodules
#cgo LDFLAGS: -framework Cocoa
void plxrSetBackdrop(void *nsWindow, int kind);
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
	}
	C.plxrSetBackdrop(nsWindow, C.int(n))
}
