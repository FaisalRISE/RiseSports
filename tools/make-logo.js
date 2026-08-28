#!/usr/bin/env node
/**
 * make-logo.js — turns brand/RISE-Sports-Logo.png into small inline assets.
 *
 * Usage:  node tools/make-logo.js
 * Writes: brand/logo-inline.json  { wordmark, wordmarkLight, width, height }
 *
 * The source is 2427x1042 RGBA and 2 MB. Embedded raw it would push the
 * single-file build past 3 MB, so it gets decoded, box-downscaled and
 * re-encoded here. The app must stay self-contained with no network request at
 * load, so the result ships as a data URI rather than a linked file.
 *
 * Node's zlib is the only dependency and it is built in.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SRC = path.join(__dirname, "..", "brand", "RISE-Sports-Logo.png");
const OUT = path.join(__dirname, "..", "brand", "logo-inline.json");
const TARGET_W = 320;                       // wide enough for a retina nav mark

/* ---------- decode ---------- */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8, w = 0, h = 0, bitDepth = 0, colour = 0, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colour = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("only 8-bit supported, got " + bitDepth);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
  if (!ch) throw new Error("unsupported colour type " + colour);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  // normalise to RGBA
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * ch, d = i * 4;
    if (ch === 4) { rgba[d] = out[s]; rgba[d+1] = out[s+1]; rgba[d+2] = out[s+2]; rgba[d+3] = out[s+3]; }
    else if (ch === 3) { rgba[d] = out[s]; rgba[d+1] = out[s+1]; rgba[d+2] = out[s+2]; rgba[d+3] = 255; }
    else if (ch === 2) { rgba[d] = rgba[d+1] = rgba[d+2] = out[s]; rgba[d+3] = out[s+1]; }
    else { rgba[d] = rgba[d+1] = rgba[d+2] = out[s]; rgba[d+3] = 255; }
  }
  return { w, h, rgba };
}

/* ---------- box downscale, alpha-weighted ---------- */
function downscale(img, tw) {
  const th = Math.max(1, Math.round(img.h * (tw / img.w)));
  const out = Buffer.alloc(tw * th * 4);
  const sx = img.w / tw, sy = img.h / th;
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.min(img.h, Math.ceil((y + 1) * sy));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.min(img.w, Math.ceil((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.w + xx) * 4, al = img.rgba[i + 3] / 255;
          // premultiply so transparent pixels do not drag colour toward black
          r += img.rgba[i] * al; g += img.rgba[i + 1] * al; b += img.rgba[i + 2] * al;
          a += img.rgba[i + 3]; n++;
        }
      }
      const d = (y * tw + x) * 4, aa = a / n;
      const un = aa > 0 ? (n * 255) / a : 0;
      out[d]     = Math.min(255, Math.round((r / n) * un));
      out[d + 1] = Math.min(255, Math.round((g / n) * un));
      out[d + 2] = Math.min(255, Math.round((b / n) * un));
      out[d + 3] = Math.round(aa);
    }
  }
  return { w: tw, h: th, rgba: out };
}

/* The mark is near-black; on a dark surface it needs inverting. Keeps alpha. */
function invert(img) {
  const out = Buffer.from(img.rgba);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - out[i]; out[i + 1] = 255 - out[i + 1]; out[i + 2] = 255 - out[i + 2];
  }
  return { w: img.w, h: img.h, rgba: out };
}

/* ---------- encode ---------- */
const CRC = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t; })();
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
function encodePNG(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(img.h * (1 + img.w * 4));
  for (let y = 0; y < img.h; y++) {
    const o = y * (1 + img.w * 4);
    raw[o] = 0;
    img.rgba.copy(raw, o + 1, y * img.w * 4, (y + 1) * img.w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x08 + 2]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const src = decodePNG(fs.readFileSync(SRC));
console.log(`source     ${src.w}x${src.h}`);
const small = downscale(src, TARGET_W);
const dark = encodePNG(small);
const light = encodePNG(invert(small));
const uri = b => "data:image/png;base64," + b.toString("base64");

fs.writeFileSync(OUT, JSON.stringify({
  width: small.w, height: small.h,
  wordmark: uri(dark),        // dark mark, for light backgrounds
  wordmarkLight: uri(light)   // inverted, for dark surfaces
}, null, 0));

console.log(`downscaled ${small.w}x${small.h}`);
console.log(`dark  ${Math.round(dark.length / 1024)} KB  -> ${Math.round(uri(dark).length / 1024)} KB as a data URI`);
console.log(`light ${Math.round(light.length / 1024)} KB`);
console.log(`written ${path.relative(process.cwd(), OUT)}`);
