/* The paths in a drop, and how they are typed into a terminal. Pure, so it is
   checked here rather than by dragging a file in a browser. */
import "./resolveTs.mjs";

const { droppedPaths, quotePath } = await import("./dropped.ts");

let failed = 0;
const claim = (ok, what) => {
  if (ok) return;
  console.error("  " + what);
  failed++;
};
const fake = (types) => ({ getData: (kind) => types[kind] ?? "" });

const one = droppedPaths(fake({ "text/uri-list": "file:///Users/matthias/Pictures/a%20shot.png" }));
claim(one.length === 1 && one[0] === "/Users/matthias/Pictures/a shot.png", `one file: ${JSON.stringify(one)}`);

const many = droppedPaths(fake({ "text/uri-list": "# comment\r\nfile:///a/one.png\r\nfile:///a/two.png\r\n" }));
claim(many.join("|") === "/a/one.png|/a/two.png", `two files and a comment: ${JSON.stringify(many)}`);

const text = droppedPaths(fake({ "text/plain": "just some words" }));
claim(text.join("|") === "just some words", `plain text passes through: ${JSON.stringify(text)}`);

claim(droppedPaths(fake({})).length === 0, "an empty drop is nothing");

claim(quotePath("/a/plain-path_1.png") === "/a/plain-path_1.png", "a plain path is not quoted");
claim(quotePath("/a/a shot.png") === "'/a/a shot.png'", `a space is quoted: ${quotePath("/a/a shot.png")}`);
claim(quotePath("/a/it's.png") === `'/a/it'\\''s.png'`, `an apostrophe survives: ${quotePath("/a/it's.png")}`);

if (failed) {
  console.error(`  ${failed} claims failed`);
  process.exit(1);
}
console.log("  dropped paths hold");
