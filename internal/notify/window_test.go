package notify

import "testing"

// The system's number for the permission, in the words the settings show. The
// case that matters most is 1 while this process is asking: the system calls a
// question that is on screen a refusal, and sending somebody to System Settings
// while the question is in front of them would be wrong.
func TestThePermissionReadsTheWayItStands(t *testing.T) {
	cases := []struct {
		status int
		asking bool
		want   string
	}{
		{0, false, PermissionNotAsked},
		{0, true, PermissionAsking},
		{1, false, PermissionDenied},
		{1, true, PermissionAsking},
		{2, false, PermissionGranted},
		{3, false, PermissionGranted},
		{4, true, PermissionGranted},
		{-1, false, PermissionUnknown},
		{9, false, PermissionUnknown},
	}
	for _, c := range cases {
		if got := permissionOf(c.status, c.asking); got != c.want {
			t.Errorf("status %d, asking %v: %q, want %q", c.status, c.asking, got, c.want)
		}
	}
}

func TestTheWindowsReportIsReadBack(t *testing.T) {
	r, ok := ReadReport([]byte(`{"permission":"denied","bundle":"dev.plxr.app"}`))
	if !ok || r.Permission != PermissionDenied || r.Bundle != "dev.plxr.app" {
		t.Errorf("read %+v, %v", r, ok)
	}
	for _, frame := range []string{`{}`, `not json`, `{"bundle":"dev.plxr.app"}`} {
		if _, ok := ReadReport([]byte(frame)); ok {
			t.Errorf("%s was taken for a report", frame)
		}
	}
}
