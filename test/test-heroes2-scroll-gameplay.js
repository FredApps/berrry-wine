#!/usr/bin/env node
// Heroes II briefly composes a 447x480 map-only image during automatic scroll.
// The scanout must retain a complete frame until the wooden sidebar returns.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PNG } = require('pngjs');

const root = path.join(__dirname, '..');
const exe = path.join(root, 'test/binaries/candidates/heroes-2-demo/files/H2DEMOW.EXE');
if (!fs.existsSync(exe)) { console.log('SKIP  Heroes II demo missing'); process.exit(0); }

const input = [
  '400:click:535:225', '700:click:528:68', '1200:click:283:373',
  '1700:click:508:193', '1725:click:425:85', '1745:click:610:379',
  '1755:click:238:239', '1795:click:421:81', '1810:click:146:165',
  '1820:mousemove:410:220', '1830:mousemove:2:240',
  '1845:click:510:190', '1910:click:610:380', '1990:click:308:226',
  '2005:mousemove:430:230', '2009:click:430:230', '2017:click:242:239',
].join(',');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heroes2-scroll-'));
function capture(batch) {
  const out = path.join(dir, `${batch}.png`);
  execFileSync(process.execPath, [path.join(root, 'test/run.js'),
    '--app=heroes2_demo', '--batch-size=20000', `--max-batches=${batch}`,
    '--max-seconds=75', '--repaint-every=50', '--quiet-api',
    `--input=${input}`, '--png-canvas', `--png=${out}`],
  { cwd: root, timeout: 90000, stdio: 'pipe' });
  return PNG.sync.read(fs.readFileSync(out));
}
function pixel(png, x, y) {
  const i = (y * png.width + x) * 4;
  return Array.from(png.data.subarray(i, i + 3));
}

try {
  const intermediate = capture(2200);
  const completed = capture(3000);
  assert.deepStrictEqual([intermediate.width, intermediate.height], [640, 480]);
  assert.deepStrictEqual(pixel(intermediate, 600, 400), [124, 68, 28],
    'automatic scroll exposed a map-only image instead of the wooden sidebar');
  assert.deepStrictEqual(pixel(completed, 600, 400), [124, 68, 28],
    'the completed frame lost its sidebar');
  assert.notDeepStrictEqual(pixel(intermediate, 300, 250), pixel(completed, 300, 250),
    'the scanout stayed frozen after automatic scroll completed');
  console.log('PASS  Heroes II keeps its full frame during automatic scroll and resumes updates');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
