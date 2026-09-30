'use strict';

// The µop-only arm (tools/toyvm/uop-only.js) against L1, the oracle: the same
// programs test-toyvm-uop-live.js runs, and for each one every register, all of
// guest RAM, the frame, the text screen and the DISPATCH COUNT must be exactly
// what the interpreter alone leaves. Run in both program shapes (loop nests
// and straight lines), which link to each other differently.
//
// PATCH is the self-modify case here: its loop's immediate is rewritten while
// the program built over it is live, so the program's code bits have to break
// the slice and the session's invalidation has to drop and rebuild it.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runDos } = require('../tools/toyvm/run-dos');
const isa = require('../tools/toyvm/isa');
const { segloads, dshift, shifts, rotcarry, memShifts, wraps } = require('./test-toyvm-uop');
const { patchProgram, sideExitProgram, flagsProgram, muldivProgram } = require('./test-toyvm-uop-live');

// Port reads as µops (uop-ir.js PIN): 20 frames of the retrace wait every demo
// runs, with BX and SI counting the polls of each half -- a count that moves by
// one if the read sees L1's clock one dispatch off -- then a loop with an
// `in ax,dx` in the middle of its arithmetic, where the clock pass has charged
// the block ahead of the read, and an `in al,imm8` of another port.
function retraceProgram() {
  return Buffer.from([
    0xB9, 0x14, 0x00,             // 100 mov cx,20
    0xBA, 0xDA, 0x03,             // 103 outer: mov dx,3DAh
    0xE4, 0x61,                   // 106 in al,61h
    0xEC, 0x43, 0xA8, 0x08, 0x75, 0xFA, // 108 w1: in al,dx / inc bx / test al,8 / jnz w1
    0xEC, 0x46, 0xA8, 0x08, 0x74, 0xFA, // 10E w2: in al,dx / inc si / test al,8 / jz w2
    0xBF, 0xC8, 0x00,             // 114 mov di,200
    0x01, 0xF8, 0xED, 0x31, 0xC5, 0x4F, 0x75, 0xF8, // 117 w3: add ax,di / in ax,dx / xor bp,ax / dec di / jnz w3
    0xE2, 0xE2,                   // 11F loop outer
    0xCD, 0x20,                   // 121 int 20h
  ]);
}

// CMA_SHRT.EXE's bit reader, which a µop program got wrong: a `cmp` whose
// result has even parity, then `shr bp,1` (CF out, PF of the result) and
// `dec dx` (keeps CF, sets PF), then `je` / `jb` -- and whoever reads PF next
// must see the dec's. The program left the cmp's PF in the flags word.
function shrDecProgram() {
  return Buffer.from([
    0xB9, 0x2C, 0x01,             // 100 mov cx,300
    0x31, 0xDB,                   // 103 xor bx,bx
    0xBF, 0x07, 0x00,             // 105 top: mov di,7
    0x83, 0xFF, 0x02,             // 108 cmp di,2        (5: PF=1)
    0xBD, 0x03, 0x00,             // 10B mov bp,3
    0xD1, 0xED,                   // 10E shr bp,1        (CF=1, 1: PF=0)
    0xBA, 0x03, 0x00,             // 110 mov dx,3
    0x4A,                         // 113 dec dx          (2: PF=0, CF kept)
    0x74, 0x09,                   // 114 je  11F
    0x72, 0x01,                   // 116 jb  119
    0x90,                         // 118 nop
    0x0F, 0x9A, 0xC0,             // 119 setpe al
    0x30, 0xE4,                   // 11C xor ah,ah
    0x01, 0xC3,                   // 11E add bx,ax
    0x49,                         // 120 dec cx
    0x75, 0xE2,                   // 121 jnz top
    0xCD, 0x20,                   // 123 int 20h
  ]);
}

// Two stores into two other programs' code, one bail apart: a byte of Z,
// then the imm16 of Y's `mov ax, imm`. The first store's guard fails into
// the reference interpreter and sets $smc; the second is a second bail that
// widens the range -- and uop-ref wrote the range back only when $smc
// changed, so the drop named only Z's byte, Y stood, and it went on returning
// the old immediate. CMA_SHRT.EXE's extender patching the far
// pointer of its real-mode `call far` thunk.
function twoStoreProgram() {
  const b = [];
  const w = (...x) => b.push(...x);
  const at = () => 0x100 + b.length;
  const put16 = (i, v) => { b[i] = v & 0xFF; b[i + 1] = (v >> 8) & 0xFF; };
  const rel = (i, to) => put16(i, to - (0x100 + i + 2));
  w(0xB9, 0x40, 0x00);                     // mov cx,64
  w(0x31, 0xDB);                           // xor bx,bx
  const top = at();
  const aAt = b.length + 2; w(0xC6, 0x06, 0, 0, 0x90);    // mov byte [<Z>],90h (Z's nop, rewritten with itself)
  const bAt = b.length + 2; w(0x89, 0x0E, 0, 0);          // mov [<B>+1],cx
  const cz = b.length + 1; w(0xE8, 0, 0);                 // call Z
  const cy = b.length + 1; w(0xE8, 0, 0);                 // call Y
  w(0x01, 0xC3);                           // add bx,ax
  w(0x49);                                 // dec cx
  w(0x75, (top - (at() + 2)) & 0xFF);      // jnz top
  w(0xCD, 0x20);                           // int 20h
  const z = at();
  w(0x90, 0xC3);                           // Z: nop / ret -- its own program
  while ((at() & 15) !== 0) w(0xCC);       // Y in another paragraph
  const y = at();
  w(0x31, 0xD2);                           // Y: xor dx,dx
  w(0x01, 0xCA);                           //    add dx,cx
  w(0xB8, 0x00, 0x00);                     // B: mov ax,imm16
  w(0x01, 0xD0);                           //    add ax,dx
  w(0xC3);                                 //    ret
  put16(aAt, z); put16(bAt, y + 5); rel(cz, z); rel(cy, y);
  return Buffer.from(b);
}

// Protected-mode entry the way every extender does it: `mov cr0` sets PE and
// the far jump after it reloads CS. Between the two, CS still holds the
// real-mode paragraph, which names no GDT descriptor -- so a handback there
// meets the session's bad-selector guard (dos-loop.js step), and it did:
// uop-only runs `mov cr0` as a one-instruction fallback and handed back after
// it. CMA_SHRT.EXE's extender stopped at 110:db3. Then a loop in protected
// mode (16-bit code, selector 08, base 0) and its sum on the text page.
function pmEntryProgram() {
  const b = [];
  const w = (...x) => b.push(...x);
  const at = () => 0x100 + b.length;
  const put16 = (i, v) => { b[i] = v & 0xFF; b[i + 1] = (v >> 8) & 0xFF; };
  w(0xFA);                                 // cli
  w(0x66, 0x31, 0xC0);                     // xor eax,eax
  w(0x8C, 0xC8);                           // mov ax,cs
  w(0x66, 0xC1, 0xE0, 0x04);               // shl eax,4
  w(0x66, 0x89, 0xC3);                     // mov ebx,eax
  const gdtAdd = b.length + 2; w(0x66, 0x05, 0, 0, 0, 0);   // add eax,<gdt>
  const gdtrSt = b.length + 2; w(0x66, 0xA3, 0, 0);         // mov [<gdtr>+2],eax
  const lgdtAt = b.length + 3; w(0x0F, 0x01, 0x16, 0, 0);   // lgdt [<gdtr>]
  w(0x66, 0x89, 0xD8);                     // mov eax,ebx
  const pmAdd = b.length + 2; w(0x66, 0x05, 0, 0, 0, 0);    // add eax,<pm>
  const fpSt = b.length + 2; w(0x66, 0xA3, 0, 0);           // mov [<fp>],eax
  w(0x0F, 0x20, 0xC0);                     // mov eax,cr0
  w(0x0C, 0x01);                           // or al,1
  w(0x0F, 0x22, 0xC0);                     // mov cr0,eax
  const jmpAt = b.length + 3; w(0x66, 0xFF, 0x2E, 0, 0);    // jmp far dword [<fp>]
  while ((at() & 7) !== 0) w(0x90);
  const gdt = at();
  w(0, 0, 0, 0, 0, 0, 0, 0);
  w(0xFF, 0xFF, 0x00, 0x00, 0x00, 0x9A, 0x8F, 0x00);         // 08: code, base 0, 4GB, D=0
  w(0xFF, 0xFF, 0x00, 0x00, 0x00, 0x92, 0xCF, 0x00);         // 10: data, base 0, 4GB
  const gdtr = at(); w(0x17, 0x00, 0, 0, 0, 0);
  const fp = at(); w(0, 0, 0, 0, 0x08, 0x00);                // dd <pm linear>, dw 08
  const pm = at();
  w(0xB8, 0x10, 0x00);                     // mov ax,10h
  w(0x8E, 0xD8);                           // mov ds,ax
  w(0xB9, 0xE8, 0x03);                     // mov cx,1000
  w(0x31, 0xD2);                           // xor dx,dx
  w(0x01, 0xCA);                           // l: add dx,cx
  w(0x31, 0xCA);                           //    xor dx,cx
  w(0xE2, 0xFA);                           //    loop l
  w(0x66, 0xBF, 0x00, 0x80, 0x0B, 0x00);   // mov edi,0B8000h
  w(0x67, 0x89, 0x17);                     // a32 mov [edi],dx
  w(0xEB, 0xFE);                           // jmp $
  put16(gdtAdd, gdt); put16(gdtrSt, gdtr + 2); put16(lgdtAt, gdtr);
  put16(pmAdd, pm); put16(fpSt, fp); put16(jmpAt, fp);
  return Buffer.from(b);
}

async function run(com, uopOnly, budget = 60e6) {
  const r = await runDos({ exe: com, budget, slice: 5e4, log: () => {}, uopOnly });
  const regs = r.vm.getAll();
  const ram = crypto.createHash('sha256')
    .update(Buffer.from(r.vm.mem.buffer, 0, isa.GUEST_RAM_SIZE)).digest('hex');
  return { ...regs, ram, frame: r.frame, cells: r.text.cells,
    written: r.machine.con.written, dispatched: r.dispatched, uop: r.uop };
}

async function same(name, bytes, shape, budget) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-uop-only-'));
  const com = path.join(dir, `${name}.COM`);
  fs.writeFileSync(com, bytes);
  const off = await run(com, null, budget);
  const on = await run(com, { shape }, budget);
  const u = on.uop;
  assert.ok(u && u.builds >= 1, `${name}: no µop program built`);
  assert.ok(u.uopShare > 0.5, `${name}: only ${(100 * u.uopShare).toFixed(1)}% of steps in µop programs`);
  for (const k of Object.keys(off)) {
    if (k === 'uop') continue;
    assert.strictEqual(on[k], off[k], `${name} (${shape}): ${k} differs from L1: ${on[k]} vs ${off[k]}`);
  }
  console.log(`${name} (${shape}): ok  ${off.dispatched} dispatches, ${(100 * u.uopShare).toFixed(1)}% in µop,`
    + ` programs ${u.builds} chains ${u.chains} fallback ${u.fbEntries} invalidated ${u.invalidated}`);
  return u;
}

async function main() {
  for (const shape of ['loop', 'straight']) {
    const p = await same('PATCH', patchProgram(), shape);
    assert.ok(p.invalidated >= 1, `PATCH (${shape}): no program was dropped when the guest rewrote it`);
    await same('SIDEEXIT', sideExitProgram(), shape);
    await same('FLAGS', flagsProgram(), shape);
    await same('SHRDEC', shrDecProgram(), shape);
    await same('MULDIV', muldivProgram(), shape);
    await same('SEGLOADS', segloads(255).com, shape);
    await same('DSHIFT', dshift(255).com, shape);
    await same('SHIFTS', shifts(40).com, shape);
    await same('ROTCARRY', rotcarry(40).com, shape);
    await same('MEMSHIFTS', memShifts(60).com, shape);
    await same('WRAPS', wraps(250).com, shape);
    const rt = await same('RETRACE', retraceProgram(), shape);
    await same('PMENTRY', pmEntryProgram(), shape, 2e6);
    await same('TWOSTORE', twoStoreProgram(), shape);
    assert.strictEqual(rt.fbEntries, 1, `RETRACE (${shape}): ${rt.fbEntries} fallbacks -- \`in\` should be µops (only int 20h is not)`);
  }
  console.log('test-toyvm-uop-only: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
