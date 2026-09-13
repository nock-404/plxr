//go:build darwin

package notify

/*
#cgo CFLAGS: -x objective-c -fmodules
#cgo LDFLAGS: -framework Foundation -framework UserNotifications
#include <stdlib.h>
int plxrWindowCapable(void);
void plxrWindowInstall(void);
void plxrWindowAuthorize(void);
int plxrWindowStatus(void);
int plxrWindowAsking(void);
char *plxrWindowBundle(void);
int plxrWindowPost(const char *title, const char *body, const char *sound, const char *sessionId, char *failure, int failureSize);
void plxrLog(const char *line);
*/
import "C"

import (
	"sync"
	"unsafe"
)

/* Showing a notification from the window's process.

   This is the only process of plxr's that talks to the notification centre:
   bundled, launched as an application, in the foreground, and open for as
   long as somebody is looking at it. See notify_darwin.go for what was
   measured, and why the service does not.

   The permission is NOT asked for when the window comes up. The question
   the system puts is taken off the screen when the process that asked goes
   away, and a question that went unanswered stands as a refusal for good.
   So it is asked when somebody presses ALLOW NOTIFICATIONS, in this window,
   which is still open while they answer. The answer is read before every
   post rather than remembered, because it can be changed in System Settings
   at any time. */

// WindowCapable says whether this process can show notifications itself: it
// has to be bundled, or there is no name to post under.
func WindowCapable() bool { return C.plxrWindowCapable() == 1 }

var (
	clickMu sync.Mutex
	onClick func(sessionID string)
	// Woken whenever the permission may have changed, so the service is told.
	permissionChanged = make(chan struct{}, 1)
)

// WindowInstall makes this process the one that handles what it posts: the
// notification is shown even while plxr is frontmost, and a click on it
// comes back to click with the session it was about.
func WindowInstall(click func(sessionID string)) {
	clickMu.Lock()
	onClick = click
	clickMu.Unlock()
	C.plxrWindowInstall()
}

// WindowAuthorize puts the system's question. The system shows it once per
// application, ever; the answer arrives on PermissionChanged.
func WindowAuthorize() {
	note("notifications: asking macOS whether plxr may show notifications")
	C.plxrWindowAuthorize()
	wake()
}

// PermissionChanged is woken when the permission may have changed.
func PermissionChanged() <-chan struct{} { return permissionChanged }

// WindowPermission reads how the permission stands right now.
func WindowPermission() string {
	return permissionOf(int(C.plxrWindowStatus()), C.plxrWindowAsking() == 1)
}

// WindowReport is what this window says about itself to the service.
func WindowReport() Report {
	r := Report{Permission: WindowPermission()}
	if p := C.plxrWindowBundle(); p != nil {
		r.Bundle = C.GoString(p)
		C.free(unsafe.Pointer(p))
	}
	return r
}

// WindowPost shows one message from this process. A refusal is not second-
// guessed here: whether a notification is shown is the system's decision,
// and what it answers is written to the log.
func WindowPost(m Message) {
	switch WindowPermission() {
	case PermissionNotAsked:
		logOnce("not-asked", "notifications: plxr has not asked macOS yet, so %q was not shown — Settings › Notifications › ALLOW NOTIFICATIONS", m.Body)
		return
	case PermissionUnknown:
		note("notifications: the permission could not be read, so %q was not shown", m.Body)
		return
	}
	t, b, s, id := C.CString(clip(m.Title)), C.CString(clip(m.Body)), C.CString(m.Sound), C.CString(m.SessionID)
	failure := (*C.char)(C.calloc(512, 1))
	defer func() {
		C.free(unsafe.Pointer(t))
		C.free(unsafe.Pointer(b))
		C.free(unsafe.Pointer(s))
		C.free(unsafe.Pointer(id))
		C.free(unsafe.Pointer(failure))
	}()
	if C.plxrWindowPost(t, b, s, id, failure, 512) != 1 {
		note("notifications: macOS did not take %q: %s", m.Body, C.GoString(failure))
	}
}

func wake() {
	select {
	case permissionChanged <- struct{}{}:
	default:
	}
}

//export plxrGoClicked
func plxrGoClicked(sessionID *C.char) {
	id := C.GoString(sessionID)
	clickMu.Lock()
	f := onClick
	clickMu.Unlock()
	if f != nil {
		go f(id)
	}
}

//export plxrGoAnswered
func plxrGoAnswered(granted C.int, failure *C.char) {
	if granted == 1 {
		note("notifications: macOS answered - plxr may show notifications")
	} else {
		note("notifications: macOS answered - not allowed (%s)", C.GoString(failure))
	}
	wake()
}

// systemLog writes a line to the system log, where it survives a process
// whose own output is discarded. Foundation's logging, not the notification
// centre: the service may call this.
func systemLog(line string) {
	c := C.CString(line)
	defer C.free(unsafe.Pointer(c))
	C.plxrLog(c)
}
