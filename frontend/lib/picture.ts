/* Which files are looked at rather than read.
 *
 * A path printed by a program is clicked and opens in the window; when what it
 * names is a screenshot, the window used to answer "this file is binary, so
 * there is nothing sensible to show". There is: the picture. Decided by the
 * name alone, because that is all that is known before anything is fetched —
 * the service says what the bytes are when it hands them over.
 */
const PICTURES = new Set([
  "apng", "avif", "bmp", "gif", "heic", "heif", "ico", "jpeg", "jpg", "jxl", "png", "svg", "tif", "tiff", "webp",
]);

export function pictureKind(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  const ext = name.slice(dot + 1).toLowerCase();
  return PICTURES.has(ext) ? ext : "";
}

export function isPicture(path: string): boolean {
  return pictureKind(path) !== "";
}
