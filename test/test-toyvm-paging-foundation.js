'use strict';

// This tests the WIP translation primitive and real CR2/CR3 instructions.
// It deliberately does not claim paged instruction execution / #PF delivery.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeVm } = require('../tools/toyvm/vm');
const { runDos } = require('../tools/toyvm/run-dos');
const { carryState } = require('../tools/toyvm/region-live');
const { MACHINE_STATE, emit } = require('../tools/toyvm/emit');
const { compileWat } = require('../lib/compile-wat');
const { STATUS, unpack } = require('../tools/toyvm/paging');
const isa = require('../tools/toyvm/isa');

const evidenceArg = process.argv.find(a => a.startsWith('--evidence='));
const dir = evidenceArg ? path.resolve(evidenceArg.slice(11))
  : fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-paging-foundation-'));
fs.mkdirSync(dir, { recursive: true });
const report = { scope: 'WIP primitive and CR registers; no paged guest acceptance', cases: [] };

async function registers(variant) {
  // Retain the root's original named regression as actual instructions.
  const code = Buffer.from([
    0x66, 0xb8, 0, 0, 2, 0,        // mov eax,00020000
    0x0f, 0x22, 0xd8,             // mov cr3,eax
    0x66, 0xb8, 0, 0, 0, 0,
    0x0f, 0x20, 0xd8,             // mov eax,cr3
    0x66, 0xa3, 0, 3,             // mov [0300],eax
    0x66, 0xb8, 0xef, 0xcd, 0xab, 0x89,
    0x0f, 0x22, 0xd0,             // mov cr2,eax
    0x66, 0xb8, 0, 0, 0, 0,
    0x0f, 0x20, 0xd0,             // mov eax,cr2
    0x66, 0xa3, 4, 3,
    0xb8, 0, 0x4c, 0xcd, 0x21,
  ]);
  const exe = path.join(dir, `cr-registers-${variant}.COM`);
  fs.writeFileSync(exe, code);
  const r = await runDos({ exe, variant, budget: 20000, seconds: 1,
    autoKey: false, sound: false, log() {} });
  const view = new DataView(r.vm.mem.buffer);
  const base = r.vm.exports.get_dsb() >>> 0;
  const observed = { variant, cr3: view.getUint32(base + 0x300, true),
    cr2: view.getUint32(base + 0x304, true), dispatched: r.dispatched,
    exited: r.machine.exited, exitCode: r.machine.exitCode,
    ranOutOfTime: r.ranOutOfTime, unimplemented: r.unimplemented,
    wasmSha256: crypto.createHash('sha256').update(r.vm.bytes).digest('hex') };
  if (evidenceArg) fs.writeFileSync(path.join(dir, `cr-registers-${variant}.wasm`), r.vm.bytes);
  report.cases.push(observed);
  assert.equal(observed.cr3, 0x20000, 'MOV CR3/EAX must preserve the guest page-directory base');
  assert.equal(observed.cr2, 0x89abcdef, 'MOV CR2/EAX must retain the full linear address');
  assert.equal(r.ranOutOfTime, false);
  assert.equal(r.machine.exited, true);
  assert.equal(r.machine.exitCode, 0);
  assert.equal(r.vm.exports.get_cr3() >>> 0, 0x20000);
  assert.equal(r.vm.exports.get_cr2() >>> 0, 0x89abcdef);
  // The exact machine list used by a LIVE install must carry both registers.
  const second = new WebAssembly.Instance(await WebAssembly.compile(r.vm.bytes), {
    host: { memory: r.vm.memory, port_in() { return 255; }, port_out() {}, fmath() { return 0; } },
  });
  carryState(r.vm.exports, second.exports);
  for (const g of MACHINE_STATE) {
    assert.equal(second.exports[`mget_${g}`](), r.vm.exports[`mget_${g}`](), `carryState ${g}`);
  }
  r.vm.rebind({ exports: second.exports, regionBase: r.vm.regionBase, bytes: r.vm.bytes });
  assert.equal(r.vm.exports.get_cr2() >>> 0, 0x89abcdef, 'rebind retains CR2');
  assert.equal(r.vm.exports.get_cr3() >>> 0, 0x20000, 'rebind retains CR3');
}

async function primitive(variant) {
  // exportAll assumes a handler table, which switch/calls do not both have.
  // Export just this helper from the real emitted module for all three arms.
  const wat = emit(variant).replace(/\)\s*$/, '(export "test_page_translate" (func $page_translate)))');
  const file = `paging-foundation-${variant}.wat`;
  const bytes = await compileWat(() => wat, { files: [file], cacheKey: file });
  const vm = await makeVm(variant, { bytes, wat });
  const v = new DataView(vm.mem.buffer);
  const translate = (linear, write = 0, user = 0, directory = 0x20000, a20 = 1) =>
    unpack(vm.exports.test_page_translate(directory, linear, write, user, a20));
  const de = 0x20100; // DIR index 64 for 10000000
  const te = 0x21000;
  const set = (p, n) => v.setUint32(p, n >>> 0, true);
  const get = p => v.getUint32(p, true);
  function tables(dflags = 7, tflags = 7, frame = 0x30000) {
    set(de, 0x21000 | dflags); set(te, frame | tflags);
  }
  tables();
  assert.deepEqual(translate(0x10000123), { status: STATUS.ok, error: 0, address: 0x30123 });
  assert.equal(get(de), 0x21027, 'PDE accessed');
  assert.equal(get(te), 0x30027, 'read sets PTE A, not D');
  assert.deepEqual(translate(0x10000123, 1), { status: STATUS.ok, error: 0, address: 0x30123 });
  assert.equal(get(de), 0x21027, 'PDE dirty unchanged');
  assert.equal(get(te), 0x30067, 'write sets PTE accessed and dirty');
  tables(0xa07, 0xa07);
  translate(0x10000000, 1);
  assert.equal(get(de), 0x21a27, 'preserve PDE software bits');
  assert.equal(get(te), 0x30a67, 'preserve PTE software bits');

  // All 16 rows of Intel table 6-5, with user and supervisor read/write.
  let protections = 0;
  for (let d = 0; d < 4; d++) for (let t = 0; t < 4; t++) {
    for (const user of [0, 1]) for (const write of [0, 1]) {
      tables(1 | (d << 1), 1 | (t << 1));
      const allowed = !user || ((d & t & 2) && (!write || (d & t & 1)));
      const r = translate(0x10000000, write, user);
      assert.equal(r.status, allowed ? STATUS.ok : STATUS.protection, `table6-5 ${d}/${t}/${user}/${write}`);
      assert.equal(r.error, allowed ? 0 : 1 | write << 1 | user << 2);
      assert.equal(r.address, allowed ? 0x30000 : 0x10000000);
      protections++;
    }
  }
  for (const write of [0, 1]) for (const user of [0, 1]) {
    // Other bits of a not-present entry are software data, never inspected.
    set(de, 0xfffffffe);
    assert.deepEqual(translate(0x10000123, write, user),
      { status: STATUS.notPresent, error: write << 1 | user << 2, address: 0x10000123 });
    tables(); set(te, 0xfffffffe);
    assert.deepEqual(translate(0x10000123, write, user),
      { status: STATUS.notPresent, error: write << 1 | user << 2, address: 0x10000123 });
  }
  tables(7, 7, 0);
  assert.deepEqual(translate(0x10000000), { status: STATUS.ok, error: 0, address: 0 }, 'physical zero is valid');
  tables();
  // Two adjacent linear pages can have arbitrary physical frames.
  set(te + 4, 0x50007);
  assert.equal(translate(0x10000fff).address, 0x30fff);
  assert.equal(translate(0x10001000).address, 0x50000);
  // Directory switch and in-place remapping are observed by uncached walks.
  set(0x22100, 0x23007); set(0x23000, 0x60007);
  assert.equal(translate(0x10000000, 0, 0, 0x22000).address, 0x60000);
  set(te, 0x70007);
  assert.equal(translate(0x10000000).address, 0x70000);
  // No capacity mask aliases an unavailable directory, table, or frame.
  tables(7, 7, isa.GUEST_RAM_SIZE);
  assert.deepEqual(translate(0x10000000), { status: STATUS.backing, error: 0, address: isa.GUEST_RAM_SIZE });
  set(de, 0xfffff007);
  assert.deepEqual(translate(0x10000000), { status: STATUS.backing, error: 0, address: 0xfffff000 });
  assert.deepEqual(translate(0, 0, 0, 0xfffff000), { status: STATUS.backing, error: 0, address: 0xfffff000 });
  tables(7, 7, 0x100000);
  assert.equal(translate(0x10000000, 0, 0, 0x20000, 0).address, 0, 'A20 clears physical bit20');
  tables(7, 7, 0x200000);
  assert.equal(translate(0x10000000, 0, 0, 0x20000, 0).address, 0x200000, 'A20 preserves higher physical lines');
  set(0x20100, 0x121007); set(0x21000, 0x130007);
  assert.equal(translate(0x10000000, 0, 0, 0x120000, 0).address, 0x30000, 'A20 applies to directory and table reads');
  // Recursive PDE/PTE at the same address must retain D on a write.
  set(0x20000, 0x20007);
  assert.equal(translate(0, 1).address, 0x20000);
  assert.equal(get(0x20000), 0x20067);
  report.cases.push({ variant, primitive: true, protectionCombinations: protections });
}

(async () => {
  try {
    for (const variant of ['tailcall', 'switch', 'calls']) {
      await registers(variant);
      await primitive(variant);
    }
    report.passed = true;
    console.log('PASS paging foundation: real CR2/CR3 + carry/rebind; primitive in 3 dispatch variants, 192 protection combinations');
  } finally {
    if (evidenceArg) fs.writeFileSync(path.join(dir, 'foundation-report.json'), JSON.stringify(report, null, 2) + '\n');
    else fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
