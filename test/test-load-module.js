#!/usr/bin/env node
'use strict';

// LoadModule is WinExec's older, lower-level twin, still imported by ports of
// 16-bit code. Two answers matter and they are not the same answer: a module
// that is not on this machine is error 2, below the 32 that separates a
// failure code from an instance handle, and a module that is there goes out
// through the same shell boundary WinExec uses. Pitfall (1997) asks for
// DISPDIB.DLL this way and prints "Bad or missing dispdib.dll - error 2" when
// told no -- a diagnostic it can only produce because the answer is the real
// one Windows gives, rather than a stub claiming success.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_call_LoadModule")
        (param $name i32) (param $block i32) (param $api i32) (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const 0))
    (call $handle_LoadModule
      (local.get $name) (local.get $block) (i32.const 0)
      (i32.const 0) (i32.const 0) (call $g2w (local.get $api)))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_load_module_esp") (result i32)
    (i32.load offset=16 (global.get $reg_base)))
`;

async function main() {
  let memory;
  let present = false;
  let returnCode = 33;
  const launches = [];
  const readString = (ptr) => {
    if (!ptr) return '';
    const bytes = new Uint8Array(memory.buffer);
    let end = ptr;
    while (bytes[end]) end++;
    return Buffer.from(bytes.subarray(ptr, end)).toString('latin1');
  };
  const harness = await bootRenderHarness({
    extraWat,
    fonts: 'none',
    extraHostOverrides: {
      fs_get_file_attributes() { return present ? 0x20 : -1; },
      shell_execute(hwnd, op, file, params, dir, show) {
        launches.push({ op: readString(op), file: readString(file), show });
        return returnCode;
      },
    },
  });
  memory = harness.memory;
  const e = harness.exports;
  const writeString = (value) => {
    const ptr = e.guest_alloc(value.length + 1) >>> 0;
    for (let i = 0; i < value.length; i++) e.guest_write8(ptr + i, value.charCodeAt(i));
    e.guest_write8(ptr + value.length, 0);
    return ptr;
  };

  const name = writeString('\\DISPDIB.DLL');
  const api = writeString('LoadModule');

  // A module this machine does not have.
  assert.strictEqual(e.test_call_LoadModule(name, 0, api), 2,
    'a missing module is ERROR_FILE_NOT_FOUND, not a handle');
  assert.strictEqual(e.test_load_module_esp(), 12,
    'LoadModule pops its two stdcall arguments on the failure path too');
  assert.strictEqual(launches.length, 0,
    'a module that is not there is never handed to the shell');

  // LOADPARMS32 { WORD segEnv; LPSTR lpCmdLine; WORD *lpCmdShow; DWORD }.
  // lpCmdShow points at two words and the show command is the second.
  present = true;
  const showWords = e.guest_alloc(4) >>> 0;
  e.guest_write32(showWords, 0x00070002);
  const block = e.guest_alloc(16) >>> 0;
  e.guest_write32(block, 0);
  e.guest_write32(block + 4, 0);
  e.guest_write32(block + 8, showWords);
  e.guest_write32(block + 12, 0);

  assert.strictEqual(e.test_call_LoadModule(name, block, api), 33,
    'a module that is there returns what the host launch returned');
  assert.deepStrictEqual(launches.pop(), { op: 'LoadModule', file: '\\DISPDIB.DLL', show: 7 },
    'the parameter block supplies nCmdShow through the shared shell boundary');
  assert.strictEqual(e.test_load_module_esp(), 12,
    'and the launch path pops the same two arguments');

  // No block at all is an ordinary window, which is SW_SHOWNORMAL.
  assert.strictEqual(e.test_call_LoadModule(name, 0, api), 33);
  assert.deepStrictEqual(launches.pop(), { op: 'LoadModule', file: '\\DISPDIB.DLL', show: 1 },
    'without a parameter block the module gets an ordinary window');

  // The failure code the host reports must survive, not become a handle.
  returnCode = 11;
  assert.strictEqual(e.test_call_LoadModule(name, 0, api), 11,
    'a host launch failure keeps its documented code');

  console.log('PASS  LoadModule answers 2 for a module this machine lacks and launches one it has');
}

main().catch((error) => {
  console.error((error && error.stack) || error);
  process.exit(1);
});
