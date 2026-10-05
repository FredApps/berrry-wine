#!/usr/bin/env node
// Regression: the visible Find dialog "Find Next" button is clickable through
// normal canvas mouse input, not just the test-only find-click helper.

const fs = require('fs');
const { diffPng } = require('../tools/png-diff');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(__dirname, 'run.js');
const EXE = path.join(__dirname, 'binaries', 'notepad.exe');
const OUT = path.join(ROOT, 'scratch');
const beforePng = path.join(OUT, 'find_next_before_press.png');
const heldPng = path.join(OUT, 'find_next_held_press.png');

if (!fs.existsSync(EXE)) {
  console.log('SKIP  notepad.exe not found at', EXE);
  process.exit(0);
}

const inputSpec = [
  '50:0x111:3',
  '90:focus-find',
  '92:keypress:65',
  `99:png:${beforePng}`,
  '100:mousedown:350:101',
  `101:png:${heldPng}`,
  '120:mouseup:350:101',
  '130:dump-fr',
].join(',');

const cmd = `node "${RUN}" --exe="${EXE}" --input=${inputSpec} --max-batches=140 --quiet-api --no-close`;
console.log('$', cmd);

let out = '';
try {
  out = execSync(cmd, { encoding: 'utf-8', timeout: 180000, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  out = (e.stdout || '').toString() + (e.stderr || '').toString();
  console.log('(run.js exited non-zero - output captured)');
}

async function diffButtonPixels(aPath, bPath) {
  const result = diffPng(aPath, bPath, { includeAlpha: false, metric: 'sum', tolerance: 20,
    region: { x: 310, y: 88, w: 82, h: 26 } });
  if (result.sizeMismatch) throw new Error('Find snapshot dimensions differ');
  return result.changed;
}

for (const l of out.split('\n').filter(l =>
  l.includes('FindTextA') ||
  l.includes('mousedown') ||
  l.includes('mouseup') ||
  l.includes('png') ||
  l.includes('MessageBox') ||
  l.includes('dump-fr') ||
  l.includes('UNIMPLEMENTED') ||
  l.includes('CRASH'))) {
  console.log('  ' + l);
}

(async () => {
  const pressDiff = fs.existsSync(beforePng) && fs.existsSync(heldPng)
    ? await diffButtonPixels(beforePng, heldPng)
    : 0;
  // dump-fr grew dlg=/fr=/size= fields ahead of flags=, which this pattern used
  // to require immediately after the colon -- so it stopped matching and the
  // check below failed on a run whose flags were correct all along. Match the
  // two fields it actually cares about wherever they sit on the line.
  const m = out.match(/dump-fr:.* flags=0x([0-9a-f]+) .*findWhat="A"/);
  const checks = [
    ['Find dialog appeared', out.includes('[FindTextA]')],
    ['mouse down/up was injected', out.includes('mousedown 350,101') && out.includes('mouseup 350,101')],
    [`Find Next visibly depresses while mouse is held (${pressDiff} changed button pixels)`, pressDiff > 80],
    ['Find Next command fired from mouse click', !!m && (parseInt(m[1], 16) & 0x08) !== 0],
    ['search result MessageBox appeared', out.includes('Cannot find "A"')],
    ['no UNIMPLEMENTED', !out.includes('UNIMPLEMENTED')],
    ['no CRASH', !out.includes('CRASH')],
  ];

  let failed = 0;
  for (const [name, pass] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) failed++;
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
