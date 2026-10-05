'use strict';

// A store into an operand of cached code is repaired in place, not recompiled.
//
// CYBOMAN2's span filler rewrites the imm32 slopes and imm16 counts of its
// inner loop per span, and CYCLE's mixer ISR advances a sample pointer that
// lives in a `mov bl,[bx+disp16]` displacement -- at ~17.7kHz. Each store
// used to be a self-modify break that dropped the program and compiled it
// again (~12us), and the volatile fallback (test-toyvm-volatile.js) only
// trades that for an uncached compile per entry. dos-loop.js now decodes the
// instructions the store touched, checks that they still lower to the words
// the arena holds up to their operand words, and rewrites just those words
// (CodeCache.repairOperands).
//
// Four synthetic loops, each patching one operand ITER times: an imm8, an
// imm16, a ModRM disp16, and an imm8 whose bytes two live programs cover (the
// remembered plan must not patch only the one it first saw). Every one must
// print the right sum, keep the arena small, report ~ITER breaks repaired and
// never promote a paragraph to volatile.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ITER = 3000;

// Shared tail at `at`: print BX as four hex digits, exit. Position-independent
// (rel8 jumps only).
function tail(w) {
  w(0xB9, 0x04, 0x00);               // mov cx,4
  w(0xC1, 0xC3, 0x04);               // +3  rol bx,4
  w(0x88, 0xD8);                     // +6  mov al,bl
  w(0x24, 0x0F);                     // +8  and al,0Fh
  w(0x04, 0x30);                     // +A  add al,'0'
  w(0x3C, 0x39);                     // +C  cmp al,'9'
  w(0x76, 0x02);                     // +E  jbe +12
  w(0x04, 0x07);                     // +10 add al,7
  w(0x88, 0xC2);                     // +12 mov dl,al
  w(0xB4, 0x02);                     // +14 mov ah,2
  w(0xCD, 0x21);                     // +16 int 21h
  w(0xE2, 0xE9);                     // +18 loop +3
  w(0xB8, 0x00, 0x4C);               // +1A mov ax,4C00h
  w(0xCD, 0x21);                     // +1D int 21h
}

const hex4 = (v) => (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');

const CASES = {
  // imm8 of `add bx,imm8` <- low byte of CX (sign-extended by the add).
  imm8: {
    program() {
      const b = []; const w = (...x) => b.push(...x);
      w(0xB9, ITER & 0xFF, ITER >> 8);   // 0100 mov cx,ITER
      w(0x31, 0xDB);                     // 0103 xor bx,bx
      w(0x88, 0xC8);                     // 0105 mov al,cl
      w(0x2E, 0xA2, 0x0E, 0x01);         // 0107 mov cs:[010E],al
      w(0x90);                           // 010B nop
      w(0x83, 0xC3, 0x00);               // 010C add bx,imm8   (imm at 010E)
      w(0xE2, 0xF4);                     // 010F loop 0105
      tail(w);                           // 0111
      return Buffer.from(b);
    },
    expected() {
      let bx = 0;
      for (let i = 1; i <= ITER; i++) bx = (bx + ((i & 0xFF) << 24 >> 24)) & 0xFFFF;
      return hex4(bx);
    },
  },
  // imm16 of `add bx,imm16` <- CX*3 (a value with both bytes live).
  imm16: {
    program() {
      const b = []; const w = (...x) => b.push(...x);
      w(0xB9, ITER & 0xFF, ITER >> 8);   // 0100 mov cx,ITER
      w(0x31, 0xDB);                     // 0103 xor bx,bx
      w(0x89, 0xC8);                     // 0105 mov ax,cx
      w(0x01, 0xC8);                     // 0107 add ax,cx
      w(0x01, 0xC8);                     // 0109 add ax,cx
      w(0x2E, 0xA3, 0x12, 0x01);         // 010B mov cs:[0112],ax
      w(0x90);                           // 010F nop
      w(0x81, 0xC3, 0x00, 0x00);         // 0110 add bx,imm16  (imm at 0112)
      w(0xE2, 0xEF);                     // 0114 loop 0105
      tail(w);                           // 0116
      return Buffer.from(b);
    },
    expected() {
      let bx = 0;
      for (let i = 1; i <= ITER; i++) bx = (bx + i * 3) & 0xFFFF;
      return hex4(bx);
    },
  },
  // The imm8 loop run twice over the SAME BYTES through two different code
  // segments: once as CS:0109, then again as (CS+1):00F9, reached by a `retf`.
  // A program is keyed by its code base, so the second pass compiles a
  // second program over the patched `add` while the first is still live --
  // and the first pass has already left a plan naming only the first. A plan
  // that trusted its own list went on patching that one while the loop ran
  // the other's stale imm8. BRW's DOS extender is the real case: its int
  // thunk is real-mode 0110h and protected-mode selector 20h (base 1100h),
  // and the stale copy kept issuing `int 10h` where the guest had written 21h.
  alias: {
    N1: 100,
    program() {
      const b = []; const w = (...x) => b.push(...x);
      const N1 = this.N1;
      w(0xB9, N1 & 0xFF, N1 >> 8);       // 0100 mov cx,N1
      w(0x31, 0xDB);                     // 0103 xor bx,bx
      w(0x31, 0xD2);                     // 0105 xor dx,dx
      w(0x0E);                           // 0107 push cs
      w(0x07);                           // 0108 pop es        (the store's segment, both passes)
      w(0x88, 0xC8);                     // 0109 mov al,cl
      w(0x26, 0xA2, 0x13, 0x01);         // 010B mov es:[0113],al
      // `jmp $+2` ends the block, so the `add` is fetched after the store --
      // an `es:` store into the same block runs the words already decoded.
      w(0xEB, 0x00);                     // 010F jmp $+2
      w(0x83, 0xC3, 0x00);               // 0111 add bx,imm8   (imm at 0113)
      w(0xE2, 0xF3);                     // 0114 loop 0109
      w(0x42);                           // 0116 inc dx
      w(0x83, 0xFA, 0x01);               // 0117 cmp dx,1
      w(0x75, 0x0C);                     // 011A jne 0128
      w(0xB9, ITER & 0xFF, ITER >> 8);   // 011C mov cx,ITER
      w(0x0E);                           // 011F push cs
      w(0x58);                           // 0120 pop ax
      w(0x40);                           // 0121 inc ax
      w(0x50);                           // 0122 push ax
      w(0xB8, 0xF9, 0x00);               // 0123 mov ax,00F9   (0109 - 10h)
      w(0x50);                           // 0126 push ax
      w(0xCB);                           // 0127 retf
      tail(w);                           // 0128
      return Buffer.from(b);
    },
    expected() {
      const s8 = (i) => (i & 0xFF) << 24 >> 24;
      let bx = 0;
      for (let i = this.N1; i >= 1; i--) bx = (bx + s8(i)) & 0xFFFF;
      for (let i = ITER; i >= 1; i--) bx = (bx + s8(i)) & 0xFFFF;
      return hex4(bx);
    },
  },
  // disp16 of `mov al,[si+disp16]` <- 0200h + (CX & FFh), over a table at
  // 0200h holding table[i] = i; the sum lands in BL.
  disp16: {
    program() {
      const b = []; const w = (...x) => b.push(...x);
      w(0xB9, ITER & 0xFF, ITER >> 8);   // 0100 mov cx,ITER
      w(0x31, 0xDB);                     // 0103 xor bx,bx
      w(0x31, 0xF6);                     // 0105 xor si,si
      w(0x89, 0xC8);                     // 0107 mov ax,cx
      w(0x25, 0xFF, 0x00);               // 0109 and ax,00FFh
      w(0x05, 0x00, 0x02);               // 010C add ax,0200h
      w(0x2E, 0xA3, 0x15, 0x01);         // 010F mov cs:[0115],ax
      w(0x8A, 0x84, 0x00, 0x02);         // 0113 mov al,[si+disp16]  (disp at 0115)
      w(0x00, 0xC3);                     // 0117 add bl,al
      w(0xE2, 0xEC);                     // 0119 loop 0107
      tail(w);                           // 011B
      while (b.length < 0x100) b.push(0);
      for (let i = 0; i < 256; i++) b.push(i);   // 0200..02FF: table[i] = i
      return Buffer.from(b);
    },
    expected() {
      let bl = 0;
      for (let i = 1; i <= ITER; i++) bl = (bl + (i & 0xFF)) & 0xFF;
      return hex4(bl);
    },
  },
};

function run(com, extra) {
  const args = [path.join(__dirname, '..', 'tools', 'toyvm', 'run-dos.js'), com, '--dispatches=2000000', '--text', ...extra];
  return execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 24 });
}

const screen = (log) => (log.match(/^  \|(.*)$/gm) || []).map((s) => s.slice(3).trim()).join('');
const arenaKb = (log) => +(/traces \((\d+)KB of arena, (\d+) recycles/.exec(log) || [0, 0])[1];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-operand-patch-'));
const summary = [];
for (const [name, c] of Object.entries(CASES)) {
  const com = path.join(dir, `${name.toUpperCase()}.COM`);
  fs.writeFileSync(com, c.program());
  const log = run(com, []);
  const flushed = run(com, ['--no-volatile']);
  assert.ok(/exited=true/.test(log), `${name}: did not exit:\n${log}`);
  assert.strictEqual(screen(log), c.expected(), `${name}: printed the wrong sum`);
  assert.strictEqual(screen(flushed), c.expected(), `${name}: --no-volatile arm printed the wrong sum`);
  const m = /(\d+) self-modify breaks, (\d+) break\(s\) repaired in place \((\d+) by a remembered plan\)/.exec(log);
  assert.ok(m, `${name}: no repair count in:\n${log}`);
  assert.ok(+m[2] >= ITER - 5, `${name}: expected ~${ITER} repairs, got ${m[2]} of ${m[1]} breaks`);
  // One site, one range: the first repair walks the decode and leaves a
  // plan, every later one is the plan re-read off memory (CYCLE's ISR takes
  // 30k of these; the walk cost more than the compile it replaced). Every
  // program compiled over the range after the plan was made -- `alias`'s
  // second code base, or a tree-fold install's recompile under
  // TOYVM_TREE_FOLD=1 -- costs one more walk, so allow a few.
  assert.ok(+m[3] >= +m[2] - 4, `${name}: expected the repairs to come from a remembered plan, got ${m[3]} of ${m[2]}`);
  assert.ok(!/volatile paragraph/.test(log), `${name}: a paragraph went volatile:\n${log}`);
  assert.ok(arenaKb(log) <= 8, `${name}: the arena grew to ${arenaKb(log)}KB`);
  summary.push(`${name} ${screen(log)} (${m[2]}/${m[1]} breaks repaired, ${arenaKb(log)}KB)`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`PASS test-toyvm-operand-patch: ${summary.join('; ')}`);
