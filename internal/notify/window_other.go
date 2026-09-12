//go:build !darwin

package notify

// On Linux and Windows the service's own route works as it is — notify-send
// and a toast need no application to post as — so the window does not take
// the showing over there. Nothing subscribes, and the service shows it.

// WindowCapable says whether this process can show notifications itself.
func WindowCapable() bool { return false }

// WindowInstall would make this process the one that handles what it posts.
func WindowInstall(func(sessionID string)) {}

// WindowAuthorize would ask for the permission.
func WindowAuthorize() {}

// PermissionChanged is never woken here.
func PermissionChanged() <-chan struct{} { return make(chan struct{}) }

// WindowPermission is unknown where the window does not post.
func WindowPermission() string { return PermissionUnknown }

// WindowPost shows nothing here; the service does.
func WindowPost(Message) {}
