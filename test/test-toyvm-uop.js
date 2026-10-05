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

// One-operand MUL/IMUL/DIV/IDIV at every width, register and memory forms,
// with CF/OF read straight after a multiply. The divisors are forced odd and
// the dividends small enough that no divide faults (see divfault for that).
function muldiv() {
  const a = asm();
  prologue(a, 0x400);
  a.w(0xC6, 0x06, 0x00, 0x24, 40); // mov byte [2400h],40
  a.label('outer');
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0xB9, 0x00, 0x01);       // mov cx,100h
  a.label('top');
  a.w(0x8A, 0x04);             // mov al,[si]
  a.w(0xF6, 0x64, 0x01);       // mul byte [si+1]
  a.w(0x83, 0xD7, 0x00);       // adc di,0       (CF of the mul)
  a.w(0x01, 0xC5);             // add bp,ax
  a.w(0x8B, 0x04);             // mov ax,[si]
  a.w(0xF7, 0x6C, 0x02);       // imul word [si+2]
  a.w(0x71); a.rel8('noov');   // jno noov       (OF of the imul)
  a.w(0x47);                   // inc di
  a.label('noov');
  a.w(0x01, 0xC5);             // add bp,ax
  a.w(0x11, 0xD5);             // adc bp,dx
  a.w(0x8B, 0x1C);             // mov bx,[si]
  a.w(0x83, 0xCB, 0x01);       // or bx,1
  a.w(0x89, 0xE8);             // mov ax,bp
  a.w(0x31, 0xD2);             // xor dx,dx
  a.w(0xF7, 0xF3);             // div bx
  a.w(0x01, 0xD7);             // add di,dx
  a.w(0x89, 0xE8);             // mov ax,bp
  a.w(0x99);                   // cwd
  a.w(0xF7, 0xFB);             // idiv bx
  a.w(0x01, 0xC7);             // add di,ax
  a.w(0x89, 0xE8);             // mov ax,bp
  a.w(0x30, 0xE4);             // xor ah,ah
  a.w(0xF6, 0xF3);             // div bl
  a.w(0x01, 0xC7);             // add di,ax
  a.w(0x8A, 0x44, 0x03);       // mov al,[si+3]
  a.w(0x98);                   // cbw
  a.w(0xF6, 0xFB);             // idiv bl
  a.w(0x01, 0xC7);             // add di,ax
  a.w(0x66, 0x0F, 0xB7, 0xDB); // movzx ebx,bx
  a.w(0x66, 0x89, 0xE8);       // mov eax,ebp
  a.w(0x66, 0xF7, 0xE3);       // mul ebx
  a.w(0x66, 0x01, 0xD5);       // add ebp,edx
  a.w(0x66, 0xF7, 0xEB);       // imul ebx
  a.w(0x66, 0x01, 0xC7);       // add edi,eax
  a.w(0x66, 0x99);             // cdq
  a.w(0x66, 0xF7, 0xFB);       // idiv ebx
  a.w(0x66, 0x01, 0xD7);       // add edi,edx
  a.w(0x66, 0x31, 0xD2);       // xor edx,edx
  a.w(0x66, 0xF7, 0xF3);       // div ebx
  a.w(0x66, 0x01, 0xC5);       // add ebp,eax
  a.w(0x46);                   // inc si
  a.w(0xE2); a.rel8('top');    // loop top
  a.w(0xFE, 0x0E, 0x00, 0x24); // dec byte [2400h]
  a.w(0x75); a.rel8('outer');  // jnz outer
  epilogue(a);
  return { com: a.done(), head: a.addr('top') };
}

// A divide that faults: the dividend climbs by 4 every outer pass while the
// (odd) byte divisor cycles through 1..7, so once it passes 255 the first
// divide by 1 has a quotient that does not fit and the loop ends in INT 0 --
// late enough (~100K steps) that the snapshot is taken first and only the
// long budgets reach it. The micro-op program must leave before the divide
// has changed anything, at exactly the state L1 faults in.
function divfault() {
  const a = asm();
  prologue(a, 0x400);
  a.w(0xBD, 0x00, 0x00);       // mov bp,0
  a.label('outer');
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0xB9, 0x00, 0x01);       // mov cx,100h
  a.label('top');
  a.w(0x89, 0xE8);             // mov ax,bp
  a.w(0x8A, 0x1C);             // mov bl,[si]
  a.w(0x80, 0xCB, 0x01);       // or bl,1
  a.w(0xF6, 0xF3);             // div bl
  a.w(0x01, 0xC7);             // add di,ax
  a.w(0x46);                   // inc si
  a.w(0xE2); a.rel8('top');    // loop top
  a.w(0x83, 0xC5, 0x04);       // add bp,4
  a.w(0xEB); a.rel8('outer');  // jmp outer
  return { com: a.done(), head: a.addr('top') };
}

// Segment-register loads inside the hot loop: les/lds/lfs from a far-pointer
// table, mov sreg from a register and from memory, push/pop of es/ds/fs/gs,
// and mov r/m from a sreg -- every one followed by an access through the
// segment it just changed, so a stale base in the program reads wrong bytes.
// The far-pointer table at DS:2000 holds four (off, seg) pairs whose segments
// are DS, DS+1000h, DS+10h, DS+1010h.
function segloads(reps = 30) {
  const a = asm();
  prologue(a, 0x400);
  a.w(0x8C, 0xD8);             // mov ax,ds
  a.w(0xBB, 0x00, 0x20);       // mov bx,2000h
  a.w(0xB2, 0x04);             // mov dl,4
  a.label('tbl');
  a.w(0x89, 0x5F, 0x00);       // mov [bx+0],bx  (offset: 2000h.. , read as data)
  a.w(0x89, 0x47, 0x02);       // mov [bx+2],ax
  a.w(0x05, 0x10, 0x04);       // add ax,0410h
  a.w(0x83, 0xC3, 0x04);       // add bx,4
  a.w(0xFE, 0xCA);             // dec dl
  a.w(0x75); a.rel8('tbl');    // jnz tbl
  a.w(0xC6, 0x06, 0x00, 0x24, reps); // mov byte [2400h],reps
  a.label('outer');
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0xB9, 0x00, 0x01);       // mov cx,100h
  a.label('top');
  a.w(0x89, 0xCB);             // mov bx,cx
  a.w(0x83, 0xE3, 0x03);       // and bx,3
  a.w(0xC1, 0xE3, 0x02);       // shl bx,2
  a.w(0xC4, 0xBF, 0x00, 0x20); // les di,[bx+2000h]
  a.w(0x26, 0x02, 0x05);       // add al,es:[di]
  a.w(0x26, 0x88, 0x45, 0x40); // mov es:[di+40h],al
  a.w(0x0F, 0xB4, 0xAF, 0x00, 0x20); // lfs bp,[bx+2000h]
  a.w(0x64, 0x02, 0x66, 0x41); // add ah,fs:[bp+41h]
  a.w(0x0F, 0xA0);             // push fs
  a.w(0x07);                   // pop es
  a.w(0x26, 0x00, 0x65, 0x42); // add es:[di+42h],ah
  a.w(0x1E);                   // push ds
  a.w(0x0F, 0xA9);             // pop gs
  a.w(0x65, 0x02, 0x04);       // add al,gs:[si]
  a.w(0x8C, 0xC2);             // mov dx,es
  a.w(0x01, 0xD7);             // add di,dx
  a.w(0x81, 0xE7, 0xFF, 0x07); // and di,07FFh
  a.w(0x81, 0xCF, 0x00, 0x10); // or di,1000h
  a.w(0x8E, 0xE2);             // mov fs,dx
  a.w(0x8E, 0x87, 0x02, 0x20); // mov es,[bx+2002h]
  a.w(0x26, 0x30, 0x04);       // xor es:[si],al
  a.w(0x8C, 0x06, 0x10, 0x24); // mov [2410h],es
  a.w(0x06);                   // push es
  a.w(0x1E);                   // push ds
  a.w(0x1F);                   // pop ds
  a.w(0x07);                   // pop es
  a.w(0x66, 0x0F, 0xA8);       // push gs (o32)
  a.w(0x66, 0x0F, 0xA1);       // pop fs (o32)
  a.w(0x64, 0x00, 0x44, 0x01); // add fs:[si+1],al
  a.w(0x46);                   // inc si
  a.w(0xE2); a.rel8('top');    // loop top
  a.w(0xFE, 0x0E, 0x00, 0x24); // dec byte [2400h]
  a.w(0x75); a.rel8('outer');  // jnz outer
  epilogue(a);
  return { com: a.done(), head: a.addr('top') };
}

// SHLD/SHRD by constants, 16 and 32 bits, register and memory destinations,
// with CF (adc), OF (jo), ZF/PF (setz/setp) of the funnel read back, and a
// 16.16 fixed-point step (imul + shrd 16) whose flags are dead.
function dshift(reps = 40) {
  const a = asm();
  prologue(a, 0x400);
  a.w(0xC6, 0x06, 0x00, 0x24, reps); // mov byte [2400h],reps
  a.w(0x66, 0xBB, 0x35, 0x71, 0x02, 0x00); // mov ebx,27135h
  a.label('outer');
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0xB9, 0x00, 0x01);       // mov cx,100h
  a.label('top');
  a.w(0x66, 0x8B, 0x04);       // mov eax,[si]
  a.w(0x66, 0xF7, 0xEB);       // imul ebx
  a.w(0x66, 0x0F, 0xAC, 0xD0, 0x10); // shrd eax,edx,16
  a.w(0x66, 0x01, 0xC5);       // add ebp,eax
  a.w(0x66, 0x0F, 0xA4, 0xC7, 0x05); // shld edi,eax,5
  a.w(0x83, 0xD5, 0x00);       // adc bp,0            (CF of the shld)
  a.w(0x0F, 0xAC, 0xC2, 0x03); // shrd dx,ax,3
  a.w(0x71); a.rel8('noov');   // jno noov            (OF of the shrd)
  a.label('ovf');
  a.w(0x66, 0x43);             // inc ebx
  a.label('noov');
  a.w(0x0F, 0x94, 0xC4);       // setz ah
  a.w(0x0F, 0x9A, 0xC0);       // setp al
  a.w(0x01, 0xC7);             // add di,ax
  a.w(0x0F, 0xA4, 0x14, 0x07); // shld [si],dx,7
  a.w(0x13, 0x3C);             // adc di,[si]         (CF of the memory shld)
  a.w(0x66, 0x0F, 0xAC, 0x7C, 0x02, 0x0B); // shrd [si+2],edi,11
  a.w(0x46);                   // inc si
  a.w(0xE2); a.rel8('top');    // loop top
  a.w(0xFE, 0x0E, 0x00, 0x24); // dec byte [2400h]
  a.w(0x75); a.rel8('outer');  // jnz outer
  epilogue(a);
  return { com: a.done(), head: a.addr('top'), alt: [a.addr('ovf')] };
}

// Every shift and rotate kind at 8, 16 and 32 bits by CL (narrow rotates by
// immediates), where CL runs over 0..63 -- zero (value and every flag left alone), counts up to the width,
// past it, and past 31 (masked). After each one all five flags it can write
// are read back with setcc (CF, OF into DL/DH; ZF, SF, PF into memory) before
// anything else touches them, and the result is folded into EBP, which also
// feeds the next iteration's operand. A rotate leaves SF/ZF/PF to the op before
// it, so those reads check that nothing else was written. On E1 this is the
// native variable-count shift (uop-wasm.js shv_*), not a reference-interpreter
// bail.
// Through the carry and the carry alone: RCL/RCR at every width by 1, by an
// immediate (past the width, past 31) and by CL, each from a data-dependent
// CF that a CMC sometimes turns over; CLC/STC feeding ADC/SBB; and LEAVE at
// both operand sizes over a frame whose slots are written.
function rotcarry(reps = 4) {
  const a = asm();
  prologue(a, 0x400);
  a.w(0xC6, 0x06, 0x00, 0x24, reps); // mov byte [2400h],reps
  a.w(0x66, 0xBD, 0x3B, 0x9A, 0x1C, 0x87); // mov ebp,871C9A3Bh
  a.label('outer');
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0xBF, 0x00, 0x01);       // mov di,100h
  a.label('top');
  a.w(0x66, 0xAD);             // lodsd
  a.w(0x66, 0x31, 0xE8);       // xor eax,ebp
  a.w(0x88, 0xC1);             // mov cl,al
  a.w(0x32, 0xCC);             // xor cl,ah
  a.w(0x80, 0xE1, 0x3F);       // and cl,3Fh
  let v = 0;
  for (const k of [2, 3]) {                   // rcl rcr
    for (const w of [8, 16, 32]) {
      for (const form of ['1', 'imm', 'cl']) {
        a.w(0x66, 0x89, 0xC3);                // mov ebx,eax
        a.w(0x3C, 0x80 + v * 7);              // cmp al,80h+.. (CF = al below it)
        if (v % 3 === 1) a.w(0xF5);           // cmc
        const m = 0xC0 | (k << 3) | 3;        // bl / bx / ebx
        const p66 = w === 32 ? [0x66] : [];
        if (form === '1') a.w(...p66, w === 8 ? 0xD0 : 0xD1, m);
        else if (form === 'imm') a.w(...p66, w === 8 ? 0xC0 : 0xC1, m, [0, 9, 17, 33][v & 3]);
        else a.w(...p66, w === 8 ? 0xD2 : 0xD3, m);
        a.w(0x0F, 0x92, 0xC2);                // setc dl
        a.w(0x0F, 0x90, 0xC6);                // seto dh
        a.w(0x66, 0x01, 0xD5);                // add ebp,edx
        a.w(0x66, 0x31, 0xDD);                // xor ebp,ebx
        a.w(0x66, 0xD1, 0xC5);                // rol ebp,1
        v++;
      }
    }
  }
  a.w(0xF8);                   // clc
  a.w(0x66, 0x83, 0xD5, 0x00); // adc ebp,0
  a.w(0xF9);                   // stc
  a.w(0x11, 0xF5);             // adc bp,si
  a.w(0xF5);                   // cmc
  a.w(0x19, 0xC3);             // sbb bx,ax
  a.w(0x66, 0x31, 0xDD);       // xor ebp,ebx
  a.w(0x55);                   // push bp
  a.w(0x89, 0xE5);             // mov bp,sp
  a.w(0x50);                   // push ax
  a.w(0x53);                   // push bx
  a.w(0x89, 0x5E, 0xFE);       // mov [bp-2],bx
  a.w(0xC9);                   // leave
  a.w(0x66, 0x55);             // push ebp
  a.w(0x66, 0x89, 0xE5);       // mov ebp,esp
  a.w(0x66, 0x53);             // push ebx
  a.w(0x66, 0xC9);             // leave (32-bit)
  a.w(0x4F);                   // dec di
  a.w(0x0F, 0x85); a.rel16('top');   // jnz top
  a.w(0x66, 0x01, 0x2E, 0x04, 0x23); // add [2304h],ebp
  a.w(0xFE, 0x0E, 0x00, 0x24); // dec byte [2400h]
  a.w(0x0F, 0x85); a.rel16('outer'); // jnz outer
  epilogue(a);
  return { com: a.done(), head: a.addr('top') };
}

function shifts(reps = 4) {
  const a = asm();
  prologue(a, 0x400);
  a.w(0xC6, 0x06, 0x00, 0x24, reps); // mov byte [2400h],reps
  a.w(0x66, 0xBD, 0x3B, 0x9A, 0x1C, 0x87); // mov ebp,871C9A3Bh
  a.label('outer');
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0xBF, 0x00, 0x01);       // mov di,100h
  a.label('top');
  a.w(0x66, 0xAD);             // lodsd
  a.w(0x66, 0x31, 0xE8);       // xor eax,ebp
  a.w(0x88, 0xC1);             // mov cl,al
  a.w(0x32, 0xCC);             // xor cl,ah
  a.w(0x80, 0xE1, 0x3F);       // and cl,3Fh
  for (const k of [0, 1, 4, 5, 7]) {          // rol ror shl shr sar
    for (const w of [8, 16, 32]) {
      a.w(0x66, 0x89, 0xC3);                  // mov ebx,eax
      const m = 0xC0 | (k << 3) | 3;          // bl / bx / ebx
      // A narrow rotate by CL is outside the µop set (uop-ir.js supported), so
      // those go by immediates instead: 0, past the width, and past 31.
      if (k < 2 && w < 32) a.w(w === 8 ? 0xC0 : 0xC1, m, [0, 9, 19, 35][(k * 2 + (w >> 4)) & 3]);
      else if (w === 8) a.w(0xD2, m); else if (w === 16) a.w(0xD3, m); else a.w(0x66, 0xD3, m);
      a.w(0x0F, 0x92, 0xC2);                  // setc dl
      a.w(0x0F, 0x90, 0xC6);                  // seto dh
      a.w(0x0F, 0x94, 0x06, 0x00, 0x23);      // setz [2300h]
      a.w(0x0F, 0x98, 0x06, 0x01, 0x23);      // sets [2301h]
      a.w(0x0F, 0x9A, 0x06, 0x02, 0x23);      // setp [2302h]
      a.w(0x66, 0x01, 0xD5);                  // add ebp,edx
      a.w(0x66, 0x03, 0x2E, 0x00, 0x23);      // add ebp,[2300h]
      a.w(0x66, 0x31, 0xDD);                  // xor ebp,ebx
      a.w(0x66, 0xD1, 0xC5);                  // rol ebp,1
    }
  }
  a.w(0x4F);                   // dec di
  a.w(0x0F, 0x85); a.rel16('top');   // jnz top
  a.w(0x66, 0x01, 0x2E, 0x04, 0x23); // add [2304h],ebp
  a.w(0xFE, 0x0E, 0x00, 0x24); // dec byte [2400h]
  a.w(0x0F, 0x85); a.rel16('outer'); // jnz outer
  epilogue(a);
  return { com: a.done(), head: a.addr('top') };
}

// Shifts by CL on a MEMORY operand. The shift's flags are written before its
// store, so a slow-half store that hands its block back to the reference
// interpreter re-runs a shift whose flags are already out; that is exact only
// because the shift sets every bit it owns from its operands alone (uop-wasm.js
// EFFECT). Every kind at 32 bits, and one narrow of each width.
function memShifts(reps = 4) {
  const a = asm();
  prologue(a, 0x400);
  a.w(0xC6, 0x06, 0x00, 0x24, reps); // mov byte [2400h],reps
  a.w(0x66, 0xBD, 0x3B, 0x9A, 0x1C, 0x87); // mov ebp,871C9A3Bh
  a.label('outer');
  a.w(0xBE, 0x00, 0x10);       // mov si,1000h
  a.w(0xBF, 0x00, 0x01);       // mov di,100h
  a.label('top');
  a.w(0x66, 0xAD);             // lodsd
  a.w(0x66, 0x31, 0xE8);       // xor eax,ebp
  a.w(0x88, 0xC1);             // mov cl,al
  a.w(0x32, 0xCC);             // xor cl,ah
  a.w(0x80, 0xE1, 0x3F);       // and cl,3Fh
  for (const [k, w] of [[0, 32], [1, 32], [4, 32], [5, 32], [7, 32], [4, 16], [7, 8]]) {
    a.w(0x66, 0xA3, 0x08, 0x23);            // mov [2308h],eax
    const mm = 0x06 | (k << 3);
    if (w === 8) a.w(0xD2, mm, 0x08, 0x23); else if (w === 16) a.w(0xD3, mm, 0x08, 0x23);
    else a.w(0x66, 0xD3, mm, 0x08, 0x23);   // <sh> [2308h],cl
    a.w(0x0F, 0x92, 0xC2);                  // setc dl
    a.w(0x0F, 0x90, 0xC6);                  // seto dh
    a.w(0x0F, 0x94, 0x06, 0x00, 0x23);      // setz [2300h]
    a.w(0x66, 0x01, 0xD5);                  // add ebp,edx
    a.w(0x66, 0x03, 0x2E, 0x08, 0x23);      // add ebp,[2308h]
    a.w(0x66, 0x03, 0x2E, 0x00, 0x23);      // add ebp,[2300h]
    a.w(0x66, 0xD1, 0xC5);                  // rol ebp,1
  }
  a.w(0x4F);                   // dec di
  a.w(0x0F, 0x85); a.rel16('top');   // jnz top
  a.w(0x66, 0x01, 0x2E, 0x04, 0x23); // add [2304h],ebp
  a.w(0xFE, 0x0E, 0x00, 0x24); // dec byte [2400h]
  a.w(0x0F, 0x85); a.rel16('outer'); // jnz outer
  epilogue(a);
  return { com: a.done(), head: a.addr('top') };
}

// Word and dword accesses through ES:BX with BX stepping by 1111h, so every
// sixteenth iteration lands on FFFFh and the access wraps the 64K segment:
// the fast half's guard deopts, and the slow half's full-semantics access
// (uop-wasm.js ldf/stf) is not plain and has to hand its block to the
// reference interpreter -- a load, and a read-modify-write whose store comes
// after a load that was already done.
function wraps(reps = 20) {
  const a = asm();
  prologue(a, 0x400);
  a.w(0xC6, 0x06, 0x00, 0x24, reps); // mov byte [2400h],reps
  a.w(0x31, 0xDB);             // xor bx,bx
  a.label('outer');
  a.w(0xB9, 0x00, 0x04);       // mov cx,400h
  a.label('top');
  a.w(0x26, 0x8B, 0x07);       // mov ax,es:[bx]
  a.w(0x01, 0xC2);             // add dx,ax
  a.w(0x26, 0x01, 0x17);       // add es:[bx],dx
  a.w(0x66, 0x26, 0x01, 0x17); // add es:[bx],edx
  // Shifts by CL whose store wraps too: their flags are out before the store
  // hands the block back, so the re-run starts from the shifted flags.
  a.w(0x26, 0xD3, 0x27);       // shl word es:[bx],cl
  a.w(0x83, 0xD2, 0x00);       // adc dx,0
  a.w(0x66, 0x26, 0xD3, 0x07); // rol dword es:[bx],cl
  a.w(0x83, 0xD2, 0x00);       // adc dx,0
  a.w(0x81, 0xC3, 0x11, 0x11); // add bx,1111h
  a.w(0xE2); a.rel8('top');    // loop top
  a.w(0x01, 0x16, 0x04, 0x24); // add [2404h],dx
  a.w(0xFE, 0x0E, 0x00, 0x24); // dec byte [2400h]
  a.w(0x75); a.rel8('outer');  // jnz outer
  epilogue(a);
  return { com: a.done(), head: a.addr('top') };
}

// [bp+k] locals re-read across a byte store through ES. ES alternates each
// outer pass between DS+1000h (windows apart: the store keeps the locals
// under an sdisj guard) and DS itself with DI walking over the locals, so the
// store really does overwrite them and the guard has to deopt.
function segfwd(reps = 250) {
  const a = asm();
  prologue(a, 0x400);
  a.w(0x89, 0xE5);             // mov bp,sp
  a.w(0x83, 0xED, 0x40);       // sub bp,40h
  a.w(0xC7, 0x46, 0x00, 0x03, 0x00); // mov word [bp+0],3
  a.w(0xC7, 0x46, 0x02, 0x05, 0x00); // mov word [bp+2],5
  a.w(0x8C, 0xC0);             // mov ax,es
  a.w(0xA3, 0x04, 0x24);       // mov [2404h],ax
  a.w(0x8C, 0xD8);             // mov ax,ds
  a.w(0xA3, 0x02, 0x24);       // mov [2402h],ax
  a.w(0xC6, 0x06, 0x00, 0x24, reps); // mov byte [2400h],reps
  a.label('outer');
  a.w(0xA1, 0x02, 0x24);       // mov ax,[2402h]
  a.w(0x87, 0x06, 0x04, 0x24); // xchg ax,[2404h]
  a.w(0xA3, 0x02, 0x24);       // mov [2402h],ax
  a.w(0x8E, 0xC0);             // mov es,ax
  a.w(0x89, 0xEF);             // mov di,bp
  a.w(0xB9, 0x30, 0x00);       // mov cx,30h
  a.label('top');
  a.w(0x8B, 0x46, 0x00);       // mov ax,[bp+0]
  a.w(0x03, 0x46, 0x02);       // add ax,[bp+2]
  a.w(0x26, 0x88, 0x05);       // mov es:[di],al
  a.w(0x03, 0x46, 0x00);       // add ax,[bp+0]   (forwarded across the ES store)
  a.w(0x01, 0x46, 0x02);       // add [bp+2],ax
  a.w(0x47);                   // inc di
  a.w(0xE2); a.rel8('top');    // loop top
  a.w(0xFE, 0x0E, 0x00, 0x24); // dec byte [2400h]
  a.w(0x75); a.rel8('outer');  // jnz outer
  epilogue(a);
  return { com: a.done(), head: a.addr('top'), segdisj: true };
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
  for (const [name, make] of [['sprite', sprite], ['checksum', checksum], ['mixed', mixed], ['flags', flags], ['carry', carry],
    ['muldiv', muldiv], ['divfault', divfault], ['segloads', segloads], ['dshift', dshift], ['segfwd', segfwd],
    ['shifts', shifts], ['rotcarry', rotcarry], ['memshifts', memShifts], ['wraps', wraps]]) {
    if (only && only !== name) continue;
    const made = make();
    // A case may name further heads inside the same loop: a header whose
    // first instruction is not the loop top is where deopt stubs get created
    // late (a budget CHECK before a setz, say).
    for (const head of [made.head, ...(made.alt || [])]) {
    const tag = head === made.head ? name : `${name}@${head.toString(16)}`;
    const c = await capture({ ...made, head });
    const reg = IR.discover((lin) => c.vm.mem[lin], c.env, c.snap.regs.gip >>> 0);
    assert.ok(reg.cyclic, `${tag}: the head is not on a loop`);
    const l1 = budgets.map(B => l1Arm(c.vm, c.snap, B));
    const configs = OPT.ablationConfigs();
    const perIter = [];
    for (const [cname, passes] of configs) {
      // The optimizer reads the machine (segment bases, for one): build from
      // the snapshot, not from wherever the previous configuration's last run
      // left the VM.
      H.seed(c.vm, c.snap);
      const prog = OPT.build(reg, { passes, env: c.env, vm: c.vm });
      budgets.forEach((B, i) => {
        const u = uopArm(c.vm, c.snap, prog, B);
        const diff = H.diffStates(l1[i], u.state);
        assert.deepStrictEqual(diff, [], `${tag} [${cname}] budget ${B}: ${diff.join('; ')}`);
        assert.ok(u.runs > 0, `${tag} [${cname}] budget ${B}: the program never ran`);
        if (B === 200000) perIter.push(`${cname} ${(u.n / Math.max(1, u.heads)).toFixed(1)}`);
        checked++;
      });
    }
    if (made.segdisj) {
      // The case is only worth its runs if the guard is really there.
      H.seed(c.vm, c.snap);
      const all = OPT.build(reg, { passes: Object.fromEntries(OPT.PASSES.map(p => [p, true])), env: c.env, vm: c.vm });
      assert.ok(all.stats.segdisj > 0, `${tag}: no sdisj guard was placed`);
    }
    console.log(`ok ${tag}: ${configs.length} pass configurations x ${budgets.length} budgets agree`);
    console.log(`   µops/iteration: ${perIter.join(', ')}`);
    }
  }
  console.log(`ok test-toyvm-uop: ${checked} differential runs agree`);
}

module.exports = { sprite, checksum, mixed, flags, carry, muldiv, divfault, segloads, dshift, segfwd, shifts, rotcarry, memShifts, wraps, capture, l1Arm, uopArm };

if (require.main === module) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
