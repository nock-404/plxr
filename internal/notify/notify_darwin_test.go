//go:build darwin

package notify

import "testing"

func TestSystemSettingsOpensOnPlxrsOwnSwitches(t *testing.T) {
	if got := settingsURL("dev.plxr.app"); got != "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=dev.plxr.app" {
		t.Errorf("url %q", got)
	}
	if got := settingsURL("x&y"); got != settingsPane {
		t.Errorf("a malformed identifier reached the url: %q", got)
	}
}
