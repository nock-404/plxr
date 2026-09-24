//go:build darwin

package main

import "testing"

/* The first click into a window that is not in front has to count.
 *
 * AppKit asks the view under the pointer whether it accepts the first mouse,
 * and every view says no unless it says otherwise — so coming back from
 * another application took two clicks, one to wake the window and one to do
 * anything. The first attempt answered for WKWebView, which is not the view
 * being asked: the click lands on one of WebKit's own, deep inside. Measured
 * here rather than assumed, because the last version was shipped on the
 * assumption and the second click was still needed.
 */
func TestAViewTakesTheFirstClick(t *testing.T) {
	if before := firstMouseAnswer(); before != 0 {
		t.Fatalf("the question was already answered by something else: %d", before)
	}
	takeFirstClick()
	if got := firstMouseAnswer(); got != 1 {
		t.Errorf("after the change the answer comes from %d, wanted plxr's own (1)", got)
	}
}
