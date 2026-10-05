#!/usr/bin/env node

'use strict';

// Authentic classic Media Player evidence for RegisterDeviceNotificationW.
// The binary registers its main window for KSCATEGORY_AUDIO changes during
// startup and immediately checks the returned HDEVNOTIFY.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { compileSrcWasm } = require('./compile-src');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(__dirname, 'run.js');
const EXE = path.join(__dirname, 'binaries', 'win98-apps', 'mplay32.exe');
const MSVCRT = path.join(__dirname, 'binaries', 'dlls', 'msvcrt.dll');
const MPLAY32_SHA256 = 'c229b5af9f5bb641654dc0ebe6bbd0a66f215fd97ae50ae0a748cb5a2cf2e040';

for (const file of [EXE, MSVCRT]) {
  if (!fs.existsSync(file)) {
    console.log('SKIP  authentic Media Player fixture missing:', file);
    process.exit(0);
  }
}

const image = fs.readFileSync(EXE);
assert.strictEqual(
  crypto.createHash('sha256').update(image).digest('hex'),
  MPLAY32_SHA256,
  'test must use the audited authentic Media Player binary');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-mplay32-devnotify-'));
const wasm = path.join(temp, 'wine-assembly.wasm');
let output = '';
try {
  fs.writeFileSync(wasm, compileSrcWasm());
  output = execFileSync(process.execPath, [
    RUN,
    `--exe=${EXE}`,
    `--dlls=${MSVCRT}`,
    '--max-batches=8',
    '--batch-size=50000',
    '--max-seconds=5',
    '--no-close',
    '--no-build',
    `--wasm=${wasm}`,
    '--quiet-api',
    '--quiet-blocks',
    '--trace-api=RegisterDeviceNotificationW',
    '--trace-at=0x0100fbdf',
    '--trace-at-dump=0x080ffca8:32',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
} catch (error) {
  output = `${error.stdout || ''}${error.stderr || ''}`;
  console.error(output.split('\n').filter(line =>
    /RegisterDeviceNotification|TRACE-AT|080ffca8|Error|Runtime|CRASH|STUCK/.test(line)
  ).slice(-80).join('\n'));
  throw error;
} finally {
  try { fs.unlinkSync(wasm); } catch (_) {}
  try { fs.rmdirSync(temp); } catch (_) {}
}

assert(
  /RegisterDeviceNotificationW\(0x00010001, 0x080ffca8, 0x00000000\).*ret=0x0100fbdf/i.test(output),
  'Media Player registers its live main HWND with DEVICE_NOTIFY_WINDOW_HANDLE');
assert(
  /TRACE-AT[^\n]*EIP=0x0100fbdf EAX=0xfd[0-9a-f]{6}/i.test(output),
  'the authentic caller receives a non-NULL generation-tagged HDEVNOTIFY');
assert(
  /0x080ffca8\s+20 00 00 00 05 00 00 00 00 00 00 00 04 ad 94 69/i.test(output) &&
  /0x080ffcb8\s+ef 93 d0 11 a3 cc 00 a0 c9 22 31 96/i.test(output),
  'runtime filter is a 32-byte DEV_BROADCAST_DEVICEINTERFACE_W for KSCATEGORY_AUDIO');
assert(!/UNIMPLEMENTED API:|RuntimeError|LinkError|\*\*\* CRASH|STUCK at EIP/.test(output),
  'Media Player startup continues without an emulator failure');

console.log('PASS  authentic Media Player receives an owned KSCATEGORY_AUDIO HDEVNOTIFY');
