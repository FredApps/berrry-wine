'use strict';

// LSS, and the 32-bit forms of every far-pointer load (LES/LDS/LSS/LFS/LGS).
//
// LSS (0F B2) was the one member of the family the decoder refused, and a
// refused instruction is not a fault: the block compiles to nothing, the guest
// re-enters it every handback, and the run parks there until the stuck detector
// names the address. CLX's DOPE.EXE exits through `cs: lss sp,[0x226]` and sat
// at 1fb:3fd for the rest of every sweep with its GUS music still playing.
//
// The 32-bit forms were decoded but executed as the 16-bit form: a word offset
// and the selector at +2. The real instruction takes a dword offset and the
// selector at +4 -- `lss esp,[m]` is how a 32-bit program switches stacks -- so
// the old handler would have loaded ESP=0x5670, SS=0x0001 from the pointer
// below instead of ESP=0x15670, SS=0x3000.
//
// The program checks each load and exits with the number of the first check
// that failed, or 42 if all of them held.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RUN = path.join(__dirname, '..', 'tools', 'toyvm', 'run-dos.js');

function build() {
  const b = [];
  const w = (...x) => b.push(...x);
  const fix = [];                          // [index into b, data label]
  const lo = (v) => v & 0xFF, hi = (v) => (v >> 8) & 0xFF;
  const mem = (label) => { fix.push([b.length, label]); w(0, 0); };
  let check = 0;
  // je past the exit; otherwise exit with this check's number.
  const failUnlessEqual = () => { check++; w(0x74, 0x05, 0xB8, check, 0x4C, 0xCD, 0x21); };

  w(0xFA);                                 // cli
  w(0x89, 0x26); mem('orig');              // mov [orig], sp
  w(0x8C, 0x16); mem('orig2');             // mov [orig+2], ss

  // 1-2: lss sp,[p16] -- the 16-bit form DOPE.EXE uses, with a CS override.
  w(0x2E, 0x0F, 0xB2, 0x26); mem('p16');   // cs: lss sp, [p16]
  w(0x8C, 0xD0);                           // mov ax, ss
  w(0x3D, 0x00, 0x20); failUnlessEqual();  // cmp ax, 2000h
  w(0x81, 0xFC, 0x30, 0x12); failUnlessEqual(); // cmp sp, 1230h

  // 3-4: lss esp,[p32] -- dword offset, selector at +4.
  w(0x66, 0x0F, 0xB2, 0x26); mem('p32');   // lss esp, [p32]
  w(0x8C, 0xD0);                           // mov ax, ss
  w(0x3D, 0x00, 0x30); failUnlessEqual();  // cmp ax, 3000h
  w(0x66, 0x81, 0xFC, 0x70, 0x56, 0x01, 0x00); failUnlessEqual(); // cmp esp, 15670h

  // 5-6: les edi,[p32]
  w(0x66, 0xC4, 0x3E); mem('p32');         // les edi, [p32]
  w(0x8C, 0xC0);                           // mov ax, es
  w(0x3D, 0x00, 0x30); failUnlessEqual();  // cmp ax, 3000h
  w(0x66, 0x81, 0xFF, 0x70, 0x56, 0x01, 0x00); failUnlessEqual(); // cmp edi, 15670h

  // 7-8: lfs ebx,[p32]
  w(0x66, 0x0F, 0xB4, 0x1E); mem('p32');   // lfs ebx, [p32]
  w(0x8C, 0xE0);                           // mov ax, fs
  w(0x3D, 0x00, 0x30); failUnlessEqual();  // cmp ax, 3000h
  w(0x66, 0x81, 0xFB, 0x70, 0x56, 0x01, 0x00); failUnlessEqual(); // cmp ebx, 15670h

  // 9-10: les di,[p16] -- the 16-bit form is unchanged.
  w(0xC4, 0x3E); mem('p16');               // les di, [p16]
  w(0x8C, 0xC0);                           // mov ax, es
  w(0x3D, 0x00, 0x20); failUnlessEqual();  // cmp ax, 2000h
  w(0x81, 0xFF, 0x30, 0x12); failUnlessEqual(); // cmp di, 1230h

  // Put the program's own stack back, then exit 42.
  w(0x0F, 0xB2, 0x26); mem('orig');        // lss sp, [orig]
  w(0xFB);                                 // sti
  w(0xB8, 42, 0x4C, 0xCD, 0x21);           // mov ax, 4C2Ah / int 21h

  const labels = {};
  labels.p16 = 0x100 + b.length; w(0x30, 0x12, 0x00, 0x20);             // 2000:1230
  labels.p32 = 0x100 + b.length; w(0x70, 0x56, 0x01, 0x00, 0x00, 0x30); // 3000:00015670
  labels.orig = 0x100 + b.length; w(0, 0, 0, 0);
  labels.orig2 = labels.orig + 2;
  for (const [i, label] of fix) { b[i] = lo(labels[label]); b[i + 1] = hi(labels[label]); }
  return { bytes: Buffer.from(b), checks: check };
}

const { bytes, checks } = build();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-lss-'));
const exe = path.join(dir, 'FARPTR.COM');
fs.writeFileSync(exe, bytes);

const out = execFileSync('node', [RUN, exe, '--dispatches=2m', '--report'],
  { encoding: 'utf8', timeout: 120000 });
fs.rmSync(dir, { recursive: true, force: true });

assert.ok(!/stuck at/.test(out), `the program parked on an instruction the decoder refused:\n${out}`);
const code = /exited=true code=(\d+)/.exec(out);
assert.ok(code, `the program never exited:\n${out}`);
assert.strictEqual(Number(code[1]), 42,
  `check ${code[1]} of ${checks} failed (see the numbered checks in build()):\n${out}`);
console.log(`PASS test-toyvm-far-pointer-loads: ${checks} checks over lss/les/lfs, 16- and 32-bit`);
