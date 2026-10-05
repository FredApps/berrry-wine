#!/usr/bin/env node
// Lay explicit frames side by side, each scaled to the SAME output shape, so a
// "how much magnification" question can be answered by looking once.
//
//   node tools/zoom-compare-sheet.js --shape=667x375 --scale=2 \
//        --tile=a.png:1.0x.667x375.31px --tile=b.png:1.25x.534x300.39px \
//        [--cols=N] [--title=text] [--out=sheet.png] [--open]
//
// WHY THIS EXISTS: a phone magnification factor (`mobileZoom` in lib/apps.js)
// is settled by how big a sprite READS on the glass, and that is not something
// a number decides -- SkiFree went 1.0 "too small", 1.5 "too big" one round
// trip at a time, each round trip costing a rotation, a relaunch and a report.
// The frames are cheap (one `test/run.js --screen=WxH --png=` each); what was
// missing was a way to put them in front of somebody together.
//
// tools/app-contact-sheet.js cannot do this: it resolves every filename back
// to an app id in lib/apps.js and labels the tile with that id, so N captures
// of ONE app collapse to one tile and there is nowhere to write the factor.
//
// THE POINT IS THE COMMON SHAPE. Each tile is scaled to `--shape` (the CSS
// viewport the frames are destined for) before it is drawn, which is exactly
// what the single-app fit does at run time, so a 445x250 frame and a 667x375
// one become the same size on the sheet and the only thing that differs
// between tiles is how big the guest's own pixels come out. Scaling is
// NEAREST-NEIGHBOUR on purpose: index.html paints the guest canvas with
// `image-rendering: pixelated`, so anything smoother would be a picture of a
// browser nobody is using.
//
// `--scale` multiplies the whole sheet afterwards (also nearest), because a
// 667x375 tile is legible on a phone held at arm's length and not on a monitor
// at 1:1. It changes every tile equally, so it cannot flatter one of them.
//
// Labels are [a-z0-9 ._/x+-] -- write "1.25x 534x300 39px" rather than
// punctuation this font does not carry. Unknown characters render blank.
//
// Pure JS: pngjs only, same as every other tool here. No ImageMagick.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ---- 5x7 bitmap font ------------------------------------------------------
// Deliberately a copy of the table in tools/app-contact-sheet.js rather than a
// shared import: that file is a script that runs its whole pipeline on
// require, so there is nothing to import from it without restructuring a tool
// this change has no business touching.
const FONT_ROWS = 7, FONT_COLS = 5;
const GLYPHS = {
  a: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  b: '####.|#...#|####.|#...#|#...#|#...#|####.',
  c: '.###.|#...#|#....|#....|#....|#...#|.###.',
  d: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  e: '#####|#....|####.|#....|#....|#....|#####',
  f: '#####|#....|####.|#....|#....|#....|#....',
  g: '.###.|#...#|#....|#.###|#...#|#...#|.###.',
  h: '#...#|#...#|#####|#...#|#...#|#...#|#...#',
  i: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  j: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  k: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  l: '#....|#....|#....|#....|#....|#....|#####',
  m: '#...#|##.##|#.#.#|#...#|#...#|#...#|#...#',
  n: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  o: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  p: '####.|#...#|#...#|####.|#....|#....|#....',
  q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  r: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  s: '.####|#....|#....|.###.|....#|....#|####.',
  t: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  u: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  v: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  w: '#...#|#...#|#...#|#...#|#.#.#|##.##|#...#',
  x: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  z: '#####|....#|...#.|..#..|.#...|#....|#####',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  2: '.###.|#...#|....#|...#.|..#..|.#...|#####',
  3: '#####|...#.|..#..|...#.|....#|#...#|.###.',
  4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  5: '#####|#....|####.|....#|....#|#...#|.###.',
  6: '..##.|.#...|#....|####.|#...#|#...#|.###.',
  7: '#####|....#|...#.|..#..|.#...|.#...|.#...',
  8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  9: '.###.|#...#|#...#|.####|....#|...#.|.##..',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  '-': '.....|.....|.....|#####|.....|.....|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '/': '....#|...#.|...#.|..#..|.#...|.#...|#....',
  _: '.....|.....|.....|.....|.....|.....|#####',
};
for (const k of Object.keys(GLYPHS)) GLYPHS[k] = GLYPHS[k].split('|');

const makeSurface = (w, h, rgb) => {
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = rgb[0]; px[i * 4 + 1] = rgb[1]; px[i * 4 + 2] = rgb[2]; px[i * 4 + 3] = 255;
  }
  return { w, h, px };
};

const textWidth = (text, scale) => String(text).length * (FONT_COLS + 1) * scale;

const drawText = (dst, text, x, y, scale, rgb) => {
  let cx = x;
  for (const rawCh of String(text)) {
    const glyph = GLYPHS[rawCh.toLowerCase()];
    if (glyph) {
      for (let gy = 0; gy < FONT_ROWS; gy++) {
        for (let gx = 0; gx < FONT_COLS; gx++) {
          if (glyph[gy][gx] !== '#') continue;
          for (let sy = 0; sy < scale; sy++) {
            const py = y + gy * scale + sy;
            if (py < 0 || py >= dst.h) continue;
            for (let sx = 0; sx < scale; sx++) {
              const pxx = cx + gx * scale + sx;
              if (pxx < 0 || pxx >= dst.w) continue;
              const o = (py * dst.w + pxx) * 4;
              dst.px[o] = rgb[0]; dst.px[o + 1] = rgb[1]; dst.px[o + 2] = rgb[2]; dst.px[o + 3] = 255;
            }
          }
        }
      }
    }
    cx += (FONT_COLS + 1) * scale;
  }
};

// Nearest neighbour, to match the page's `image-rendering: pixelated`.
const drawNearest = (dst, src, dx, dy, dw, dh) => {
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y * src.height / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x * src.width / dw));
      const s = (sy * src.width + sx) * 4;
      const px = dx + x, py = dy + y;
      if (px < 0 || px >= dst.w || py < 0 || py >= dst.h) continue;
      const o = (py * dst.w + px) * 4;
      dst.px[o] = src.data[s]; dst.px[o + 1] = src.data[s + 1];
      dst.px[o + 2] = src.data[s + 2]; dst.px[o + 3] = 255;
    }
  }
};

// ---- arguments ------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const tiles = args.filter(a => a.startsWith('--tile=')).map(a => {
  const spec = a.slice('--tile='.length);
  const cut = spec.lastIndexOf(':');
  if (cut < 0) return { file: spec, label: path.basename(spec, '.png') };
  return { file: spec.slice(0, cut), label: spec.slice(cut + 1) };
});
if (!tiles.length) {
  console.error('usage: node tools/zoom-compare-sheet.js --shape=WxH --tile=FILE:LABEL [...]');
  process.exit(2);
}

const shapeArg = String(getArg('shape', '')).match(/^(\d+)x(\d+)$/);
const cols = Math.max(1, parseInt(getArg('cols', String(tiles.length)), 10) || tiles.length);
const upscale = Math.max(1, parseInt(getArg('scale', '2'), 10) || 2);
const title = getArg('title', '');
const outPath = path.resolve(getArg('out', 'zoom-compare.png'));

const sources = tiles.map(t => {
  const buf = fs.readFileSync(t.file);
  return { ...t, png: PNG.sync.read(buf) };
});
// Absent an explicit --shape, the widest frame's shape is the common one.
const shape = shapeArg
  ? { w: +shapeArg[1], h: +shapeArg[2] }
  : sources.reduce((best, s) => (s.png.width > best.w
    ? { w: s.png.width, h: s.png.height } : best), { w: 1, h: 1 });

// ---- layout ---------------------------------------------------------------
const BG = [0x14, 0x18, 0x1c];
const INK = [0xdc, 0xe6, 0xee];
const PAD = 10;
const LABEL = 2;                         // font scale, pre-upscale
const LABEL_H = FONT_ROWS * LABEL + 6;
const TITLE_H = title ? FONT_ROWS * LABEL + 10 : 0;
const cellW = shape.w + PAD * 2;
const cellH = shape.h + LABEL_H + PAD * 2;
const rows = Math.ceil(sources.length / cols);
const sheet = makeSurface(cols * cellW, TITLE_H + rows * cellH, BG);
if (title) drawText(sheet, title, PAD, 5, LABEL, INK);

sources.forEach((s, i) => {
  const cx = (i % cols) * cellW;
  const cy = TITLE_H + Math.floor(i / cols) * cellH;
  // Fit, not fill: a frame whose aspect differs from the common shape is
  // letterboxed rather than stretched, because a stretched tile would change
  // the very thing the sheet is measuring.
  const k = Math.min(shape.w / s.png.width, shape.h / s.png.height);
  const dw = Math.max(1, Math.round(s.png.width * k));
  const dh = Math.max(1, Math.round(s.png.height * k));
  drawNearest(sheet, s.png, cx + PAD + ((shape.w - dw) >> 1),
    cy + PAD + ((shape.h - dh) >> 1), dw, dh);
  drawText(sheet, s.label, cx + PAD, cy + PAD + shape.h + 4, LABEL, INK);
});

const final = upscale === 1 ? sheet : (() => {
  const big = makeSurface(sheet.w * upscale, sheet.h * upscale, BG);
  drawNearest(big, { width: sheet.w, height: sheet.h, data: sheet.px },
    0, 0, big.w, big.h);
  return big;
})();

const png = new PNG({ width: final.w, height: final.h });
final.px.copy(png.data);
fs.writeFileSync(outPath, PNG.sync.write(png));
console.log(`Wrote ${outPath} (${final.w}x${final.h}, ${sources.length} tiles at ${shape.w}x${shape.h}, `
  + `${upscale}x, ${fs.statSync(outPath).size} bytes)`);

if (args.includes('--open') && process.platform === 'darwin') {
  require('child_process').spawnSync('open', ['-a', 'Preview', outPath]);
}
