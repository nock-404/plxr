//go:build !darwin

package main

import "unsafe"

// Only macOS puts a material behind a window; elsewhere a window is a window,
// and the page's own see-through settings are the whole of it.
func applyBackdrop(unsafe.Pointer, string) {}
