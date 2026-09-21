'use strict';

// BT/BTS on memory under a 0x67 prefix must address the full 32-bit offset.
//
// The memory forms stepped their byte address with a bare `& 0xFFFF`, so a
// 32-bit effective address was folded into the first 64K of the segment.
// COUNTDWN.EXE's DOS extender returns from its real-mode call helper with
// `bt [esp-0x14],0` on a flat stack at 0x420c8: the carry of the DOS call was
// read from 0x20b4 -- a byte of the extender's own code, bit 0 set -- so every
// INT 31h 0100h (allocate DOS memory) failed. The demo then put its Sound
// Blaster DMA buffer at 0x4000, cleared it over the extender, and died.
//
// The program below puts a set bit at DS:10000h+x and a clear one at DS:x,
// where the folded address would land, and exits with the number of the first
// check that failed, or 42.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RUN = path.join(__dirname, '..', 'tools', 'toyvm', 'run-dos.js');

function build() {
  const b = [];
  const w = (...x) => b.push(...x);
  let check = 0;
  let cell = -1;                           // index of the imm32 low word to patch
  // Exit with this check's number unless the preceding jump was taken.
  const failUnless = (jcc) => { check++; w(jcc, 0x05, 0xB8, check, 0x4C, 0xCD, 0x21); };

  w(0x8C, 0xC8, 0x8E, 0xD8);               // mov ax, cs / mov ds, ax
  w(0x66, 0xBB); cell = b.length; w(0, 0, 1, 0); // mov ebx, 10000h + cell + 14h
  w(0x67, 0xC6, 0x43, 0xEC, 0x01);         // mov byte [ebx-14h], 1

  // 1: bt [ebx-14h], 0 reads the byte at 10000h+cell, not the clear one at cell.
  w(0x67, 0x0F, 0xBA, 0x63, 0xEC, 0x00);   // bt word [ebx-14h], 0
  failUnless(0x72);                        // jc

  // 2: bts [ebx-14h], 1 writes back to the same byte.
  w(0x67, 0x0F, 0xBA, 0x6B, 0xEC, 0x01);   // bts word [ebx-14h], 1
  w(0x67, 0x8A, 0x43, 0xEC);               // mov al, [ebx-14h]
  w(0x3C, 0x03); failUnless(0x74);         // cmp al, 3 / je

  // 3: ...and nothing was written to the folded address.
  w(0xA0); const near = b.length; w(0, 0); // mov al, [cell]
  w(0x3C, 0x00); failUnless(0x74);         // cmp al, 0 / je

  w(0xB8, 42, 0x4C, 0xCD, 0x21);           // mov ax, 4C2Ah / int 21h

  const at = 0x100 + b.length;
  w(0x00);                                 // the cell: bit 0 clear
  const far = at + 0x14;
  b[cell] = far & 0xFF; b[cell + 1] = (far >> 8) & 0xFF;
  b[near] = at & 0xFF; b[near + 1] = (at >> 8) & 0xFF;
  return { bytes: Buffer.from(b), checks: check };
}

const { bytes, checks } = build();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-bt32-'));
const exe = path.join(dir, 'BT32.COM');
fs.writeFileSync(exe, bytes);

const out = execFileSync('node', [RUN, exe, '--dispatches=2m', '--report'],
  { encoding: 'utf8', timeout: 120000 });
fs.rmSync(dir, { recursive: true, force: true });

assert.ok(!/stuck at/.test(out), `the program parked on an instruction the decoder refused:\n${out}`);
const code = /exited=true code=(\d+)/.exec(out);
assert.ok(code, `the program never exited:\n${out}`);
assert.strictEqual(Number(code[1]), 42,
  `check ${code[1]} of ${checks} failed (see the numbered checks in build()):\n${out}`);
console.log(`PASS test-toyvm-bt-addr32: ${checks} checks over bt/bts with a 32-bit address`);
