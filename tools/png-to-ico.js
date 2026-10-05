#!/usr/bin/env node

// Wrap a small RGBA PNG in a one-image .ico (32bpp BI_RGB DIB + AND mask), the
// format an RT_ICON carries and the one `extractIcoFileRgba` decodes. Use it to
// give an executable that ships no icon resource an `iconFile` in lib/apps.js.
//
// Usage: node tools/png-to-ico.js in.png out.ico
//
// Pixels with alpha below 128 are also set in the AND mask, so a reader that
// ignores the alpha channel (Win9x, a 24bpp downconvert) still sees them as
// transparent.

'use strict';

const fs = require('fs');
const { PNG } = require('pngjs');

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node tools/png-to-ico.js in.png out.ico');
  process.exit(2);
}
const png = PNG.sync.read(fs.readFileSync(input));
const { width: w, height: h, data } = png;
if (w > 256 || h > 256) throw new Error(`icon is ${w}x${h}; an .ico entry is at most 256x256`);

const maskStride = ((w + 31) >> 5) << 2;
const dib = Buffer.alloc(40 + w * h * 4 + maskStride * h);
dib.writeUInt32LE(40, 0);          // biSize
dib.writeInt32LE(w, 4);
dib.writeInt32LE(h * 2, 8);        // colour rows + AND mask rows
dib.writeUInt16LE(1, 12);          // biPlanes
dib.writeUInt16LE(32, 14);         // biBitCount
dib.writeUInt32LE(w * h * 4 + maskStride * h, 20);
const maskAt = 40 + w * h * 4;
for (let y = 0; y < h; y++) {
  const row = h - 1 - y;           // bottom-up
  for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = 40 + (row * w + x) * 4;
    dib[d] = data[s + 2]; dib[d + 1] = data[s + 1]; dib[d + 2] = data[s]; dib[d + 3] = data[s + 3];
    if (data[s + 3] < 128) dib[maskAt + row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
  }
}

const header = Buffer.alloc(6 + 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);        // type: icon
header.writeUInt16LE(1, 4);        // one image
header[6] = w & 0xff;              // 256 is written as 0
header[7] = h & 0xff;
header.writeUInt16LE(1, 10);       // planes
header.writeUInt16LE(32, 12);      // bit count
header.writeUInt32LE(dib.length, 14);
header.writeUInt32LE(header.length, 18);
fs.writeFileSync(output, Buffer.concat([header, dib]));
console.log(`WROTE ${output} (${w}x${h}, ${header.length + dib.length} bytes)`);
