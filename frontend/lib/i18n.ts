"use client";

// Translation table lookup. English is the primary language and the fallback;
// German lives only in the translation files the daemon serves.
type Table = Record<string, string>;

let table: Table = {};
let current = "en";

export async function loadLanguage(lang: string): Promise<void> {
  try {
    const r = await fetch(`/i18n/${lang}.json`);
    if (!r.ok) return;
    table = (await r.json()) as Table;
    current = lang;
    document.documentElement.setAttribute("lang", lang);
  } catch {
    /* keep whatever is loaded; the built-in defaults still read English */
  }
}

export function language(): string {
  return current;
}

/* Which language a setting of "system" means here.
 *
 * Only the two that exist. Anything else falls to English, which is the
 * fallback everywhere else in this file as well: every tr() call carries its
 * English text as the second argument, so English is the one language that
 * cannot go missing. */
export function systemLanguage(): string {
  const want = (typeof navigator === "undefined" ? "" : navigator.language) || "";
  return want.toLowerCase().startsWith("de") ? "de" : "en";
}

/* No setting means English, not the system.
 *
 * Following the system unasked is a different program on a German machine than
 * on an English one, decided by something nobody here set. Somebody who wants
 * that picks "System" in the settings and gets it; until then the window speaks
 * the language it was built in, which is also the language every check in this
 * project reads. */
export function chosenLanguage(setting: string | undefined): string {
  if (setting === "de" || setting === "en") return setting;
  if (setting === "system") return systemLanguage();
  return "en";
}

export function tr(key: string, fallback: string, vars?: Record<string, string | number>): string {
  let out = table[key] ?? fallback;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

// Errors reach the window as a stable code, never as prose: an error message is
// the worst possible place for a break in language. Details that cannot be
// translated — a path, a name — travel behind a vertical bar and land in
// {detail}. Anything unrecognised is shown as it came, so nothing is swallowed.
export function errText(e: unknown): string {
  /* Trimmed first.
   *
   * Go's http.Error puts a newline after the message, so what arrives is
   * "err.update.nothingSwapped\n". The pattern below anchors at the end of the
   * string, which that newline is not — so every error the daemon sent through
   * http.Error failed the test and was shown as its bare code, in red, to
   * somebody who had just been told something went wrong. */
  const raw = (e instanceof Error ? e.message : String(e ?? "")).trim();
  /* The first bar divides them, and only the first.
   *
   * Splitting on every bar and taking the first two pieces threw away
   * everything after a second one — and the detail is often a path, where a bar
   * is a perfectly legal character, or the message of an underlying error,
   * which can contain anything at all. The result was a plausible-looking path
   * with its end cut off, in the message somebody reads to find out what went
   * wrong. */
  const bar = raw.indexOf("|");
  const code = bar < 0 ? raw : raw.slice(0, bar);
  const detail = bar < 0 ? undefined : raw.slice(bar + 1);
  if (!/^err\.[\w.]+$/.test(code)) return raw;
  if (!(code in table)) return raw;
  return tr(code, code, detail === undefined ? undefined : { detail });
}

// Plural form: keys carry .one / .other, as the daemon's tables do.
export function trN(base: string, n: number, fallbackOne: string, fallbackOther: string): string {
  const key = n === 1 ? `${base}.one` : `${base}.other`;
  const fb = n === 1 ? fallbackOne : fallbackOther;
  return tr(key, fb, { n });
}
