#!/usr/bin/env node

'use strict';

// Authentic Windows 98 Paint evidence for WriteFmtUserTypeStg.  Paint's Cut
// path registers "PBrush", writes that user type and registered CLIPFORMAT to
// an IStorage, checks the HRESULT, and commits the same storage before placing
// its delayed-render object on the clipboard.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { compileSrcWasm } = require('./compile-src');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(__dirname, 'run.js');
const EXE = path.join(__dirname, 'binaries', 'mspaint.exe');
const MSPAINT_SHA256 = '03d4b606ed6dfc833f6d67aca4a9a62e8c4b0244083ffdb6cfc2290e3882c452';

if (!fs.existsSync(EXE)) {
  console.log('SKIP  authentic Win98 mspaint.exe not found at', EXE);
  process.exit(0);
}

function peVaToOffset(image, va) {
  const pe = image.readUInt32LE(0x3c);
  assert.strictEqual(image.toString('ascii', pe, pe + 4), 'PE\0\0');
  const sectionCount = image.readUInt16LE(pe + 6);
  const optionalSize = image.readUInt16LE(pe + 20);
  const optional = pe + 24;
  assert.strictEqual(image.readUInt16LE(optional), 0x10b, 'fixture is PE32');
  const imageBase = image.readUInt32LE(optional + 28);
  const rva = (va - imageBase) >>> 0;
  const sections = optional + optionalSize;
  for (let i = 0; i < sectionCount; i++) {
    const section = sections + i * 40;
    const virtualSize = image.readUInt32LE(section + 8);
    const virtualAddress = image.readUInt32LE(section + 12);
    const rawSize = image.readUInt32LE(section + 16);
    const rawOffset = image.readUInt32LE(section + 20);
    const span = Math.max(virtualSize, rawSize);
    if (rva >= virtualAddress && rva < virtualAddress + span) {
      return rawOffset + rva - virtualAddress;
    }
  }
  throw new Error(`VA 0x${va.toString(16)} is outside the PE sections`);
}

function readWide(image, offset) {
  let value = '';
  for (let cursor = offset; cursor + 1 < image.length; cursor += 2) {
    const code = image.readUInt16LE(cursor);
    if (!code) return value;
    value += String.fromCharCode(code);
  }
  throw new Error('unterminated UTF-16 fixture string');
}

const image = fs.readFileSync(EXE);
assert.strictEqual(crypto.createHash('sha256').update(image).digest('hex'), MSPAINT_SHA256,
  'test must use the registered authentic Win98 Paint binary');
assert.strictEqual(readWide(image, peVaToOffset(image, 0x010040f4)), 'PBrush',
  'the LPOLESTR seen in the runtime trace is statically PBrush');
assert.strictEqual(image.toString('ascii', peVaToOffset(image, 0x01004104),
  peVaToOffset(image, 0x01004104) + 7), 'PBrush\0',
  'the registered clipboard-format name is statically PBrush');

const input = [
  '18:click:39:146',
  '19:mousedown:120:140', '20:mousemove:150:160', '21:mouseup:190:190',
  '24:0x111:57642', // Edit > Select All
  '27:0x111:57635', // Edit > Cut
  '32:dump-clipboard:after-cut',
  '33:stop',
].join(',');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-write-fmt-mspaint-'));
const wasm = path.join(temp, 'wine-assembly.wasm');
let output = '';
try {
  fs.writeFileSync(wasm, compileSrcWasm());
  output = execFileSync(process.execPath, [
    RUN,
    `--exe=${EXE}`,
    `--input=${input}`,
    '--max-batches=36',
    '--batch-size=50000',
    '--no-close',
    '--no-build',
    `--wasm=${wasm}`,
    '--quiet-api',
    '--quiet-blocks',
    '--trace-api=WriteFmtUserTypeStg,IStorage_Commit,OleSetClipboard',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 12 * 1024 * 1024 });
} catch (error) {
  output = `${error.stdout || ''}${error.stderr || ''}`;
  console.error(output.split('\n').filter(line =>
    /WriteFmt|IStorage_Commit|OleSetClipboard|dump-clipboard|Error|Runtime|CRASH|STUCK|Stats/.test(line)
  ).slice(-80).join('\n'));
  throw error;
} finally {
  try { fs.unlinkSync(wasm); } catch (_) {}
  try { fs.rmdirSync(temp); } catch (_) {}
}

const write = output.match(
  /WriteFmtUserTypeStg\((0x[0-9a-f]+), (0x[0-9a-f]+), (0x[0-9a-f]+)\)/i);
assert(write, 'Paint Cut reached WriteFmtUserTypeStg');
assert.strictEqual(write[2].toLowerCase(), '0x0000c010',
  'Paint passed its registered PBrush CLIPFORMAT');
assert.strictEqual(write[3].toLowerCase(), '0x010040f4',
  'Paint passed the static UTF-16 PBrush user type');

const commit = output.match(/IStorage_Commit\((0x[0-9a-f]+), (0x[0-9a-f]+)\)/i);
assert(commit, 'Paint committed its OLE storage after WriteFmtUserTypeStg returned');
assert.strictEqual(commit[1].toLowerCase(), write[1].toLowerCase(),
  'WriteFmtUserTypeStg and Commit target the same IStorage');
assert.strictEqual(commit[2].toLowerCase(), '0x00000002',
  'Paint requests an only-if-current storage commit');
assert(output.indexOf(write[0]) < output.indexOf(commit[0]) &&
  output.indexOf(commit[0]) < output.indexOf('OleSetClipboard('),
  'Paint writes metadata, commits it, then publishes the OLE object');

assert(/dump-clipboard after-cut: .*oleObject=0x[1-9a-f][0-9a-f]*/i.test(output),
  'Cut completed and published a live OLE clipboard object');
assert(!/UNIMPLEMENTED API:|RuntimeError|LinkError|CRASH|STUCK/.test(output),
  'the authentic Cut path completed without an emulator failure');

console.log('PASS  Win98 Paint writes and commits registered PBrush \\1CompObj metadata on Cut');
