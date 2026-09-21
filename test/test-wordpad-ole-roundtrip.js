#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(__dirname, 'run.js');
const EXE = path.join(__dirname, 'binaries', 'win98-apps', 'wordpad.exe');
const OUT = path.join(ROOT, 'test', 'output', 'wordpad-richedit');
const SAVE_NAME = 'wordpad-ole-roundtrip.rtf';
const SAVED = path.join(OUT, SAVE_NAME);
const RESAVE_NAME = 'wordpad-ole-reopened.rtf';
const RESAVED = path.join(OUT, RESAVE_NAME);
const REOPEN_PNG = path.join(OUT, 'wordpad-ole-reopened.png');
const ID_EDIT_COPY = 57634;
const ID_EDIT_PASTE = 57637;

if (!fs.existsSync(EXE)) {
  console.log('SKIP  wordpad.exe not found at', EXE);
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });
for (const file of [SAVED, RESAVED, REOPEN_PNG]) {
  try { fs.unlinkSync(file); } catch (_) {}
}

function runWordPad(seq, maxBatches) {
  const args = [
    RUN,
    `--exe=${EXE}`,
    `--input=${seq.join(',')}`,
    `--max-batches=${maxBatches}`,
    '--batch-size=50000',
    '--quiet-api',
    '--quiet-blocks',
    '--no-close',
  ];
  try {
    return execFileSync('node', args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    return String(error.stdout || '') + String(error.stderr || '');
  }
}

const saveSeq = ['70:click:40:150'];
let batch = 74;
for (const ch of 'before ') saveSeq.push(`${batch++}:keypress:${ch.charCodeAt(0)}`);
saveSeq.push('90:seed-cf-dib:paste');
saveSeq.push('125:dump-focus-text:after-paste');
saveSeq.push('135:set-focus-selection:7:8:select-object');
saveSeq.push(`145:menu-edit-command:${ID_EDIT_COPY}:copy-object`);
saveSeq.push('165:set-focus-selection:8:8:append-object');
saveSeq.push(`175:menu-edit-command:${ID_EDIT_PASTE}:paste-object`);
saveSeq.push('215:dump-focus-unicode:before-save');
saveSeq.push('230:0x111:57604'); // File > Save As
saveSeq.push(`285:open-dlg-pick:${SAVE_NAME}`);
saveSeq.push(`390:vfs-export:${SAVE_NAME}:${SAVED}`);
saveSeq.push('410:stop');
const saveOutput = runWordPad(saveSeq, 440);

const reopenOutput = fs.existsSync(SAVED) ? runWordPad([
  `60:vfs-import:${SAVE_NAME}:${SAVED}`,
  '80:0x111:57601',
  `130:open-dlg-pick:${SAVE_NAME}`,
  '220:dump-focus-unicode:after-reopen',
  `225:png-pixels:${REOPEN_PNG}`,
  '240:0x111:57604',
  `295:open-dlg-pick:${RESAVE_NAME}`,
  `400:vfs-export:${RESAVE_NAME}:${RESAVED}`,
  '420:stop',
], 450) : '';
const output = saveOutput + '\n' + reopenOutput;

for (const line of output.split('\n')) {
  if (/seed-cf-dib|set-focus-selection|menu-edit-command|dump-focus-(?:text|unicode)|open-dlg-pick|vfs-(?:export|import)|png-pixels|Program exited|CRASH|UNIMPLEMENTED/.test(line)) {
    console.log('  ' + line);
  }
}

const saved = fs.existsSync(SAVED) ? fs.readFileSync(SAVED) : Buffer.alloc(0);
const savedText = saved.toString('latin1');
function extractWmfPresentations(rtf) {
  const presentations = [];
  const pict = /\\pict\\wmetafile8[^\r\n]*\r?\n([0-9a-f\r\n]+)\}/gi;
  for (const match of rtf.matchAll(pict)) {
    presentations.push(Buffer.from(match[1].replace(/\s/g, ''), 'hex'));
  }
  return presentations;
}

function validDibWmf(wmf) {
  if (wmf.length < 18 || wmf.readUInt16LE(0) !== 1 ||
      wmf.readUInt16LE(2) !== 9 || wmf.readUInt16LE(4) !== 0x300 ||
      wmf.readUInt32LE(6) * 2 !== wmf.length) return false;
  let offset = 18;
  let stretchDib = 0;
  let sawEof = false;
  while (offset + 6 <= wmf.length) {
    const words = wmf.readUInt32LE(offset);
    const bytes = words * 2;
    if (words < 3 || offset + bytes > wmf.length) return false;
    const fn = wmf.readUInt16LE(offset + 4);
    if (fn === 0x0f43) {
      const dib = offset + 28;
      if (dib + 12 > offset + bytes || wmf.readUInt32LE(dib) !== 40 ||
          wmf.readInt32LE(dib + 4) !== 32 || wmf.readInt32LE(dib + 8) !== 24) return false;
      stretchDib++;
    }
    offset += bytes;
    if (fn === 0) { sawEof = true; break; }
  }
  return sawEof && offset === wmf.length && stretchDib === 1;
}

const presentations = extractWmfPresentations(savedText);
const resavedText = fs.existsSync(RESAVED) ? fs.readFileSync(RESAVED).toString('latin1') : '';
const reopenedPresentations = extractWmfPresentations(resavedText);
let redPixels = 0, bluePixels = 0;
if (fs.existsSync(REOPEN_PNG)) {
  const png = PNG.sync.read(fs.readFileSync(REOPEN_PNG));
  // Fixed fixture window: exclude caption/toolbars, whose blue pixels are
  // not evidence that a document picture rendered.
  for (let y = 132; y < Math.min(275, png.height); y++) {
    for (let x = 8; x < Math.min(392, png.width); x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (r > 180 && g < 100 && b < 100) redPixels++;
      if (b > 180 && r < 100 && g < 100) bluePixels++;
    }
  }
}
console.log(`  reopened bitmap pixels: red=${redPixels} blue=${bluePixels}`);

const escapedName = SAVE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const checks = [
  ['CF_DIB paste was queued into focused RichEdit', /seed-cf-dib paste: .*owned=0x[1-9a-f][0-9a-f]* queued=1/.test(saveOutput)],
  ['native RichEdit inserted one object position before save', /dump-focus-text after-paste: .*len=8 text="before  "/.test(saveOutput)],
  ['Copy/Paste created two native objects before save', /dump-focus-unicode before-save: .*U\+FFFC,U\+FFFC/.test(saveOutput)],
  ['Save As accepted the RTF filename', new RegExp(`open-dlg-pick: ${escapedName}`).test(saveOutput)],
  ['saved file was exported from VFS', saved.length > 0],
  ['saved document is RTF', /^\{\\rtf/i.test(savedText)],
  ['saved RTF contains two WMF presentations', presentations.length === 2],
  ['both WMFs contain a complete 32 by 24 StretchDIB record',
    presentations.length === 2 && presentations.every(validDibWmf)],
  ['fresh WordPad reopens both object positions',
    /dump-focus-unicode after-reopen: .*U\+FFFC,U\+FFFC/.test(reopenOutput)],
  ['reopened document saves both complete pictures again',
    reopenedPresentations.length === 2 && reopenedPresentations.every(validDibWmf)],
  ['reopened document renders the red and blue bitmap cells', redPixels > 200 && bluePixels > 200],
  ['no runtime or unimplemented crash', !/CRASH|UNIMPLEMENTED API:|Unreachable code/.test(output)],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
