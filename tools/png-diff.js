#!/usr/bin/env node
// Compare two PNGs pixel by pixel.
//
//   node tools/png-diff.js a.png b.png [--tolerance=N] [--region=X,Y,W,H]
//                                      [--out=diff.png] [--quiet]
//
// WHY THIS EXISTS: "does this refactor change what the screen shows" is the
// question behind most presentation/rendering work, and it was being answered
// by a private pixelDiff() copied into individual tests (test-dxball-candidate,
// test-qbob-candidate, ...). This is that primitive, usable from the shell and
// importable as `require('./png-diff').diffPng(a, b, opts)`.
//
// Prints the differing-pixel count, the share of the compared area, the worst
// per-channel delta and the bounding box of the changes. Exit code is 0 when
// the images match within --tolerance, 1 when they differ, 2 on error — so it
// drops straight into a shell `&&` chain.
//
// --tolerance=N ignores per-channel differences of N or less (JPEG-free canvas
// output is exact, but GPU paths can differ by a unit of rounding).
// --out=diff.png writes a map of the changed pixels: red where they differ,
// the original dimmed where they do not. Importers can pass
// `includeAlpha: false` when transparency is deliberately outside a test's
// contract; the command-line comparator checks RGBA by default.
// Importers can select `metric: 'sum'` to compare the sum of absolute channel
// differences against tolerance. The default 'max' compares each channel;
// maxDelta always reports the worst individual channel, for either metric.
// totalDelta sums absolute differences of all included channels in the region,
// including differences below tolerance; it measures error magnitude, not pixels.
// `sizePolicy: 'overlap'` opts into comparing only shared image coordinates.
// The default 'strict' returns early on different dimensions. In overlap mode
// sizeMismatch still reports the mismatch; width/height and output use image A.

const fs = require('fs');
const { PNG } = require('pngjs');

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function diffPng(fileA, fileB, options) {
  options = options || {};
  const tolerance = options.tolerance | 0;
  const channelCount = options.includeAlpha === false ? 3 : 4;
  const metric = options.metric === undefined ? 'max' : options.metric;
  if (metric !== 'max' && metric !== 'sum') throw new Error(`unknown PNG difference metric: ${metric}`);
  const sizePolicy = options.sizePolicy === undefined ? 'strict' : options.sizePolicy;
  if (sizePolicy !== 'strict' && sizePolicy !== 'overlap') throw new Error(`unknown PNG size policy: ${sizePolicy}`);
  const a = typeof fileA === 'string' ? readPng(fileA) : fileA;
  const b = typeof fileB === 'string' ? readPng(fileB) : fileB;
  const sizeMismatch = a.width !== b.width || a.height !== b.height;
  if (sizeMismatch && sizePolicy === 'strict') {
    return {
      sizeMismatch: true,
      a: { width: a.width, height: a.height },
      b: { width: b.width, height: b.height },
    };
  }
  const region = options.region || { x: 0, y: 0, w: a.width, h: a.height };
  const rx = region.x | 0, ry = region.y | 0;
  const x0 = Math.max(0, rx);
  const y0 = Math.max(0, ry);
  const x1 = Math.min(a.width, b.width, rx + (region.w | 0));
  const y1 = Math.min(a.height, b.height, ry + (region.h | 0));
  let changed = 0;
  let maxDelta = 0;
  let totalDelta = 0;
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  const out = options.out ? new PNG({ width: a.width, height: a.height }) : null;
  if (out) {
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = a.data[i] >> 1;
      out.data[i + 1] = a.data[i + 1] >> 1;
      out.data[i + 2] = a.data[i + 2] >> 1;
      out.data[i + 3] = 255;
    }
  }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      let delta = 0;
      for (let c = 0; c < channelCount; c++) {
        const d = Math.abs(a.data[i + c] - b.data[j + c]);
        totalDelta += d;
        if (metric === 'sum') delta += d;
        else if (d > delta) delta = d;
        if (d > maxDelta) maxDelta = d;
      }
      if (delta <= tolerance) continue;
      changed++;
      if (x < bx0) bx0 = x;
      if (y < by0) by0 = y;
      if (x > bx1) bx1 = x;
      if (y > by1) by1 = y;
      if (out) {
        out.data[i] = 255;
        out.data[i + 1] = 0;
        out.data[i + 2] = 0;
        out.data[i + 3] = 255;
      }
    }
  }
  if (out) fs.writeFileSync(options.out, PNG.sync.write(out));
  const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return {
    sizeMismatch,
    width: a.width,
    height: a.height,
    compared: area,
    changed,
    share: area ? changed / area : 0,
    maxDelta,
    totalDelta,
    box: changed
      ? { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 }
      : null,
  };
}

module.exports = { diffPng, readPng };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (name, dflt) => {
    const a = argv.find(x => x.startsWith(`--${name}=`));
    return a === undefined ? dflt : a.slice(name.length + 3);
  };
  const files = argv.filter(a => !a.startsWith('--'));
  if (files.length !== 2) {
    console.error('usage: node tools/png-diff.js a.png b.png [--tolerance=N] ' +
      '[--region=X,Y,W,H] [--out=diff.png] [--quiet]');
    process.exit(2);
  }
  const regionArg = opt('region', '');
  const region = regionArg
    ? (([x, y, w, h]) => ({ x, y, w, h }))(regionArg.split(',').map(Number))
    : null;
  let result;
  try {
    result = diffPng(files[0], files[1], {
      tolerance: Number(opt('tolerance', 0)),
      region,
      out: opt('out', null),
    });
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(2);
  }
  const quiet = argv.includes('--quiet');
  if (result.sizeMismatch) {
    console.log(`size mismatch: ${result.a.width}x${result.a.height} vs ` +
      `${result.b.width}x${result.b.height}`);
    process.exit(1);
  }
  if (!quiet) {
    const pct = (result.share * 100).toFixed(4);
    console.log(`${result.changed} of ${result.compared} pixels differ (${pct}%), ` +
      `max channel delta ${result.maxDelta}`);
    if (result.box) {
      console.log(`changed box: ${result.box.x},${result.box.y} ` +
        `${result.box.w}x${result.box.h}`);
    }
  }
  process.exit(result.changed ? 1 : 0);
}
