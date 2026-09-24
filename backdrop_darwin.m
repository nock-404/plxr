//go:build darwin

#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

// The frost around a translucent window is an NSVisualEffectView sitting behind
// the content, put there when the window is built. Wails only ever places it at
// creation, so the setting could not be changed without starting the window
// again. It can be changed: the view can be taken out and put back at any time,
// which is all this does.
//
// 0 clear, 1 frosted, 2 glass, 3 solid — solid being none of them: an opaque
// window with nothing behind it to blend, for a machine that cannot spare the
// drawing.
void plxrSetBackdrop(void *nsWindow, int kind) {
  NSWindow *window = (__bridge NSWindow *)nsWindow;
  if (window == nil) {
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    NSView *content = [window contentView];

    // Whatever frost is there now goes first: adding a second one over the top
    // would darken the window a little more with every change.
    NSMutableArray *old = [NSMutableArray array];
    for (NSView *view in [content subviews]) {
      if ([view isKindOfClass:[NSVisualEffectView class]]) {
        [old addObject:view];
      }
    }
    for (NSView *view in old) {
      [view removeFromSuperview];
    }

    if (kind == 3) {
      // Solid: the system composites nothing, the page paints everything.
      [window setOpaque:YES];
      [window setBackgroundColor:[NSColor blackColor]];
      return;
    }
    [window setOpaque:NO];
    [window setBackgroundColor:[NSColor clearColor]];
    if (kind == 0) {
      return; // clear: nothing between the page and the desktop
    }

    NSVisualEffectView *frost =
        [[NSVisualEffectView alloc] initWithFrame:[content bounds]];
    [frost setAutoresizingMask:NSViewWidthSizable | NSViewHeightSizable];
    [frost setBlendingMode:NSVisualEffectBlendingModeBehindWindow];
    [frost setState:NSVisualEffectStateActive];
    // Two materials, both of them the system's: the plain one under a window,
    // and the lighter one the system uses for panels that float over things.
    [frost setMaterial:(kind == 2 ? NSVisualEffectMaterialHUDWindow
                                  : NSVisualEffectMaterialUnderWindowBackground)];
    [content addSubview:frost positioned:NSWindowBelow relativeTo:nil];
  });
}

/* The window draws for the screen it is actually on.
 *
 * Moved from the built-in screen to an external one, the window went soft
 * while every other application stayed sharp. The reason is the scale the
 * layers were made at: the built-in screen is two pixels to the point, the
 * external one is one, and a layer tree that keeps the old number is drawn at
 * the old size and then squeezed into the new — which is what softness is.
 * WebKit renews its own layers on such a move, but the layers around it, put
 * there by the window itself, are never told.
 *
 * So the window is told: on a move to another screen, and on a change of the
 * backing properties, every layer from the content view downwards is set to
 * the scale the window now has and asked to draw again. Nothing is rebuilt and
 * nothing is measured — a number is corrected where it went stale.
 */
// Unretained rather than weak: this file is compiled without automatic
// reference counting, where a weak property cannot be synthesised. The window
// outlives the watcher — both live as long as the program does — and the
// watcher is only ever reached from a notification about that same window.
@interface PlxrScreenWatch : NSObject {
  NSWindow *watched;
}
- (void)setWindow:(NSWindow *)window;
- (NSWindow *)window;
@end

@implementation PlxrScreenWatch

- (void)setWindow:(NSWindow *)window {
  watched = window;
}

- (NSWindow *)window {
  return watched;
}

- (void)scaleLayer:(CALayer *)layer to:(CGFloat)scale {
  if (layer == nil) {
    return;
  }
  if ([layer contentsScale] != scale) {
    [layer setContentsScale:scale];
    [layer setNeedsDisplay];
  }
  for (CALayer *sub in [layer sublayers]) {
    [self scaleLayer:sub to:scale];
  }
}

- (void)scaleView:(NSView *)view to:(CGFloat)scale {
  if (view == nil) {
    return;
  }
  /* The web view is left alone, itself and everything under it.
   *
   * It keeps its own layers at the scale it wants them and draws its text with
   * the smoothing that goes with that scale; a scale written into those layers
   * from outside is a number WebKit did not choose, and the letters come back
   * without their edges. What was stale was never WebKit's — it was the layers
   * the window itself puts around it. */
  if ([view isKindOfClass:NSClassFromString(@"WKWebView")]) {
    /* Not scaled by hand — nudged, so it works the scale out for itself.
     *
     * Writing the number into its layers fixed the softness and took the
     * smoothing off the letters: the scale a web view draws text at is a
     * decision it makes, and one made for it from outside is the wrong one.
     * Leaving it alone brought the softness back on the next screen ("this is
     * blurred again, now on another monitor"). A view resized by a point and
     * back lays itself out afresh and rasterises at the scale it is on now,
     * which is the thing that was stale — and every decision stays WebKit's.
     * The size ends where it began, so nothing in the page moves. */
    NSSize was = [view frame].size;
    if (was.width > 2 && was.height > 2) {
      [view setFrameSize:NSMakeSize(was.width - 1, was.height)];
      [view layoutSubtreeIfNeeded];
      [view setFrameSize:was];
    }
    [view setNeedsDisplay:YES];
    return;
  }
  [self scaleLayer:[view layer] to:scale];
  [view setNeedsDisplay:YES];
  for (NSView *sub in [view subviews]) {
    [self scaleView:sub to:scale];
  }
}

- (void)screenChanged:(NSNotification *)note {
  NSWindow *window = [self window];
  if (window == nil) {
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    [self scaleView:[window contentView] to:[window backingScaleFactor]];
  });
  /* And again once it has settled. A window dragged to another screen is
     reported as it crosses, while the scale it will have is the old one for a
     moment longer; a second pass a quarter of a second later catches what the
     first one was too early to see. */
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
                   [self scaleView:[window contentView] to:[window backingScaleFactor]];
                 });
}

@end

// Held for the life of the program: a watcher nobody keeps is a watcher that
// stops the moment it is collected.
static PlxrScreenWatch *plxrWatch = nil;

void plxrFollowScreen(void *nsWindow) {
  NSWindow *window = (__bridge NSWindow *)nsWindow;
  if (window == nil) {
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    if (plxrWatch != nil) {
      [[NSNotificationCenter defaultCenter] removeObserver:plxrWatch];
    }
    plxrWatch = [[PlxrScreenWatch alloc] init];
    [plxrWatch setWindow:window];
    for (NSString *name in @[ NSWindowDidChangeScreenNotification,
                              NSWindowDidChangeBackingPropertiesNotification,
                              NSWindowDidChangeScreenProfileNotification ]) {
      [[NSNotificationCenter defaultCenter] addObserver:plxrWatch
                                               selector:@selector(screenChanged:)
                                                   name:name
                                                 object:window];
    }
    [plxrWatch screenChanged:nil];
  });
}

/* The first click into the window is a click, not just a knock.
 *
 * A window that is not in front gets the click that activates it and nothing
 * else: AppKit asks the view under the pointer whether it accepts the first
 * mouse, and everything answers no unless it says otherwise. So coming back
 * from another application meant clicking once to wake the window and again
 * to reach the terminal — "I still have to click twice to get into the
 * terminal". The page cannot fix this; the event never arrives there.
 *
 * The answer is given for the web view, once, for this process only: the class
 * is asked to answer yes to that one question. Everything else about it stays
 * as it was.
 */
static BOOL plxrAlwaysFirstMouse(id self, SEL cmd, NSEvent *event) {
  (void)self;
  (void)cmd;
  (void)event;
  return YES;
}

/* Answered for every view, not only for the web view.
 *
 * AppKit does not ask the WKWebView: it asks the view the click actually lands
 * on, and inside a web view that is one of WebKit's own, several levels down
 * and not a class anything outside can name. Patching the outer one changed
 * nothing at all — the second click was still needed. So the answer is given
 * by NSView itself, for this process: here the window is one web view from
 * edge to edge, and there is nothing in it that wants a click swallowed. */
void plxrTakeFirstClick(void) {
  SEL sel = @selector(acceptsFirstMouse:);
  for (NSString *name in @[ @"NSView", @"WKWebView" ]) {
    Class cls = NSClassFromString(name);
    if (cls == nil) {
      continue;
    }
    Method existing = class_getInstanceMethod(cls, sel);
    if (existing != NULL) {
      method_setImplementation(existing, (IMP)plxrAlwaysFirstMouse);
    } else {
      class_addMethod(cls, sel, (IMP)plxrAlwaysFirstMouse, "c@:@");
    }
  }
}

/* plxrFirstMouseAnswer says whether the answer has been changed, so the change
 * can be measured rather than assumed.
 *
 * The runtime is asked, not a view: building one belongs on the main thread,
 * and waiting for a main thread nobody is running is a deadlock — measured, at
 * ten minutes. What matters is which implementation answers the question, and
 * that is a lookup. */
int plxrFirstMouseAnswer(void) {
  Class cls = NSClassFromString(@"NSView");
  if (cls == nil) {
    return -1;
  }
  return class_getMethodImplementation(cls, @selector(acceptsFirstMouse:)) == (IMP)plxrAlwaysFirstMouse ? 1 : 0;
}
