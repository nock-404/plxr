"use client";

import { useEffect, useState } from "react";
import { tr } from "@/lib/i18n";
import { DRAWN_FOR_PLXR, PACK_LABELS, THIRD_PARTY, type ThirdPartySet } from "@/lib/icons";

/* What plxr ships that other people made, and on what terms.
 *
 * plxr is sold and its source is closed, so these notices are a condition, not
 * a courtesy: every set it ships asks for its copyright line and its licence to
 * travel with every copy. They do, twice. The files sit in the built output
 * under /licenses/ — inside the .app and the .exe — and this page reads those
 * same files back and prints them whole. Reading them instead of keeping a
 * second copy in the code means the page cannot drift from what actually
 * ships, and a file missing from a build says so here rather than showing
 * nothing. The list itself is written by tools/icons/build.py, from the sets
 * it fetched. */

function usedFor(set: ThirdPartySet): string {
  return set.uses
    .map((use) =>
      use.part === "files"
        ? tr("licences.files", "File kinds in the {pack} pack", { pack: PACK_LABELS[use.pack] })
        : tr("licences.icons", "Icons in the {pack} pack", { pack: PACK_LABELS[use.pack] }),
    )
    .join(" · ");
}

export default function Licences() {
  // null until every file has been asked for, so the page never calls a
  // licence missing while it is still reading it.
  const [texts, setTexts] = useState<Record<string, string | null> | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all(
      THIRD_PARTY.map(async (set) => {
        try {
          const response = await fetch(`/${set.licenceFile}`);
          return [set.id, response.ok ? await response.text() : null] as const;
        } catch {
          return [set.id, null] as const;
        }
      }),
    ).then((pairs) => {
      if (live) setTexts(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="tabbody">
      <span className="notice">
        {tr("licences.intro", "plxr ships work other people made. Each set is included at the commit shown, under the licence printed with it.")}
      </span>
      {THIRD_PARTY.map((set) => (
        <div key={set.id} className="licence" data-set={set.id}>
          <div className="licenceHead">
            <span className="licenceTitle">{set.title}</span>
            <span className="licenceKind">{set.licence}</span>
          </div>
          <span className="notice">{usedFor(set)}</span>
          <span className="licenceSource">
            {tr("licences.source", "{repo} at commit {commit}", { repo: set.repo, commit: set.commit })}
          </span>
          <div className="licenceText">
            {texts === null
              ? tr("licences.reading", "Reading the licence …")
              : (texts[set.id] ?? tr("licences.missing", "This licence file is missing from the build."))}
          </div>
        </div>
      ))}
      {DRAWN_FOR_PLXR.map((own) => (
        <span key={own.pack} className="notice">
          {tr("licences.drawn", "Drawn for plxr, in the style of the {pack} pack: {names}.", {
            pack: PACK_LABELS[own.pack],
            names: own.names.join(", "),
          })}
        </span>
      ))}
    </div>
  );
}
