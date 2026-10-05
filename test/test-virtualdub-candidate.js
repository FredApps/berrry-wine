#!/usr/bin/env node

'use strict';

// Authentic VirtualDub 1.10.4 launch gate. The program initializes AVIFile
// before displaying its first-run welcome and GPL notices; posted commands
// dismiss those real modal loops so the assertion reaches the application
// frame rather than classifying an intentional dialog wait as a startup hang.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { compileSrcWasm } = require('./compile-src');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(__dirname, 'run.js');
const EXE = path.join(__dirname, 'binaries', 'candidates', 'virtualdub', 'VirtualDub.exe');
const SHA256 = 'f196596574a34e86c36ab0d4ed6ffa1dc68ac4abfd3720676ddc16ffd741f949';

if (!fs.existsSync(EXE)) {
  console.log('SKIP VirtualDub candidate: fetch with node tools/fetch-candidate-corpus.js --id=virtualdub');
  process.exit(0);
}

const exeBytes = fs.readFileSync(EXE);
assert.strictEqual(crypto.createHash('sha256').update(exeBytes).digest('hex'), SHA256,
  'VirtualDub 1.10.4 fixture identity changed');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-virtualdub-vfw-'));
const wasmPath = path.join(temp, 'virtualdub-vfw.wasm');
try {
  const wasm = compileSrcWasm();
  fs.writeFileSync(wasmPath, wasm);
  const result = spawnSync(process.execPath, [
    RUN,
    `--exe=${EXE}`,
    `--wasm=${wasmPath}`,
    '--no-build',
    '--no-close',
    '--quiet-api',
    '--quiet-blocks',
    '--trace-api=AVIFileInit,AVIFileExit',
    '--trace-sched=1',
    '--batch-size=25000',
    '--max-batches=80',
    '--max-seconds=20',
    '--input=30:dlg-post-cmd:1,45:dlg-post-cmd:2',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  const output = `${result.stdout || ''}${result.stderr || ''}`;

  assert.strictEqual(result.status, 0, output.slice(-8000));
  assert(!/UNIMPLEMENTED API:|\*\*\* CRASH|RuntimeError|LinkError/i.test(output),
    `VirtualDub hit a compatibility failure:\n${output.slice(-8000)}`);
  assert(/AVIFileInit\(\)/.test(output),
    'VirtualDub did not initialize the AVIFile library with the zero-argument ABI');
  assert(/\[CreateDialog\].*size=300x153dlu/.test(output) &&
    /dlg-post-cmd: cmd=1 .*queued=1/.test(output),
  'VirtualDub welcome dialog did not complete through its posted Start command');
  assert(/\[CreateDialog\].*size=420x250dlu/.test(output) &&
    /dlg-post-cmd: cmd=2 .*queued=1/.test(output),
  'VirtualDub GPL dialog did not complete through its posted OK command');
  assert(/\[SetWindowText\] "VirtualDub 1\.10\.4 \(build 35491\/release\) by Avery Lee"/.test(output),
    'VirtualDub did not create and title its normal application frame');
  assert(/M:msgwait@0x[0-9a-f]+/.test(output),
    'VirtualDub did not settle into its normal message wait');
  assert(/Stats: 4\d{3} API calls/.test(output),
    'VirtualDub did not sustain its full first-run startup path');

  console.log('PASS  authentic VirtualDub initializes AVIFile, clears both notices, and reaches its main frame');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
