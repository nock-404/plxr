/* A PNG, read, for the gates that read colours off a screenshot.
 *
 * icons.mjs held the only copy, and the stripe plates in usage.mjs need the
 * same reader: one copy in a kit, as the way into the window is kept in
 * gatekit.mjs, rather than a second one that drifts. No dependencies.
 *
 * Chrome writes 8-bit RGB or RGBA, non-interlaced. That is all this reads. */
import { inflateSync } from "node:zlib";

export function readPng(buffer) {
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  const data = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const kind = buffer.toString("ascii", at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      if (body[12] !== 0) throw new Error("an interlaced PNG");
    } else if (kind === "IDAT") data.push(body);
    else if (kind === "IEND") break;
    at += 12 + length;
  }
  if (depth !== 8 || (type !== 2 && type !== 6)) throw new Error(`a PNG of depth ${depth}, type ${type}`);
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * bpp;
  const rgb = new Uint8Array(width * height * 3);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? line[x - bpp] : 0;
      const up = previous[x];
      const corner = x >= bpp ? previous[x - bpp] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      line[x] = (line[x] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      rgb[(y * width + x) * 3] = line[x * bpp];
      rgb[(y * width + x) * 3 + 1] = line[x * bpp + 1];
      rgb[(y * width + x) * 3 + 2] = line[x * bpp + 2];
    }
    previous = line;
  }
  return { width, height, rgb };
}
