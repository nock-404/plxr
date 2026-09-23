/* What counts as a picture, by its name alone. */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "picture.ts"), "utf8")
  .replace(/^export /gm, "")
  .replace(/: string(\[\])?/g, "")
  .replace(/: boolean/g, "");
const { pictureKind, isPicture } = await import(`data:text/javascript,${encodeURIComponent(`${src}\nexport { pictureKind, isPicture };`)}`);

for (const p of ["shot.png", "/a/b/Screenshot 2026.PNG", "./pics/deep.jpeg", "x.svg", "a.webp"]) {
  assert.equal(isPicture(p), true, p);
}
for (const p of ["notes.md", "a.go", "Makefile", ".png", "png", "/tmp/dir.png/inside.txt"]) {
  assert.equal(isPicture(p), false, p);
}
assert.equal(pictureKind("A.JPG"), "jpg");
console.log("picture: ok");
