//go:build darwin

#import <Cocoa/Cocoa.h>

// The frost around a translucent window is an NSVisualEffectView sitting behind
// the content, put there when the window is built. Wails only ever places it at
// creation, so the setting could not be changed without starting the window
// again. It can be changed: the view can be taken out and put back at any time,
// which is all this does.
//
// 0 clear, 1 frosted, 2 glass.
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
