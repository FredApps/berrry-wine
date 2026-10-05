#!/usr/bin/env node

'use strict';

// Where is the coloured thing in this frame?
//
//   node tools/png-color-box.js <file.png> --color=200,30,30 [--tol=70]
//                               [--rect=X,Y,W,H] [--json]
//
// png-inspect.js `probe --color=` answers "how many pixels are this colour"
// and prints a box; this answers "where is the object" and hands back the
// numbers, because the question a test asks is usually about MOVEMENT -- the
// same object in two frames, and how far it travelled. Parsing a printed box
// out of another tool's stdout is how that assertion rots.
//
// The centroid, not the box, is the thing to compare between two frames: a
// bounding box jumps by a whole object width the moment one edge pixel falls
// outside the tolerance, while the centroid of a few thousand pixels moves
// smoothly and is unbothered by a stray match somewhere else in the picture.
//
// `--rect` exists for the same reason: a colour is rarely unique in a real
// screenshot (Blobby Volley's palms are as green as its right-hand player),
// so the caller names the band the object lives in.

const fs = require('fs');
const { PNG } = require('pngjs');

function colorBox(file, opts) {
  const o = opts || {};
  const target = o.color || [255, 0, 0];
  const tol = o.tol === undefined ? 40 : o.tol;
  const png = PNG.sync.read(Buffer.isBuffer(file) ? file : fs.readFileSync(file));
  const [rx, ry, rw, rh] = o.rect || [0, 0, png.width, png.height];
  const x1 = Math.min(png.width, rx + rw);
  const y1 = Math.min(png.height, ry + rh);
  let n = 0, sx = 0, sy = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = Math.max(0, ry); y < y1; y++) {
    for (let x = Math.max(0, rx); x < x1; x++) {
      const i = (y * png.width + x) << 2;
      if (Math.abs(png.data[i] - target[0]) > tol) continue;
      if (Math.abs(png.data[i + 1] - target[1]) > tol) continue;
      if (Math.abs(png.data[i + 2] - target[2]) > tol) continue;
      n++; sx += x; sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!n) return { count: 0, cx: null, cy: null, x0: null, x1: null, y0: null, y1: null };
  return {
    count: n,
    cx: sx / n, cy: sy / n,
    x0: minX, x1: maxX, y0: minY, y1: maxY,
    w: maxX - minX + 1, h: maxY - minY + 1,
  };
}

module.exports = { colorBox };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const file = argv.find(a => !a.startsWith('--'));
  const arg = (name, dflt) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : dflt;
  };
  if (!file) {
    console.error('usage: node tools/png-color-box.js <file.png> --color=R,G,B '
      + '[--tol=N] [--rect=X,Y,W,H] [--json]');
    process.exit(2);
  }
  const nums = s => String(s).split(',').map(Number);
  const box = colorBox(file, {
    color: nums(arg('color', '255,0,0')),
    tol: Number(arg('tol', 40)),
    rect: arg('rect', null) ? nums(arg('rect')) : null,
  });
  if (argv.includes('--json')) {
    console.log(JSON.stringify(box));
  } else if (!box.count) {
    console.log('no pixels matched');
  } else {
    console.log(`${box.count} px   centroid ${box.cx.toFixed(1)},${box.cy.toFixed(1)}`
      + `   box ${box.x0}..${box.x1} x ${box.y0}..${box.y1} (${box.w}x${box.h})`);
  }
}
