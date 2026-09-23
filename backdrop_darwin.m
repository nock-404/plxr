//go:build darwin

#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>

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
