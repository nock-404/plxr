/* The page's half of a click on a notification.
 *
 * The window writes the request into the settings; this is what the page
 * makes of it. What has to hold: a new seq opens the session, the same seq
 * seen again does not — that is the reload — and anything not shaped as a
 * request opens nothing.
 */
const { freshFocus, requestedFocus } = await import("./focus.ts");

let failed = 0;
const claim = (ok, what) => {
  if (!ok) {
    console.error("  " + what);
    failed++;
  }
};

// The shape the window writes.
claim(
  JSON.stringify(requestedFocus({ focusSession: { id: "abc", seq: 5 } })) === '{"id":"abc","seq":5}',
  "a well-formed request was not read",
);
// Nothing there, or nothing that is a request.
claim(requestedFocus({}) === null, "no request read as one");
claim(requestedFocus({ focusSession: "abc" }) === null, "a bare string read as a request");
claim(requestedFocus({ focusSession: { id: "", seq: 1 } }) === null, "an empty id read as a request");
claim(requestedFocus({ focusSession: { id: "abc" } }) === null, "a request without a seq was taken");
claim(requestedFocus(null) === null, "null settings threw or read as a request");

// First sight of a request: opened — the page had nothing to compare with.
claim(freshFocus({ focusSession: { id: "abc", seq: 5 } }, undefined)?.id === "abc", "the first request was not opened");
// A new seq: opened.
claim(freshFocus({ focusSession: { id: "abc", seq: 6 } }, 5)?.id === "abc", "a new seq did not open the session");
// The same seq, as after a reload that read it at start: not opened again.
claim(freshFocus({ focusSession: { id: "abc", seq: 6 } }, 6) === null, "the same seq opened the session again");
// The seq can move either way — the window's clock is not this page's.
claim(freshFocus({ focusSession: { id: "abc", seq: 4 } }, 6)?.id === "abc", "a smaller seq was not treated as new");

if (failed) {
  console.error(`  ${failed} claims failed`);
  process.exit(1);
}
console.log("  10 claims hold — 1 files");
