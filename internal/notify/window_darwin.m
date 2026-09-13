//go:build darwin

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <os/log.h>
#include <stdatomic.h>
#include <string.h>
#include "_cgo_export.h"

// The window's notifications: the permission asked for, and each one posted,
// by the application process; shown while it is frontmost; a click handed
// back to Go with the session it named. Nothing else in plxr talks to the
// notification centre.

@interface PlxrNotifyDelegate : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation PlxrNotifyDelegate

// Shown even while plxr is the frontmost application: the whole point is to
// be told while looking at something else, and that includes another session
// in the same window. The one in front is not posted at all — the service
// holds that back.
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

// Whether this process has put the question and not heard back. The system
// reports a question on screen as a refusal already.
static atomic_int plxrAsking = 0;

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

// The bundle identifier this process posts under, for System Settings to be
// opened on. The caller frees it.
char *plxrWindowBundle(void) {
    @autoreleasepool {
        NSString *id = [[NSBundle mainBundle] bundleIdentifier];
        return id ? strdup(id.UTF8String) : NULL;
    }
}

int plxrWindowAsking(void) {
    return atomic_load(&plxrAsking);
}

void plxrWindowAuthorize(void) {
    @autoreleasepool {
        UNUserNotificationCenter *centre = plxrCentre();
        if (centre == nil) {
            return;
        }
        atomic_store(&plxrAsking, 1);
        [centre requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound)
                              completionHandler:^(BOOL granted, NSError *error) {
            @autoreleasepool {
                atomic_store(&plxrAsking, 0);
                NSString *why = error
                    ? [NSString stringWithFormat:@"%@ %ld: %@", error.domain, (long)error.code, error.localizedDescription]
                    : @"";
                plxrGoAnswered(granted ? 1 : 0, (char *)why.UTF8String);
            }
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
        // Compiled without ARC: let go here. The block holds its own
        // reference, so an answer after the timeout still has a semaphore.
        long waited = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));
        dispatch_release(done);
        if (waited != 0) {
            return -1;
        }
        return (int)status;
    }
}

// Posts one notification. 1 when the system took it; 0 with the reason in
// failure when it did not.
int plxrWindowPost(const char *title, const char *body, const char *sound, const char *sessionId, char *failure, int failureSize) {
    @autoreleasepool {
        UNUserNotificationCenter *centre = plxrCentre();
        if (centre == nil) {
            snprintf(failure, failureSize, "this build is not inside an application bundle");
            return 0;
        }
        UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
        NSString *t = [NSString stringWithUTF8String:title];
        NSString *b = [NSString stringWithUTF8String:body];
        content.title = t ?: @"plxr";
        content.body = b ?: @"";
        if (sound != NULL && strlen(sound) > 0) {
            content.sound = [UNNotificationSound soundNamed:[NSString stringWithFormat:@"%s.aiff", sound]];
        }
        if (sessionId != NULL && strlen(sessionId) > 0) {
            NSString *sid = [NSString stringWithUTF8String:sessionId];
            if (sid != nil) {
                content.userInfo = @{@"sessionId": sid};
                // One session's notifications stack together in the list.
                content.threadIdentifier = sid;
            }
        }
        // The request copies the content and is autoreleased itself.
        UNNotificationRequest *request =
            [UNNotificationRequest requestWithIdentifier:[[NSUUID UUID] UUIDString]
                                                 content:content
                                                 trigger:nil];
        [content release];
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block int ok = 0;
        // Retained by the block, released here once read. An answer that
        // comes after the timeout keeps its text; that is a few bytes, once.
        __block NSString *why = nil;
        [centre addNotificationRequest:request withCompletionHandler:^(NSError *error) {
            if (error == nil) {
                ok = 1;
            } else {
                why = [[NSString alloc] initWithFormat:@"%@ %ld: %@", error.domain, (long)error.code, error.localizedDescription];
            }
            dispatch_semaphore_signal(done);
        }];
        long waited = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));
        dispatch_release(done);
        if (waited != 0) {
            snprintf(failure, failureSize, "no answer from the notification centre within two seconds");
            return 0;
        }
        if (!ok) {
            snprintf(failure, failureSize, "%s", why ? why.UTF8String : "refused without a reason");
            [why release];
        }
        return ok;
    }
}

// One line to the system log, public so that it can be read back.
void plxrLog(const char *line) {
    os_log(OS_LOG_DEFAULT, "%{public}s", line);
}
