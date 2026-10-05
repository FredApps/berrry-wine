#!/usr/bin/env node
'use strict';

// A DS_SETFONT dialog template names the font its dialog units are measured
// in. USER creates that font, derives the dialog's base units from it
// (width = average of "A..Za..z" rounded half up, height = tmHeight), lays the
// template out in them and hands the font to every control with WM_SETFONT.
//
// We used the stock 8pt MS Sans Serif 6x13 for every Win32 template. SimCity
// 2000's New City dialog (RT_DIALOG 101) asks for MS Sans Serif *10pt*, and
// its year radios are 26 dlu wide: at 6x13 that is 39px, and "1900" clipped
// to "190". The template is ground truth here, so this runs the real demo to
// that dialog and reads the layout the dialog manager produced.
//
//   New City (10pt): radio 1900 at x=102 dlu, 26x10 dlu -> must be laid out
//                    in the measured 10pt units (8x16), 204,50 52x20.
//   Toolbar (8pt):   the negative control. RT_DIALOG 255 names the stock
//                    8pt MS Sans Serif, whose layout must not move:
//                    GoTo at 235,0 50x15 dlu -> 352,0 75x24.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'test', 'binaries', 'candidates',
  'simcity-2000-demo', 'installed', 'simdemo.exe');

if (!fs.existsSync(EXE)) {
  console.log('SKIP  simcity-2000-demo not installed at', EXE);
  process.exit(0);
}

const r = spawnSync(process.execPath, [
  path.join(ROOT, 'test', 'run.js'), '--no-build', '--app=simcity2000_demo',
  '--screen=1024x768', '--tick-ms-per-batch=10', '--max-batches=8100',
  '--no-close', '--quiet-api', '--max-seconds=90',
  // Dismiss the demo notice, then "Start New City" on the launcher.
  '--input=40:dlg-cmd:1,2040:click:215:124',
], { cwd: ROOT, encoding: 'utf8', timeout: 150000, maxBuffer: 256 << 20 });
const out = (r.stdout || '') + (r.stderr || '');

function control(id) {
  const m = out.match(new RegExp(
    `\\[CreateDialog\\]\\s+ctrl hwnd=0x[0-9a-f]+ id=${id} class=\\d+ at (-?\\d+),(-?\\d+) (\\d+)x(\\d+)`));
  assert.ok(m, `no [CreateDialog] line for control id=${id}\n` + out.slice(-2000));
  return m.slice(1).map(Number);
}

// Negative control first: the stock-font dialog keeps the 6x13 layout.
assert.deepStrictEqual(control(120), [352, 0, 75, 24],
  '8pt MS Sans Serif toolbar dialog must stay in 6x13 base units');
console.log('PASS  8pt stock-font template keeps 6x13 layout');

// The 10pt template: every coordinate scales by its own measured units.
const year1900 = control(104);
assert.deepStrictEqual(year1900, [204, 50, 52, 20],
  'New City "1900" radio must be laid out in the 10pt font\'s 8x16 units');
assert.deepStrictEqual(control(1), [126, 128, 42, 28],
  'New City "Done" button must be laid out in the 10pt font\'s 8x16 units');
console.log('PASS  10pt DS_SETFONT template lays out in its own base units');
