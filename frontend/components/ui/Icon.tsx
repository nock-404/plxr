"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_ICON_PACK, ICON_PACKS, SPRITE_VERSIONS, type IconName, type IconPack } from "@/lib/icons";
import { THEME_CHANGED } from "@/lib/theme";

/* One mark, drawn from the chosen pack's sprite.
 *
 * Every pack is one file, /icons/<pack>.svg, with a <symbol> per name — built
 * by tools/icons/build.py from sets fetched at pinned commits, never edited by
 * hand. An icon refers to its symbol instead of carrying the drawing, so the
 * window loads the one pack in use, and changing the pack changes one
 * attribute on every mark.
 *
 * The colour is currentColor all the way down: an icon is the colour of the
 * text around it, which is how every skin keeps colouring the marks it
 * coloured when they were glyphs. The size is the frame's — .uiIcon in
 * layout.css — and so is the pixel pack's size, which follows the screen. */

function packNow(): IconPack {
  const chosen = document.documentElement.getAttribute("data-icons") ?? "";
  return (ICON_PACKS as readonly string[]).includes(chosen) ? (chosen as IconPack) : DEFAULT_ICON_PACK;
}

// apply() sets data-icons and then announces the change; that is the moment
// every mark has to look again.
function follow(changed: () => void): () => void {
  window.addEventListener(THEME_CHANGED, changed);
  return () => window.removeEventListener(THEME_CHANGED, changed);
}

export default function Icon({ name }: { name: IconName }) {
  const pack = useSyncExternalStore(follow, packNow, () => DEFAULT_ICON_PACK);
  return (
    <svg className="uiIcon" data-icon={name} aria-hidden="true" focusable="false">
      {/* The version is the sprite's own hash: a web view that kept the file
          from before an update would otherwise draw from the old one, and a
          name added since would come out as nothing. */}
      <use href={`/icons/${pack}.svg?v=${SPRITE_VERSIONS[pack]}#${name}`} />
    </svg>
  );
}
