//go:build darwin

package notify

import "os/exec"

// serviceRoute is how the service would show a notification itself. On macOS
// it has none, and that is the fix, not an omission.
//
// Measured on this machine (macOS 26.1) under throwaway bundle identifiers:
//
//   - Whoever asks first — the service or the window, it made no difference —
//     puts the system's question on screen, and from that moment the status
//     reads "denied" until the question is answered.
//   - The question is taken off the screen the moment the process that asked
//     goes away. The service is replaced on every new build and was asking
//     from a detached process nobody was looking at; its question vanished
//     unanswered.
//   - After that, every further request fails at once (UNErrorDomain 1) and
//     nothing is shown again. The "denied" stays until it is switched on in
//     System Settings by hand.
//
// And the old fallback, osascript, posts as Script Editor: its icon, and a
// click that opens Script Editor with a file dialog. So the service shows
// nothing on macOS. It hands every notification to one plxr window, and with
// none open it says so in its log.
func serviceRoute() func(Message) { return nil }

// settingsPane is System Settings › Notifications. The identifier is the one
// the Notifications settings extension carries on this system, and the one it
// accepts through the x-apple.systempreferences scheme.
const settingsPane = "x-apple.systempreferences:com.apple.Notifications-Settings.extension"

// settingsURL is the pane opened on one application's own switches, when the
// bundle identifier is known and looks like one.
func settingsURL(bundle string) string {
	if validBundleID(bundle) {
		return settingsPane + "?id=" + bundle
	}
	return settingsPane
}

// OpenSystemSettings opens plxr's notification settings, where a permission
// that stands refused is switched back on. The page cannot do this: a URL
// scheme of the system's is not one a browser will follow.
func OpenSystemSettings(bundle string) error {
	return exec.Command("open", settingsURL(bundle)).Run()
}

// The sounds macOS ships in /System/Library/Sounds. A file picker instead would
// mean carrying somebody's chosen file around and failing once it moves.
func sounds() []string {
	return []string{
		"Basso", "Blow", "Bottle", "Frog", "Funk", "Glass", "Hero",
		"Morse", "Ping", "Pop", "Purr", "Sosumi", "Submarine", "Tink",
	}
}

// The sound to start with here.
func defaultSound() string { return "Submarine" }
