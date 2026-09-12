//go:build darwin

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

// Send a notification under this program's own identity.
//
// The old way was `osascript -e 'display notification …'`, and a notification
// sent that way belongs to whoever ran the script — Script Editor, complete
// with its icon. Sent from inside the bundle it belongs to plxr, and it wears
// plxr's icon.
//
// Only works in a bundle: without one there is no identity to send under, and
// the caller falls back to the script.
//
// And only with the permission. Measured in the service — started detached
// from the window, never launched by the system as an application, no run
// loop: the request for permission below is never answered (plxr is missing
// from the notification preferences after every kind of use), the status
// stays "not determined", and addNotificationRequest fails with "Notifications
// are not allowed for this application". This used to return 1 all the same,
// so nothing was shown and nothing fell back. Now the standing answer is read
// first: anything but "authorized" returns 0 and the script route at least
// says something. The window's route (window_darwin.m) is the one that gets
// the permission and the icon; this is what is left with no window open.
int plxrNotify(const char *title, const char *subtitle, const char *body, const char *sound) {
    @autoreleasepool {
        if ([[NSBundle mainBundle] bundleIdentifier] == nil) {
            return 0;   // not bundled — nothing to send as
        }
        UNUserNotificationCenter *centre = [UNUserNotificationCenter currentNotificationCenter];
        if (centre == nil) {
            return 0;
        }

        // Asking every time is harmless: after the first answer macOS returns
        // the standing one without showing anything.
        [centre requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound)
                              completionHandler:^(BOOL granted, NSError *error) { (void)granted; (void)error; }];

        // The standing answer, waited for briefly. Not authorized means the
        // request below would be refused without a word — say so instead.
        dispatch_semaphore_t asked = dispatch_semaphore_create(0);
        __block long status = -1;
        [centre getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
            status = (long)settings.authorizationStatus;
            dispatch_semaphore_signal(asked);
        }];
        // Compiled without ARC: what is made here is let go here. The block
        // holds its own reference to the semaphore, so a late answer after
        // the timeout still has something to signal.
        long waited = dispatch_semaphore_wait(asked, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));
        dispatch_release(asked);
        if (waited != 0) {
            return 0;
        }
        if (status != UNAuthorizationStatusAuthorized && status != UNAuthorizationStatusProvisional) {
            return 0;
        }

        UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
        content.title = [NSString stringWithUTF8String:title];
        if (subtitle != NULL && strlen(subtitle) > 0) {
            content.subtitle = [NSString stringWithUTF8String:subtitle];
        }
        content.body = [NSString stringWithUTF8String:body];
        // Silence is a choice too: an empty name means show it without a sound.
        if (sound != NULL && strlen(sound) > 0) {
            content.sound = [UNNotificationSound soundNamed:
                [NSString stringWithFormat:@"%s.aiff", sound]];
        }

        // The request copies the content and is autoreleased itself; the
        // centre keeps what it needs of the request.
        UNNotificationRequest *request =
            [UNNotificationRequest requestWithIdentifier:[[NSUUID UUID] UUIDString]
                                                 content:content
                                                 trigger:nil];
        [content release];
        [centre addNotificationRequest:request withCompletionHandler:^(NSError *error) { (void)error; }];
        return 1;
    }
}
