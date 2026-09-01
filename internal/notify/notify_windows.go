//go:build windows

package notify

import (
	"os/exec"
	"strings"
)

// Windows shows a toast, put together in PowerShell because that is the only
// way in without a compiled WinRT binding — and a binding for one message is a
// dependency for one message.
func deliver(title, body, sound string) {
	sound = strings.TrimSpace(sound)
	audio := "<audio silent=\"true\"/>"
	if sound != "" {
		audio = "<audio src=\"ms-winsoundevent:Notification." + sound + "\"/>"
	}
	script := `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">` + title + `</text><text id="2">` + body + `</text></binding></visual>` + audio + `</toast>')
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("plxr").Show($toast)
`
	_ = exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script).Run()
}

// The sounds Windows names for notifications.
func sounds() []string {
	return []string{
		"Default", "IM", "Mail", "Reminder", "SMS",
		"Looping.Alarm", "Looping.Alarm2", "Looping.Call", "Looping.Call2",
	}
}

// The sound to start with here.
func defaultSound() string { return "Default" }
