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
int plxrWindowPost(const char *title, const char *body, const char *sound, const char *sessionId);
*/
import "C"

import (
	"sync"
	"unsafe"
)

/* Showing a notification from the window's process.

   This is the process macOS will take one from: bundled, launched as an
   application, in the foreground, with a run loop for the answers to come
   back on. The service is none of those things — see route.go for what was
   measured — so it hands the message here and this posts it, under plxr's
   name and with plxr's icon.

   The permission is asked for once, when the window comes up. The answer is
   read before every post rather than remembered, because it can be changed
   in System Settings at any time and a stale "granted" would post into
   nothing. Denied is respected: nothing is posted, nothing is tried by any
   other route — the script route would hand the notification to Script
   Editor, and somebody who said no to plxr did not say yes to that. */

// WindowCapable says whether this process can show notifications itself: it
// has to be bundled, or there is no name to post under.
func WindowCapable() bool { return C.plxrWindowCapable() == 1 }

var (
	clickMu sync.Mutex
	onClick func(sessionID string)
	// Woken whenever the permission changes, so the service can be told.
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

// WindowAuthorize asks for the permission. The system shows its question
// once and returns the standing answer ever after; the answer arrives on
// PermissionChanged.
func WindowAuthorize() { C.plxrWindowAuthorize() }

// PermissionChanged is woken when the permission was asked and answered.
func PermissionChanged() <-chan struct{} { return permissionChanged }

// WindowPermission reads how the permission stands right now.
func WindowPermission() string {
	switch C.plxrWindowStatus() {
	case 2, 3, 4: // authorized, provisional, ephemeral
		return PermissionGranted
	case 1:
		return PermissionDenied
	case 0:
		return PermissionNotAsked
	}
	return PermissionUnknown
}

// WindowPost shows one message from this process, if it may.
func WindowPost(m Message) {
	switch WindowPermission() {
	case PermissionGranted:
	case PermissionDenied:
		logOnce("denied", "notifications: refused in System Settings — nothing is shown until that changes")
		return
	default:
		logOnce("not-asked", "notifications: not allowed yet — %q not shown", m.Body)
		return
	}
	t, b, s, id := C.CString(m.Title), C.CString(m.Body), C.CString(m.Sound), C.CString(m.SessionID)
	defer func() {
		C.free(unsafe.Pointer(t))
		C.free(unsafe.Pointer(b))
		C.free(unsafe.Pointer(s))
		C.free(unsafe.Pointer(id))
	}()
	if C.plxrWindowPost(t, b, s, id) != 1 {
		logOnce("refused", "notifications: the system refused one — %q", m.Body)
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

//export plxrGoPermission
func plxrGoPermission() {
	select {
	case permissionChanged <- struct{}{}:
	default:
	}
}
