#!/usr/bin/env node
// FCOMI / FUCOMI publish three EFLAGS bits and MSVC reads all three.
//
// The sequence every MSVC build emits for `if (a == b)` on doubles is
//
//     fucomip st,st(1) ; lahf ; test ah,0x44 ; jp not_equal
//
// and it works because an EQUAL compare leaves ZF=1 with **PF clear**, so
// `ah & 0x44` is 0x40 -- one bit, odd parity -- and the JP is not taken. Get PF
// wrong on the equal case and the test inverts silently: every `a == b` takes
// the not-equal branch, with no crash and no wrong number anywhere near it.
// That is what stalled Black & White 2's land loader, where the list insert at
// 0x9cef29 sits behind exactly this sequence.
//
// So this checks the flags x87 defines (ZF, PF, CF) for less / equal / greater
// / unordered, for both the ordered (FCOMIP) and unordered (FUCOMIP) forms,
// and then checks the whole MSVC idiom end to end through SETP -- because
// reading the bits correctly and branching on them correctly are two different
// paths through the lazy flag system.
//
// Run: node test/test-x87-compare-eflags.js

const fs = require('fs');
const path = require('path');
const { createHostImports } = require(path.join(__dirname, '..', 'lib/host-imports'));
const RegionMap = require('../lib/region-map.generated.js');

const ROOT = path.join(__dirname, '..');
const WASM_PATH = process.env.WINE_ASSEMBLY_WASM || path.join(ROOT, 'build', 'wine-assembly.wasm');

let failures = 0;
function check(name, got, want) {
  if (got === want) { console.log(`  ok   ${name}`); return; }
  console.log(`  FAIL ${name}: got ${got}, want ${want}`);
  failures++;
}

async function main() {
  const wasmBytes = fs.readFileSync(WASM_PATH);
  const exeBytes = fs.readFileSync(path.join(__dirname, 'binaries', 'notepad.exe'));
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { exports: null, getMemory: () => memory.buffer };
  const base = createHostImports(ctx);
  const h = base.host;
  h.memory = memory;
  h.exit = () => {};
  h.log = () => {};
  h.log_i32 = () => {};
  h.crash_unimplemented = () => {};
  h.wait_multiple = () => 0;
  h.shell_execute = () => 33;

  const { instance } = await WebAssembly.instantiate(wasmBytes, { host: h });
  ctx.exports = instance.exports;
  const e = instance.exports;
  const dv = new DataView(e.memory.buffer);
  const mem = new Uint8Array(e.memory.buffer);
  mem.set(exeBytes, e.get_staging());
  e.load_pe(exeBytes.length);

  const imageBase = e.get_image_base();
  const g2w = addr => RegionMap.g2w(addr, imageBase);
  const le32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

  // Scratch doubles and two result dwords, well clear of the code we write.
  const X_ADDR = imageBase + 0x8000;
  const Y_ADDR = imageBase + 0x8008;
  const OUT_AH = imageBase + 0x8010;
  const OUT_JP = imageBase + 0x8014;

  let codeOffset = 0;
  // `opcode` is DF E9 (FUCOMIP st,st(1)) or DF F1 (FCOMIP st,st(1)).
  function compare(x, y, opcode) {
    dv.setFloat64(g2w(X_ADDR), x, true);
    dv.setFloat64(g2w(Y_ADDR), y, true);
    dv.setUint32(g2w(OUT_AH), 0xdeadbeef, true);
    dv.setUint32(g2w(OUT_JP), 0xdeadbeef, true);

    const bytes = [
      0xDD, 0x05, ...le32(Y_ADDR),   // fld qword [y]        st0=y
      0xDD, 0x05, ...le32(X_ADDR),   // fld qword [x]        st0=x st1=y
      ...opcode,                     // f(u)comip st,st(1)   compare x?y, pop
      0xDD, 0xD8,                    // fstp st(0)           drop y
      0x9F,                          // lahf
      0xA3, ...le32(OUT_AH),         // mov [out_ah], eax
      0xF6, 0xC4, 0x44,              // test ah,0x44
      0x0F, 0x9A, 0xC0,              // setp al
      0x0F, 0xB6, 0xC0,              // movzx eax, al
      0xA3, ...le32(OUT_JP),         // mov [out_jp], eax
      0xC3,
    ];

    // A fresh address per run, so the block cache never hands back an earlier
    // case's decoded block for this one.
    const codeAddr = imageBase + 0x1000 + codeOffset;
    codeOffset += 256;
    const wa = g2w(codeAddr);
    for (let i = 0; i < bytes.length; i++) mem[wa + i] = bytes[i];

    const stackTop = imageBase + 0xD00000;
    e.set_esp(stackTop);
    dv.setUint32(g2w(stackTop), 0, true);
    e.set_eip(codeAddr);
    e.run(100000);

    const ah = (dv.getUint32(g2w(OUT_AH), true) >>> 8) & 0xFF;
    return {
      cf: ah & 1,
      pf: (ah >>> 2) & 1,
      zf: (ah >>> 6) & 1,
      // 1 = the JP in `test ah,0x44 ; jp` would be taken, i.e. "not equal".
      jp: dv.getUint32(g2w(OUT_JP), true) & 0xFF,
    };
  }

  const NAN64 = NaN;
  for (const [label, op] of [['fucomip', [0xDF, 0xE9]], ['fcomip', [0xDF, 0xF1]]]) {
    console.log(`${label} st,st(1):`);

    let r = compare(1.5, 2.5, op);
    check(`${label} less: ZF`, r.zf, 0);
    check(`${label} less: PF`, r.pf, 0);
    check(`${label} less: CF`, r.cf, 1);
    check(`${label} less: jp taken (not equal)`, r.jp, 1);

    r = compare(2.5, 2.5, op);
    check(`${label} equal: ZF`, r.zf, 1);
    check(`${label} equal: PF`, r.pf, 0);
    check(`${label} equal: CF`, r.cf, 0);
    check(`${label} equal: jp NOT taken`, r.jp, 0);

    r = compare(3.5, 2.5, op);
    check(`${label} greater: ZF`, r.zf, 0);
    check(`${label} greater: PF`, r.pf, 0);
    check(`${label} greater: CF`, r.cf, 0);
    check(`${label} greater: jp taken (not equal)`, r.jp, 1);

    r = compare(NAN64, 2.5, op);
    check(`${label} unordered: ZF`, r.zf, 1);
    check(`${label} unordered: PF`, r.pf, 1);
    check(`${label} unordered: CF`, r.cf, 1);
    check(`${label} unordered: jp taken`, r.jp, 1);

    // Zero is the case a parity-of-the-result scheme is most likely to get
    // wrong twice over, since both the value and the synthetic result are 0.
    r = compare(0, 0, op);
    check(`${label} 0 == 0: ZF`, r.zf, 1);
    check(`${label} 0 == 0: PF`, r.pf, 0);
    check(`${label} 0 == 0: jp NOT taken`, r.jp, 0);

    // -0.0 == +0.0 in IEEE, and the guest code that found this bug compares
    // coordinates that are routinely zero.
    r = compare(-0, 0, op);
    check(`${label} -0 == +0: ZF`, r.zf, 1);
    check(`${label} -0 == +0: jp NOT taken`, r.jp, 0);
  }

  console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
