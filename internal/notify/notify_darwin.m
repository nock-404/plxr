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

        UNNotificationRequest *request =
            [UNNotificationRequest requestWithIdentifier:[[NSUUID UUID] UUIDString]
                                                 content:content
                                                 trigger:nil];
        [centre addNotificationRequest:request withCompletionHandler:^(NSError *error) { (void)error; }];
        return 1;
    }
}
