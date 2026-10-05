#!/usr/bin/env node
'use strict';

// --fault-null=raise: hand an unmapped guest access to the guest's own __except,
// instead of absorbing it into the NULL sentinel.
//
// The sentinel is what keeps a program that dereferences NULL running at all --
// reads answer 0, writes go nowhere -- and that is the right default, because a
// great many guests probe addresses they know may be unmapped. The cost is that
// a genuine wild pointer surfaces an arbitrary distance from whatever made it.
// Black & White 2 is the worst case measured: 0x9e17d0 walks a circular edge
// list until it returns to the node it started from, so a NULL `next` makes the
// walk read 0 forever, never reach its start, and allocate per visited node
// until the heap refuses 430MB. On real hardware that is an access violation on
// the first iteration.
//
// So the behaviour is a mode, not a change: mode 0 still absorbs, mode 3 raises
// EXCEPTION_ACCESS_VIOLATION at the faulting instruction. This test pins both,
// and pins the thing that is easy to get wrong in between -- the block that
// faulted must be *abandoned*, not resumed. $next parks $ip in $resume_ip when
// its quantum expires and $run honours $resume_ip ahead of $eip, so without
// $eip_redirected the op after the faulting one sends control back into the
// dead block instead of into the handler.
//
// Run: node test/test-fault-null-raise.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createHostImports } = require(path.join(__dirname, '..', 'lib/host-imports'));
const RegionMap = require('../lib/region-map.generated.js');

// An address no mapping covers: above the PE image, below the DIB window, and
// never handed out by VirtualAlloc in a run that makes no calls.
const UNMAPPED = 0x7ff00000;

async function main() {
  const ROOT = path.join(__dirname, '..');
  const WASM_PATH = process.env.WINE_ASSEMBLY_WASM || path.join(ROOT, 'build', 'wine-assembly.wasm');
  const wasmBytes = fs.readFileSync(WASM_PATH);
  const exeBytes = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { exports: null, getMemory: () => memory.buffer };
  const h = createHostImports(ctx).host;
  h.memory = memory;
  h.exit = () => {};
  h.log = () => {};
  h.log_i32 = () => {};
  h.crash_unimplemented = () => {};
  // Count the faults the miss path reports, so "mode 3 raised" cannot be
  // confused with "mode 3 never saw the access".
  let faults = 0;
  h.unmapped_trace = () => { faults++; };

  const { instance } = await WebAssembly.instantiate(wasmBytes, { host: h });
  ctx.exports = instance.exports;
  const e = instance.exports;
  const dv = new DataView(e.memory.buffer);
  const mem = new Uint8Array(e.memory.buffer);
  mem.set(exeBytes, e.get_staging());
  e.load_pe(exeBytes.length);

  const imageBase = e.get_image_base();
  const g2w = a => RegionMap.g2w(a, imageBase);
  const le32 = v => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  const put = (addr, bytes) => mem.set(bytes, g2w(addr));
  const poke = (addr, v) => dv.setUint32(g2w(addr), v >>> 0, true);
  const peek = addr => dv.getUint32(g2w(addr), true) >>> 0;

  const SCRATCH = imageBase + 0x2000;   // marker, SEH record, scopetable
  const CODE = imageBase + 0x3000;      // the faulting block
  const FILTER = imageBase + 0x3100;    // __except filter stub
  const BODY = imageBase + 0x3200;      // __except body
  const HANDLER = imageBase + 0x3300;   // the frame's registered handler
  const MARKER = SCRATCH;
  const SEH_REC = SCRATCH + 0x40;
  const SCOPETABLE = SCRATCH + 0x80;
  const STACK_TOP = imageBase + 0xd00000;

  // The faulting block: read an unmapped address, then a store that proves
  // whether execution carried on past the fault.
  //   A1 <abs32>            mov eax, [UNMAPPED]
  //   C7 05 <marker> 07..   mov dword [MARKER], 7
  //   C3                    ret
  put(CODE, [
    0xa1, ...le32(UNMAPPED),
    0xc7, 0x05, ...le32(MARKER), ...le32(7),
    0xc3,
  ]);

  // A filter $raise_exception recognises as the trivial "return
  // EXCEPTION_EXECUTE_HANDLER" stub: mov eax,1 / ret.
  put(FILTER, [0xb8, ...le32(1), 0xc3]);

  // The __except body. It lands with ESP = seh_rec, whose first dword is the
  // end-of-chain marker and is no kind of return address, so the body puts the
  // stack back before returning to the harness's 0 sentinel.
  //   C7 05 <marker> 01..   mov dword [MARKER], 1
  //   BC <stackTop>         mov esp, STACK_TOP
  //   C3                    ret
  put(BODY, [
    0xc7, 0x05, ...le32(MARKER), ...le32(1),
    0xbc, ...le32(STACK_TOP),
    0xc3,
  ]);

  // Any first byte but 0xB8, which would mark it a C++ __ehhandler stub and
  // make the walk skip it for a hardware exception.
  put(HANDLER, [0x55, 0xc3]);

  function arm() {
    // __except_handler3 frame: EBP = seh_rec + 0x10, scopetable at EBP-8,
    // trylevel at EBP-4.
    poke(SEH_REC + 0x00, 0xffffffff);   // next: end of chain
    poke(SEH_REC + 0x04, HANDLER);
    poke(SEH_REC + 0x08, SCOPETABLE);   // EBP-8
    poke(SEH_REC + 0x0c, 0);            // EBP-4: trylevel 0
    poke(SCOPETABLE + 0x00, 0xffffffff); // enclosingLevel
    poke(SCOPETABLE + 0x04, FILTER);
    poke(SCOPETABLE + 0x08, BODY);
    e.set_fs_base(SEH_REC + 0x100);     // FS:[0] holds the chain head
    poke(SEH_REC + 0x100, SEH_REC);
    poke(MARKER, 0);
    e.set_eax(0xcafef00d);
    e.set_esp(STACK_TOP);
    poke(STACK_TOP, 0);                 // return to EIP 0 = clean halt
    e.set_eip(CODE);
  }

  // --- mode 0: the shipping behaviour, unchanged -------------------------
  e.set_fault_unmapped(0);
  arm();
  e.run(100000);
  assert.strictEqual(peek(MARKER), 7,
    'with the sentinel armed the faulting block must run to completion');
  assert.strictEqual(e.get_eax() >>> 0, 0,
    'the sentinel answers an unmapped read with 0');

  // --- mode 3: raise, and let the guest handle it ------------------------
  faults = 0;
  e.set_fault_unmapped(3);
  arm();
  e.run(100000);
  assert.ok(faults > 0, 'mode 3 must still report the fault it raised on');
  assert.strictEqual(peek(MARKER), 1,
    `the guest's own __except body must run (marker=${peek(MARKER)}; `
    + '7 means the faulting block carried on, 0 means nothing handled it)');

  // --- mode 3 stays opt-in ------------------------------------------------
  e.set_fault_unmapped(0);
  arm();
  e.run(100000);
  assert.strictEqual(peek(MARKER), 7,
    'turning the mode back off must restore the sentinel, not leave the raise armed');

  console.log('PASS --fault-null=raise delivers EXCEPTION_ACCESS_VIOLATION to the guest '
    + 'and abandons the faulting block; mode 0 still absorbs it');
}

main().catch(err => { console.error(err); process.exit(1); });
