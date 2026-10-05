#!/usr/bin/env node
'use strict';

// A fully transparent capture and a flat desktop-teal one are different
// failures: transparent means nothing composited at all (the capture beat the
// first paint, or the box was loaded enough that the run never got there),
// teal means the desktop composited and the app put no window on it. Both are
// a couple of KB of PNG, so the byte count cannot tell them apart and the
// sweep used to call both BLANK -- which is how three of seven titles on the
// Nodtronics CD were written off as broken when they were only photographed
// too early.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');
const { writePng } = require('../tools/png-inspect');
const { pngVerdict } = require('../tools/iso-title-sweep');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-verdict-'));
const fill = (name, pick) => {
  const image = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const offset = (y * 32 + x) * 4;
      const [r, g, b, a] = pick(x, y);
      image.data[offset] = r; image.data[offset + 1] = g;
      image.data[offset + 2] = b; image.data[offset + 3] = a;
    }
  }
  const file = path.join(dir, name);
  writePng(file, image);
  return file;
};

const transparent = fill('transparent.png', () => [0, 0, 0, 0]);
const teal = fill('teal.png', () => [0, 128, 128, 255]);
const content = fill('content.png', (x, y) =>
  [(x * 8) & 0xff, (y * 8) & 0xff, x === y ? 255 : 16, 255]);

{
  const v = pngVerdict(transparent);
  assert.strictEqual(v.drew, false);
  assert.strictEqual(v.blank, false,
    'a fully transparent capture is not "the app drew nothing"');
  assert.match(v.note, /transparent/);
}

{
  const v = pngVerdict(teal);
  assert.strictEqual(v.drew, false);
  assert.strictEqual(v.blank, true,
    'a composited desktop with no window on it is a real blank');
}

{
  const v = pngVerdict(content);
  assert.strictEqual(v.drew, true, 'a picture with content must read as DRAWS');
}

{
  const v = pngVerdict(path.join(dir, 'missing.png'));
  assert.strictEqual(v.drew, false);
  assert.strictEqual(v.blank, false, 'no capture at all is not a blank either');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS  the sweep separates a transparent capture from a blank desktop');
