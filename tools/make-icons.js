#!/usr/bin/env node
/**
 * make-icons.js — generates the PWA / home-screen icons.
 *
 * Usage:  node tools/make-icons.js
 * Writes: icons/icon-192.png, icon-512.png, icon-512-maskable.png,
 *         icons/apple-touch-icon.png
 *
 * Why generate rather than commit binaries: the project rule is that nothing
 * external is fetched at load and the app stays reproducible from source. iOS
 * will not accept an SVG for apple-touch-icon, so real PNGs are unavoidable —
 * but they can at least be built from code. Node's zlib is the only dependency,
 * and it is built in.
 *
 * The mark matches the favicon in rise-sports.html: a lime→teal diagonal
 * gradient with a white bolt. Keep the two in sync by eye if either changes.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const LIME = [0x65, 0xa3, 0x0d];
const TEAL = [0x0d, 0x94, 0x88];

/* ---------- PNG encoding ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  // one filter byte (0 = None) per scanline
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const o = y * (1 + width * 4);
    raw[o] = 0;
    rgba.copy(raw, o + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------- drawing ---------- */

/* The bolt from the favicon path, in a 64x64 design space. */
const BOLT = [[36, 9], [17, 37], [28, 37], [25, 55], [45, 26], [34, 26]];

function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* Rounded-rect coverage. r = 0 gives a plain square, which is what the
   maskable and Apple icons want since the platform applies its own mask. */
function inRounded(px, py, size, r) {
  if (r <= 0) return true;
  const x = Math.min(px, size - px), y = Math.min(py, size - py);
  if (x >= r || y >= r) return true;
  const dx = r - x, dy = r - y;
  return dx * dx + dy * dy <= r * r;
}

/**
 * @param size   pixel dimensions
 * @param radius corner radius in design units (0-32); 0 = square
 * @param inset  fraction of the canvas kept clear around the bolt. Maskable
 *               icons get cropped to a circle, so the mark has to sit inside
 *               the safe zone or it loses its tips.
 */
function draw(size, radius, inset) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3;                      // 3x3 supersampling for smooth edges
  const scale = size / 64;
  const r = radius * scale;

  // bolt scaled into the safe zone
  const k = 1 - 2 * inset;
  const bolt = BOLT.map(([x, y]) => [(x * k + 64 * inset) * scale, (y * k + 64 * inset) * scale]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0, bolthits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          if (inRounded(px, py, size, r)) cov++;
          if (inPoly(px, py, bolt)) bolthits++;
        }
      }
      const n = SS * SS;
      const a = cov / n, b = bolthits / n;

      // 135deg lime -> teal
      const t = (x / size + y / size) / 2;
      const bg = [0, 1, 2].map(i => Math.round(LIME[i] + (TEAL[i] - LIME[i]) * t));
      // composite white bolt over the gradient
      const px4 = (y * size + x) * 4;
      rgba[px4 + 0] = Math.round(bg[0] + (255 - bg[0]) * b);
      rgba[px4 + 1] = Math.round(bg[1] + (255 - bg[1]) * b);
      rgba[px4 + 2] = Math.round(bg[2] + (255 - bg[2]) * b);
      rgba[px4 + 3] = Math.round(a * 255);
    }
  }
  return encodePNG(size, size, rgba);
}

/* ---------- output ---------- */
const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });

const jobs = [
  // name,                   size, radius, inset
  ["icon-192.png",            192,     14, 0.13],
  ["icon-512.png",            512,     14, 0.13],
  ["icon-512-maskable.png",   512,      0, 0.22],  // safe zone for circular crop
  ["apple-touch-icon.png",    180,      0, 0.13]   // iOS masks it itself
];

for (const [name, size, radius, inset] of jobs) {
  const buf = draw(size, radius, inset);
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${buf.length} bytes`);
}
console.log("\nicons written to icons/");
