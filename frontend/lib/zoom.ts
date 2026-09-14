/* Double-clicking the bar zooms the window.
 *
 * The bar is this window's title bar: the frame has none of its own, so the
 * bar carries the drag (--wails-draggable in layout.css). The other half of a
 * title bar is the double click that zooms, and that half was missing. The
 * window's native side starts a drag on the first click and hands the second
 * one to the desktop runtime in the page — which is not in this page, because
 * the window loads it from the service (main.go says why). So the page sends
 * that message itself, in the words the window already listens for.
 *
 * What counts as free space is the question the runtime asks, and the answer
 * already stands in the stylesheet: the bar drags, and everything in it that
 * can be clicked says it does not. A double click on a button, a field or the
 * search therefore never reaches this.
 */

type Bridge = { postMessage: (message: string) => void };

/* The webview's own channel to the window around it: Edge's on Windows,
   WebKit's on macOS. In a browser tab there is neither, and nothing happens. */
function host(): Bridge | null {
  const w = window as unknown as {
    chrome?: { webview?: Bridge };
    webkit?: { messageHandlers?: { external?: Bridge } };
  };
  return w.chrome?.webview ?? w.webkit?.messageHandlers?.external ?? null;
}

/* Whether the click landed on the window's handle rather than on something
   sitting in it. Custom properties inherit, so the wordmark drags with the bar
   and a button does not. */
export function onHandle(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return getComputedStyle(target).getPropertyValue("--wails-draggable").trim() === "drag";
}

export function zoomWindow(target: EventTarget | null): void {
  if (!onHandle(target)) return;
  host()?.postMessage("wails:drag:doubleclick");
}
