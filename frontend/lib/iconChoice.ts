/* Which pack draws the marks: the one the skin brings, or one picked over it.
 *
 * Each skin has a pack of its own, so a look is whole the moment a skin is
 * picked: the tube's even thin lines, Windows 95's and the console's pixel
 * grid, the notebook's rounder pen. Lucide is still there to be picked and
 * belongs to no skin. A pack picked in the settings is an override and stays
 * picked, through every change of skin, until "matching the appearance" is
 * picked again.
 *
 * Pure, so a unit test holds the table, the resolution and the migration
 * without a window.
 */
import { DEFAULT_ICON_PACK, ICON_PACKS, type IconPack } from "./icons";
import type { Skin } from "./theme";

// The stored value that means "whatever the skin brings".
export const FOLLOW_SKIN = "skin";

// What a look stores: the skin's pack, or a pack picked over it.
export type IconChoice = IconPack | typeof FOLLOW_SKIN;

// His table (13.09.2026).
export const SKIN_PACKS: Record<Skin, IconPack> = {
  crt: "tabler",
  win95: "pixel",
  sketch: "phosphor",
  pixel: "pixel",
};

/* The version of what a stored look's icons mean. Looks stored before the
   skins brought their packs carry none — and every one of them carries a pack,
   because the whole look was always saved: the default of the day, not a
   choice anybody made. */
export const ICONS_VERSION = 2;

const isPack = (value: unknown): value is IconPack => (ICON_PACKS as readonly unknown[]).includes(value);

/* The pack that draws, for a skin and what the look stores. A pack this build
   does not know — a look kept by an older or a newer plxr — draws like
   "matching the appearance" rather than with nothing, and a skin it does not
   know draws with the default pack. */
export function packFor(skin: string, icons: unknown): IconPack {
  if (icons !== FOLLOW_SKIN && isPack(icons)) return icons;
  return (SKIN_PACKS as Record<string, IconPack>)[skin] ?? DEFAULT_ICON_PACK;
}

/* A look as it is read back from where it was kept. Once, for a look stored
   before this version, the pack becomes "matching the appearance"; a look of
   this version keeps what it says. Running it twice changes nothing. */
export function migrateIcons<T extends { icons?: unknown; iconsVersion?: unknown }>(look: T): T & { icons: IconChoice; iconsVersion: number } {
  if (look.iconsVersion === ICONS_VERSION && (look.icons === FOLLOW_SKIN || isPack(look.icons))) {
    return { ...look, icons: look.icons as IconChoice, iconsVersion: ICONS_VERSION };
  }
  return { ...look, icons: FOLLOW_SKIN, iconsVersion: ICONS_VERSION };
}
