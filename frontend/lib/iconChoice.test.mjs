/* The icon pack per skin.
 *
 * What has to hold: every skin draws with its own pack from his table while a
 * look says "matching the appearance"; a pack picked over it wins in every skin;
 * Lucide can be picked and belongs to no skin; a new look follows the skin; and
 * every look stored before the skins brought their packs follows the skin once
 * it is read back, while a pack picked afterwards stays picked.
 */
import "./resolveTs.mjs";

const { FOLLOW_SKIN, SKIN_PACKS, ICONS_VERSION, packFor, migrateIcons } = await import("./iconChoice.ts");
const { ICON_PACKS, DEFAULT_ICON_PACK } = await import("./icons.ts");
const { DEFAULTS } = await import("./theme.ts");

let failed = 0;
let held = 0;
const claim = (ok, what) => {
  if (ok) {
    held++;
    return;
  }
  console.error("  " + what);
  failed++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SKINS = ["crt", "win95", "sketch", "pixel"];

// His table, exactly.
claim(same(SKIN_PACKS, { crt: "tabler", win95: "pixel", sketch: "phosphor", pixel: "pixel" }), `the table is ${JSON.stringify(SKIN_PACKS)}`);
claim(Object.values(SKIN_PACKS).every((p) => ICON_PACKS.includes(p)), "a skin brings a pack this build does not have");
claim(ICON_PACKS.includes("lucide") && !Object.values(SKIN_PACKS).includes("lucide"), "Lucide is not selectable, or belongs to a skin");

// Following the skin, each skin draws with its own.
for (const skin of SKINS) {
  claim(packFor(skin, FOLLOW_SKIN) === SKIN_PACKS[skin], `${skin} following the skin draws ${packFor(skin, FOLLOW_SKIN)}, not ${SKIN_PACKS[skin]}`);
}
// A pack picked over it wins in every skin.
for (const skin of SKINS) {
  for (const pack of ICON_PACKS) {
    claim(packFor(skin, pack) === pack, `${skin} with ${pack} picked draws ${packFor(skin, pack)}`);
  }
}
// A pack or a skin this build does not know.
claim(packFor("sketch", "fontawesome") === "phosphor", `an unknown pack in sketch draws ${packFor("sketch", "fontawesome")}, not the skin's`);
claim(packFor("sketch", undefined) === "phosphor", `no pack at all in sketch draws ${packFor("sketch", undefined)}`);
claim(packFor("amiga", FOLLOW_SKIN) === DEFAULT_ICON_PACK, `an unknown skin draws ${packFor("amiga", FOLLOW_SKIN)}, not the default pack`);

// A new look follows the skin.
claim(DEFAULTS.icons === FOLLOW_SKIN && DEFAULTS.iconsVersion === ICONS_VERSION, `a new look stores ${DEFAULTS.icons} at version ${DEFAULTS.iconsVersion}`);
claim(packFor(DEFAULTS.skin, DEFAULTS.icons) === "tabler", `a new look on the tube draws ${packFor(DEFAULTS.skin, DEFAULTS.icons)}`);

// Every look stored before this version follows the skin once read back.
for (const pack of [...ICON_PACKS, "fontawesome", undefined]) {
  const old = { skin: "win95", palette: "win95", icons: pack, size: 0.9 };
  const read = migrateIcons(old);
  claim(read.icons === FOLLOW_SKIN && read.iconsVersion === ICONS_VERSION, `a stored look with ${pack} reads back as ${read.icons} at ${read.iconsVersion}`);
  claim(read.skin === "win95" && read.palette === "win95" && read.size === 0.9, `the migration changed more than the pack: ${JSON.stringify(read)}`);
  claim(same(old, { skin: "win95", palette: "win95", icons: pack, size: 0.9 }), "the migration changed the look it was handed");
}
claim(migrateIcons({ skin: "crt", iconsVersion: 1, icons: "pixel" }).icons === FOLLOW_SKIN, "a look of an older version kept its pack");

// A pack picked after the migration stays picked, and so does following.
for (const choice of [...ICON_PACKS, FOLLOW_SKIN]) {
  const kept = migrateIcons({ skin: "crt", icons: choice, iconsVersion: ICONS_VERSION });
  claim(kept.icons === choice, `a look of this version with ${choice} reads back as ${kept.icons}`);
}
claim(migrateIcons({ skin: "crt", icons: "fontawesome", iconsVersion: ICONS_VERSION }).icons === FOLLOW_SKIN, "an unknown pack at this version was kept");

// Once is once.
const twice = migrateIcons(migrateIcons({ skin: "sketch", icons: "tabler" }));
claim(same(twice, { skin: "sketch", icons: FOLLOW_SKIN, iconsVersion: ICONS_VERSION }), `migrated twice: ${JSON.stringify(twice)}`);
const picked = migrateIcons(migrateIcons({ ...migrateIcons({ skin: "sketch", icons: "tabler" }), icons: "lucide" }));
claim(picked.icons === "lucide", `a pick after the migration is lost on the next read: ${picked.icons}`);

if (failed) {
  console.error(`  ${failed} claims failed`);
  process.exit(1);
}
console.log(`  ${held} claims hold`);
