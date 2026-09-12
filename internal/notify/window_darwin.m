//go:build darwin

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include "_cgo_export.h"

// The window's notifications: posted by the application process, shown while
// it is frontmost, and a click handed back to Go with the session it named.
//
// plxrNotify in notify_darwin.m is the service's route, kept for the case of
// no window being open. This file is what the window uses instead.

@interface PlxrNotifyDelegate : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation PlxrNotifyDelegate

// Shown even while plxr is the frontmost application: the whole point is to
// be told while looking at something else, and that includes another session
// in the same window.
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
}

// A click brings the window forward and names the session it was about.
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))completionHandler {
    if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
        NSString *sessionId = response.notification.request.content.userInfo[@"sessionId"];
        plxrGoClicked((char *)(sessionId ? sessionId.UTF8String : ""));
    }
    completionHandler();
}

@end

static PlxrNotifyDelegate *plxrDelegate = nil;

static UNUserNotificationCenter *plxrCentre(void) {
    if ([[NSBundle mainBundle] bundleIdentifier] == nil) {
        return nil;   // unbundled: no name to post under, and the centre throws
    }
    return [UNUserNotificationCenter currentNotificationCenter];
}

int plxrWindowCapable(void) {
    @autoreleasepool {
        return plxrCentre() != nil ? 1 : 0;
    }
}

void plxrWindowInstall(void) {
    @autoreleasepool {
        UNUserNotificationCenter *centre = plxrCentre();
        if (centre == nil) {
            return;
        }
        if (plxrDelegate == nil) {
            plxrDelegate = [[PlxrNotifyDelegate alloc] init];
        }
        centre.delegate = plxrDelegate;
    }
}

void plxrWindowAuthorize(void) {
    @autoreleasepool {
        UNUserNotificationCenter *centre = plxrCentre();
        if (centre == nil) {
            return;
        }
        [centre requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge)
                              completionHandler:^(BOOL granted, NSError *error) {
                                  (void)granted; (void)error;
                                  plxrGoPermission();
                              }];
    }
}

// The standing answer: UNAuthorizationStatus as a number, -1 when it could
// not be read in time.
int plxrWindowStatus(void) {
    @autoreleasepool {
        UNUserNotificationCenter *centre = plxrCentre();
        if (centre == nil) {
            return -1;
        }
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block long status = -1;
        [centre getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
            status = (long)settings.authorizationStatus;
            dispatch_semaphore_signal(done);
        }];
        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC)) != 0) {
            return -1;
        }
        return (int)status;
    }
}

int plxrWindowPost(const char *title, const char *body, const char *sound, const char *sessionId) {
    @autoreleasepool {
        UNUserNotificationCenter *centre = plxrCentre();
        if (centre == nil) {
            return 0;
        }
        UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
        content.title = [NSString stringWithUTF8String:title];
        content.body = [NSString stringWithUTF8String:body];
        if (sound != NULL && strlen(sound) > 0) {
            content.sound = [UNNotificationSound soundNamed:[NSString stringWithFormat:@"%s.aiff", sound]];
        }
        if (sessionId != NULL && strlen(sessionId) > 0) {
            content.userInfo = @{@"sessionId": [NSString stringWithUTF8String:sessionId]};
        }
        UNNotificationRequest *request =
            [UNNotificationRequest requestWithIdentifier:[[NSUUID UUID] UUIDString]
                                                 content:content
                                                 trigger:nil];
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block int ok = 0;
        [centre addNotificationRequest:request withCompletionHandler:^(NSError *error) {
            ok = error == nil ? 1 : 0;
            dispatch_semaphore_signal(done);
        }];
        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC)) != 0) {
            return 0;
        }
        return ok;
    }
}
