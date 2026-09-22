'use strict';

// The micro-op tier (tools/toyvm/uop-*.js) against the interpreter.
//
// Each case is a small .COM with one hot loop. The test runs it far enough to
// be inside the loop, single-steps the guest onto the loop head, snapshots the
// machine there, and then runs two arms from that snapshot: the shipped
// interpreter (L1), and the same with the micro-op program standing in for the
// loop every time the host reaches its head. Registers, live flags, all of
// guest RAM, the final gip and the unspent budget must agree at every budget
// tried -- including budgets that run out in the middle of an iteration, which
// is where the clock pass earns or loses its exactness.
//
// Every program is run in every pass configuration: naive, all passes, and
// all passes minus each one, so a pass that is only correct in the company of
// another is caught.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runDos } = require('../tools/toyvm/run-dos');
const H = require('../tools/toyvm/uop-harness');
const IR = require('../tools/toyvm/uop-ir');
const OPT = require('../tools/toyvm/uop-opt');
const { runRef } = require('../tools/toyvm/uop-ref');

function asm() {
  const b = [], labels = new Map(), fixups = [];
  const at = () => 0x100 + b.length;
  return {
    w: (...x) => { b.push(...x); },
    label(n) { labels.set(n, at()); },
    rel8(n) { fixups.push({ i: b.length, n, size: 1 }); b.push(0); },
    rel16(n) { fixups.push({ i: b.length, n, size: 2 }); b.push(0, 0); },
    at,
    addr: (n) => labels.get(n),
    done() {
      for (const f of fixups) {
        const target = labels.get(f.n);
        assert.ok(target !== undefined, `no such label: ${f.n}`);
        const v = target - (0x100 + f.i + f.size);
        if (f.size === 1) {
          assert.ok(v >= -128 && v <= 127, `${f.n} is out of rel8 range (${v})`);
          b[f.i] = v & 0xFF;
        } else { b[f.i] = v & 0xFF; b[f.i + 1] = (v >> 8) & 0xFF; }
      }
      return Buffer.from(b);
    },
  };
}

// Common prologue: ES = DS + 0x1000, a source buffer at DS:1000 of `n` bytes
// holding ((c >> 1) ^ c) & 7 for a counter c running down from n -- one byte
// in eight is the transparent colour zero, and the low bits of neighbouring
// bytes and words both vary, so carries out of shifts are not constant.
function prologue(a, n) {
  a.w(0x8C, 0xD8);             // mov ax,ds
  a.w(0x05, 0x00, 0x10);       // add ax,1000h
  a.w(0x8E, 0xC0);             // mov es,ax
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0xB9, n & 0xFF, n >> 8); // mov cx,n
  a.label('fill');
  a.w(0x88, 0xC8);             // mov al,cl
  a.w(0xD0, 0xE8);             // shr al,1
  a.w(0x30, 0xC8);             // xor al,cl
  a.w(0x24, 0x07);             // and al,7
  a.w(0x88, 0x04);             // mov [si],al
  a.w(0x46);                   // inc si
  a.w(0xE2); a.rel8('fill');   // loop fill
}
function epilogue(a) {
  a.w(0xB8, 0x00, 0x4C);       // mov ax,4C00h
  a.w(0xCD, 0x21);             // int 21h
}

// The brief's worked example: a transparent sprite copy.
function sprite() {
  const a = asm();
  prologue(a, 0x777);
  a.w(0xBA, 40, 0);            // mov dx,40 (outer reps)
  a.label('outer');
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0x31, 0xFF);             // xor di,di
  a.w(0xB9, 0x77, 0x07);       // mov cx,777h
  a.label('top');
  a.w(0x8A, 0x04);             // mov al,[si]
  a.w(0x46);                   // inc si
  a.w(0x3C, 0x00);             // cmp al,0
  a.w(0x74); a.rel8('skip');   // je skip
  a.w(0x26, 0x88, 0x05);       // mov es:[di],al
  a.label('skip');
  a.w(0x47);                   // inc di
  a.w(0x49);                   // dec cx
  a.w(0x75); a.rel8('top');    // jnz top
  a.w(0xFE, 0x06, 0x03, 0x10); // inc byte [1003h]   (perturb the source)
  a.w(0x4A);                   // dec dx
  a.w(0x75); a.rel8('outer');  // jnz outer
  epilogue(a);
  return { com: a.done(), head: a.addr('top') };
}

// A word-sized checksum with a call, adc and a shift: exercises inlined
// call/ret, a carry chain, a 32-bit register and flags read after a shift.
function checksum() {
  const a = asm();
  prologue(a, 0x400);
  a.w(0xBA, 30, 0);            // mov dx,30
  a.label('outer');
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0xB9, 0x00, 0x02);       // mov cx,200h
  a.w(0x31, 0xDB);             // xor bx,bx
  a.w(0x66, 0x31, 0xED);       // xor ebp,ebp
  a.label('top');
  a.w(0xAD);                   // lodsw
  a.w(0xE8); a.rel16('mix');   // call mix
  a.w(0x11, 0xC3);             // adc bx,ax
  a.w(0x66, 0x01, 0xC5);       // add ebp,eax
  a.w(0xD1, 0xC3);             // rol bx,1
  a.w(0xE2); a.rel8('top');    // loop top
  a.w(0x01, 0x1E, 0x00, 0x20); // add [2000h],bx
  a.w(0x4A);                   // dec dx
  a.w(0x75); a.rel8('outer');  // jnz outer
  epilogue(a);
  a.label('mix');
  a.w(0x35, 0x5A, 0xA5);       // xor ax,0A55Ah
  a.w(0xD1, 0xE8);             // shr ax,1
  a.w(0xC3);                   // ret
  return { com: a.done(), head: a.addr('top') };
}

// A 32-bit counted loop with a signed compare, imul, push/pop and a byte
// register merge into AH.
function mixed() {
  const a = asm();
  prologue(a, 0x300);
  a.w(0xBA, 25, 0);            // mov dx,25
  a.label('outer');
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0x66, 0xB9, 0x00, 0x03, 0, 0);   // mov ecx,300h
  a.label('top');
  a.w(0x8A, 0x24);             // mov ah,[si]
  a.w(0x51);                   // push cx
  a.w(0x6B, 0xC8, 0x0D);       // imul cx,ax,13
  a.w(0x01, 0x0E, 0x00, 0x21); // add [2100h],cx
  a.w(0x59);                   // pop cx
  a.w(0x80, 0xFC, 0x04);       // cmp ah,4
  a.w(0x7C); a.rel8('lt');     // jl lt
  a.w(0x26, 0x00, 0x24);       // add es:[si],ah
  a.label('lt');
  a.w(0x46);                   // inc si
  a.w(0x66, 0x49);             // dec ecx
  a.w(0x75); a.rel8('top');    // jnz top
  a.w(0x4A);                   // dec dx
  a.w(0x75); a.rel8('outer');  // jnz outer
  epilogue(a);
  return { com: a.done(), head: a.addr('top') };
}

// Flag plumbing: adc/sbb chains, an inc that keeps the carry for a later adc,
// an unsigned-or-equal branch, a shift by CL (the helper call, flags left in
// L1's record) read by a setcc, a test and a neg.
function flags() {
  const a = asm();
  prologue(a, 0x400);
  a.w(0xBA, 20, 0);            // mov dx,20
  a.label('outer');
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0xBF, 0x00, 0x03);       // mov di,300h
  a.w(0x31, 0xDB);             // xor bx,bx
  a.w(0xF8);                   // clc
  a.label('top');
  a.w(0xAC);                   // lodsb
  a.w(0x00, 0xD8);             // add al,bl
  a.w(0x80, 0xD7, 0x00);       // adc bh,0
  a.w(0x18, 0xC3);             // sbb bl,al
  a.w(0x43);                   // inc bx
  a.w(0x83, 0xD5, 0x00);       // adc bp,0
  a.w(0x3C, 0x03);             // cmp al,3
  a.w(0x76); a.rel8('skip');   // jbe skip
  a.w(0x88, 0xC1);             // mov cl,al
  a.w(0x80, 0xE1, 0x03);       // and cl,3
  a.w(0x80, 0xC9, 0x01);       // or cl,1
  a.w(0xD3, 0xE3);             // shl bx,cl
  a.w(0x0F, 0x9F, 0xC4);       // setg ah
  a.label('skip');
  a.w(0xA8, 0x01);             // test al,1
  a.w(0x75); a.rel8('odd');    // jnz odd
  a.w(0xF6, 0xDB);             // neg bl
  a.label('odd');
  a.w(0x13, 0x04);             // adc ax,[si]
  a.w(0x4F);                   // dec di
  a.w(0x75); a.rel8('top');    // jnz top
  a.w(0x01, 0x1E, 0x00, 0x22); // add [2200h],bx
  a.w(0x01, 0x2E, 0x02, 0x22); // add [2202h],bp
  a.w(0x01, 0x06, 0x04, 0x22); // add [2204h],ax
  a.w(0x4A);                   // dec dx
  a.w(0x75); a.rel8('outer');  // jnz outer
  epilogue(a);
  return { com: a.done(), head: a.addr('top') };
}

// A carry chain around the back edge: the adc reads the carry its own
// previous iteration made, after it has already reloaded both operands --
// the case where forwarding straight off the producer's operands would read
// the new ones.
function carry() {
  const a = asm();
  prologue(a, 0x400);
  a.w(0xBA, 40, 0);            // mov dx,40
  a.label('outer');
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0xB9, 0x00, 0x01);       // mov cx,100h
  a.label('top');
  a.w(0x13, 0x04);             // adc ax,[si]   (carries every ~30 words)
  a.w(0x46);                   // inc si
  a.w(0x46);                   // inc si
  a.w(0xE2); a.rel8('top');    // loop top
  a.w(0x66, 0x13, 0xD8);       // adc ebx,eax
  a.w(0x01, 0x06, 0x00, 0x23); // add [2300h],ax
  a.w(0x66, 0x2B, 0xF8);       // sub edi,eax   (CF reads eax as the subtrahend)
  a.w(0x66, 0x8B, 0xC3);       // mov eax,ebx   (...which this overwrites)
  a.w(0x66, 0x13, 0xEF);       // adc ebp,edi   (so this CF must not re-read eax)
  a.w(0x4A);                   // dec dx
  a.w(0x75); a.rel8('outer');  // jnz outer
  epilogue(a);
  return { com: a.done(), head: a.addr('top') };
}

async function capture(com) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-uop-'));
  const exe = path.join(dir, 'UOP.COM');
  fs.writeFileSync(exe, com.com);
  const r = await runDos({ exe, budget: 30000, slice: 5000, autoKey: true, log: () => {} });
  const env = H.envOf(r.vm);
  const ok = H.stepTo(r.vm, {}, env.codeBase, com.head, 2e6, r.machine);
  assert.ok(ok, 'never reached the loop head');
  return { vm: r.vm, snap: H.snapshot(r.vm), env: H.envOf(r.vm) };
}

function l1Arm(vm, snap, budget) {
  const cache = H.seed(vm, snap);
  const a = H.runArm(vm, cache, budget);
  return H.guestState(vm, a);
}

function uopArm(vm, snap, prog, budget) {
  const head = { codeBase: snap.env.codeBase, ip: prog.headIp };
  const cache = H.seed(vm, snap);
  let n = 0, runs = 0, heads = 0;
  const b = H.runArm(vm, cache, budget, {
    head,
    enter: (vm2, left) => {
      vm2.exports.set_steps(left);
      const res = runRef(vm2, prog);
      n += res.n; runs++; heads += res.heads;
      return res.steps;
    },
  });
  return { state: H.guestState(vm, b), n, runs, heads };
}

async function main() {
  const budgets = [0, 1, 2, 3, 5, 8, 13, 37, 100, 1001, 12345, 200000];
  const only = process.argv[2] || null;
  let checked = 0;
  for (const [name, make] of [['sprite', sprite], ['checksum', checksum], ['mixed', mixed], ['flags', flags], ['carry', carry]]) {
    if (only && only !== name) continue;
    const c = await capture(make());
    const reg = IR.discover((lin) => c.vm.mem[lin], c.env, c.snap.regs.gip >>> 0);
    assert.ok(reg.cyclic, `${name}: the head is not on a loop`);
    const l1 = budgets.map(B => l1Arm(c.vm, c.snap, B));
    const configs = OPT.ablationConfigs();
    const perIter = [];
    for (const [cname, passes] of configs) {
      const prog = OPT.build(reg, { passes, env: c.env, vm: c.vm });
      budgets.forEach((B, i) => {
        const u = uopArm(c.vm, c.snap, prog, B);
        const diff = H.diffStates(l1[i], u.state);
        assert.deepStrictEqual(diff, [], `${name} [${cname}] budget ${B}: ${diff.join('; ')}`);
        assert.ok(u.runs > 0, `${name} [${cname}] budget ${B}: the program never ran`);
        if (B === 200000) perIter.push(`${cname} ${(u.n / Math.max(1, u.heads)).toFixed(1)}`);
        checked++;
      });
    }
    console.log(`ok ${name}: ${configs.length} pass configurations x ${budgets.length} budgets agree`);
    console.log(`   µops/iteration: ${perIter.join(', ')}`);
  }
  console.log(`ok test-toyvm-uop: ${checked} differential runs agree`);
}

module.exports = { sprite, checksum, mixed, flags, carry, capture, l1Arm, uopArm };

if (require.main === module) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
