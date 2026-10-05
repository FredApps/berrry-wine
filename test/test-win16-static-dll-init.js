#!/usr/bin/env node
'use strict';

// A DLL an NE task imports statically has its LibEntry run before the task's
// own entry point, dependencies first, exactly as KERNEL's loader does. Only
// the LoadLibrary path used to do that, so a static import started life with
// its DGROUP as the linker left it.
//
// That was harmless for a DLL whose LibMain only returns 1, and fatal for one
// that binds anything: WinG's LibMain fetches GDI's CreateDIBSection with
// GetProcAddress, and without it WinGCreateBitmap fell back to a DDB with no
// bits pointer, which Bad Toys 3D then drew its whole 3-D view through.
//
// WEPUTIL is the corpus DLL whose LibMain is easiest to see from outside: it
// saves its hInstance, asks GetDeviceCaps(NUMCOLORS) to pick its colour or
// monochrome artwork, and registers its IndentBox/OutdentBox/DentedBox classes.
// All of that has to happen before Pipe Dream's InitTask, and Pipe Dream has to
// come out of it with its own registers intact and put up its window.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WEP2 = path.join(ROOT, 'test', 'binaries', 'wep16', 'WEP2');
const PIPE = path.join(WEP2, 'PIPE.EXE');
const WEPUTIL = path.join(WEP2, 'WEPUTIL.DLL');
const OPTIONAL_WASM = process.env.WINE_ASSEMBLY_WASM || '';

if (!fs.existsSync(PIPE) || !fs.existsSync(WEPUTIL)) {
  console.log('SKIP  Pipe Dream / WEPUTIL corpus is not installed');
  process.exit(0);
}

const args = [path.join(ROOT, 'test', 'run.js'), '--app=wep16_pipe',
  '--batch-size=20000', '--max-batches=3', '--quiet-api', '--quiet-blocks',
  '--trace-win16'];
if (OPTIONAL_WASM) args.push('--no-build', `--wasm=${OPTIONAL_WASM}`);

const output = execFileSync(process.execPath, args, {
  cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024,
});
assert.doesNotMatch(output, /\*\*\* CRASH|UNIMPLEMENTED API|RuntimeError/);

const calls = output.split('\n').filter(line => line.startsWith('[win16] ') &&
  /^\[win16\] [A-Z]+\.\d+ /.test(line));
const initTask = calls.findIndex(line => / INITTASK\(/.test(line));
assert(initTask >= 0, 'Pipe Dream reached InitTask');
const before = calls.slice(0, initTask);

assert(before.some(line => /GDI\.80 GETDEVICECAPS\(0x00000018,/.test(line)),
  'WEPUTIL LibMain asked GetDeviceCaps(NUMCOLORS) before the task started');
// The third stack word printed is WNDCLASS.lpfnWndProc's offset: the three
// entry points WEPUTIL exports as ordinals 1101-1103.
for (const proc of ['0x00000789', '0x000007b1', '0x000007d9']) {
  assert(before.some(line => /USER\.57 REGISTERCLASS\(/.test(line) &&
      line.includes(`, ${proc},`)),
    `WEPUTIL registered its class with wndproc ${proc} before InitTask`);
}
console.log('PASS  a static NE import runs its LibEntry before the task entry');

assert.match(output, /\[CreateWindow\] hwnd=0x[0-9a-f]+ title="Pipe Dream"/,
  'Pipe Dream resumed with its own registers and created its main window');
console.log('PASS  the task resumes intact after the DLL initialisers');
