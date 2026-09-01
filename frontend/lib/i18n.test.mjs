/* Errors on their way from the daemon to the screen.
 *
 * Go sends a code and, behind a bar, a detail that cannot be translated: a path,
 * a name, the message of something underneath. This is the only place that
 * comes apart again, and it is read at the worst possible moment — when
 * something has already gone wrong.
 */
/* The table is fetched, and there is no back door for putting one in — which is
   right: a test-only entrance is a second way for the real thing to be wrong.
   So the two things it reaches for are stood up here instead. */
globalThis.document = { documentElement: { setAttribute() {} } };
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    "err.dir.missing": "There is no {detail}",
    "err.session.unknown": "No such session",
  }),
});

const { errText, loadLanguage } = await import("./i18n.ts");
await loadLanguage("en");

let failed = 0;
const claim = (ok, what) => {
  if (!ok) {
    console.error("  " + what);
    failed++;
  }
};

// The plain case.
claim(
  errText(new Error("err.session.unknown")) === "No such session",
  "a bare code did not become its sentence",
);

// A detail is put where the sentence wants it.
claim(
  errText(new Error("err.dir.missing|/tmp/x")) === "There is no /tmp/x",
  "the detail did not reach the sentence",
);

/* A detail containing the divider itself.
 *
 * A bar is legal in a path and can appear in any message from underneath.
 * Splitting on all of them and keeping the first two pieces silently cut the
 * detail short — which is worse than showing nothing, because a path with its
 * end missing still looks like a path. */
const awkward = "/tmp/weird|name/file.txt";
claim(
  errText(new Error(`err.dir.missing|${awkward}`)) === `There is no ${awkward}`,
  `a detail with a bar in it came out as ${JSON.stringify(errText(new Error(`err.dir.missing|${awkward}`)))}`,
);

/* Go's http.Error writes a newline after the message.
 *
 * Every error the daemon reported that way arrived with one, failed the check
 * for a code — which anchors at the end of the string — and was shown as its
 * bare code in red. It was found on screen, not here, which is the wrong way
 * round. */
claim(
  errText(new Error("err.session.unknown\n")) === "No such session",
  `a code with the newline Go appends came out as ${JSON.stringify(errText(new Error("err.session.unknown\n")))}`,
);
claim(
  errText(new Error("err.dir.missing|/tmp/x\n")) === "There is no /tmp/x",
  "a code with a detail and a trailing newline did not read back",
);

// Anything that is not a code is shown as it stands, so nothing is ever
// swallowed — including a code from a daemon newer than this window.
for (const raw of ["something went wrong", "err.from.a.newer.build", "", "TypeError: x is not a function"]) {
  claim(errText(new Error(raw)) === raw, `an unknown message was not passed through: ${JSON.stringify(raw)}`);
}

// Not everything thrown is an Error.
claim(errText("plain string") === "plain string", "a thrown string was lost");
claim(errText(null) === "", "a thrown nothing did not come out empty");

console.log(failed ? `  ${failed} claims failed` : "  codes become sentences, details survive intact, unknowns pass through");
process.exit(failed ? 1 : 0);
