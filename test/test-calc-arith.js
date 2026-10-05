#!/usr/bin/env node
// Calculator arithmetic regression. Drives 1 + 2 = via mouse clicks at the
// standard-view button screen coordinates, then asserts that the display
// area changed between the initial "0." snapshot and the post-calculation
// snapshot (i.e. calc actually evaluated something).
//
// Button screen coords (window pos=40,0, client at +43,+41; children are
// client-relative; standard view):
//   '1' = (115, 204)   '2' = (154, 204)
//   '+' = (232, 239)   '=' = (271, 239)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { diffPng, readPng } = require('../tools/png-diff');

const ROOT = path.join(__dirname, '..');
const RUN  = path.join(__dirname, 'run.js');
const EXE  = path.join(__dirname, 'binaries', 'calc.exe');

if (!fs.existsSync(EXE)) { console.log('SKIP  calc.exe missing'); process.exit(0); }

const OUT = path.join(ROOT, 'scratch');
fs.mkdirSync(OUT, { recursive: true });
const pngBefore = path.join(OUT, 'calc_arith_before.png');
const pngAfter  = path.join(OUT, 'calc_arith_after.png');

// Calc only polls input infrequently (most GetMessage iterations are
// consumed by NC_FLAGS / paint queue), so spread clicks ~100 batches apart
// and snapshot near the end after another long settle.
const click = (b, x, y) => [`${b}:mousedown:${x}:${y}`, `${b+3}:mouseup:${x}:${y}`];
const inputSpec = [
  `50:png:${pngBefore}`,
  ...click(100, 115, 204),  // '1'
  ...click(200, 232, 239),  // '+'
  ...click(300, 154, 204),  // '2'
  ...click(400, 271, 239),  // '='
  `495:png:${pngAfter}`,
].join(',');

const cmd = `node "${RUN}" --exe="${EXE}" --input=${inputSpec} --max-batches=500 --batch-size=50000 --no-close`;
console.log('$', cmd);

let out = '';
try {
  out = execSync(cmd, { encoding: 'utf-8', timeout: 120000, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  out = (e.stdout || '').toString() + (e.stderr || '').toString();
  console.log('(run.js exited non-zero — output captured)');
}

// The 7-segment-style display sits in the top-right of the dialog client
// area. Standard view: client at (43,41), w=256 h=211. The number text is
// right-aligned in a static at roughly y=51..67 within a wide rect that ends
// near client x=256-10. We probe a generous slab covering the right half of
// the display row, which is where '0.' / '3.' renders.
const DISPLAY_REGION = { x: 43 + 100, y: 41, w: 156, h: 22 };

(async () => {
  const checks = [];
  const exists = (p) => fs.existsSync(p) && fs.statSync(p).size > 0;
  const haveB = exists(pngBefore), haveA = exists(pngAfter);
  checks.push({ name: 'before PNG written', pass: haveB });
  checks.push({ name: 'after PNG written',  pass: haveA });
  checks.push({ name: 'no UNIMPLEMENTED API crash', pass: !/UNIMPLEMENTED API:/.test(out) });

  let nDiff = -1;
  if (haveB && haveA) {
    const diff = diffPng(readPng(pngBefore), readPng(pngAfter),
      { region: DISPLAY_REGION, includeAlpha: false });
    checks.push({ name: 'snapshot dimensions match', pass: !diff.sizeMismatch });
    nDiff = diff.changed;
  }
  // '0.' → '3.' dirties 8 pixels: the two glyphs share their whole outer
  // outline and differ only where 0's left column is and 3's middle bar is.
  // The threshold used to be 10, which failed a calculator that was adding
  // correctly -- 0 still means the clicks never landed, which is the thing
  // worth catching. (Dump the digit cell with tools/png-window.js if this
  // ever gets ambiguous.)
  checks.push({ name: `display changed after 1+2= (>=5 px, got ${nDiff})`, pass: nDiff >= 5 });

  console.log('');
  let failed = 0;
  for (const c of checks) {
    console.log((c.pass ? 'PASS  ' : 'FAIL  ') + c.name);
    if (!c.pass) failed++;
  }
  console.log('');
  console.log(`${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
})();
