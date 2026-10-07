'use strict';

// Actual x86 CALL/RETF, not a JS model of the implementation. The COM performs
// its own frame/parameter/register checks. CPL3 initialization is an explicit
// synthetic CPU fixture because outer IRET bootstrap is a separate missing
// contract. No proprietary executable or pre-existing game state is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('./fixtures/toyvm-call-gate-program');

const rootArg = process.argv.find(s => s.startsWith('--source-root='));
const root = rootArg ? path.resolve(rootArg.slice(14)) : path.resolve(__dirname, '..');
const { DosSession } = require(path.join(root, 'tools/toyvm/dos-loop'));
const { runDos } = require(path.join(root, 'tools/toyvm/run-dos'));
const baseOnly = process.argv.includes('--base-only');
const reportArg = process.argv.find(s => s.startsWith('--report='));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function state(vm) {
  return {
    cs: vm.get('cs'), ip: vm.get('gip'), ss: vm.get('ss'), esp: vm.get('sp'),
    csb: vm.exports.get_csb() >>> 0, ssb: vm.exports.get_ssb() >>> 0,
    d32: vm.exports.get_d32(), spm: vm.exports.mget_spm() >>> 0,
    cr0: vm.exports.get_cr0() >>> 0, gdt: vm.exports.get_gdtb() >>> 0,
    gdtLimit: vm.exports.get_gdtl() >>> 0, tr: vm.exports.mget_tr() >>> 0,
  };
}

async function one(dir, spec) {
  console.log('CASE ' + spec.name);
  const fixture = build(spec);
  if (spec.mutate) spec.mutate(fixture.bytes.subarray(fixture.blobOffset));
  const file = path.join(dir, spec.name + '.COM');
  fs.writeFileSync(file, fixture.bytes);
  const original = DosSession.prototype.step;
  let initialized = false;
  const observed = [];
  let entryState;
  let beforeCall;
  let beforeReturn;
  function wrapped(...args) {
    const vm = this.vm;
    if (!initialized && vm.get('cs') === 8 && vm.get('gip') === fixture.CALLER) {
      const initial = state(vm);
      assert.equal(initial.cr0 & 1, 1);
      assert.equal(initial.csb, fixture.BLOB);
      assert.equal(initial.d32, 0);
      assert.equal(initial.ss, 0x28);
      assert.equal(initial.ssb, 0x70000);
      assert.equal(initial.esp, 0x1000);
      assert.equal(initial.spm, 0xffffffff);
      assert.equal(initial.gdt, fixture.BLOB);
      assert.equal(initial.gdtLimit, fixture.gdtLimit);
      assert.equal(initial.tr, 0x38);
      if (spec.ring3) {
        vm.set('cs', 0x13);
        vm.set('ss', 0x33);
        vm.set('sp', 0x2000);
        for (const reg of ['ds', 'es', 'fs', 'gs']) vm.set(reg, 0x23);
      }
      entryState = state(vm);
      assert.equal(entryState.cs, fixture.callerCs);
      assert.equal(entryState.ss, fixture.callerSs);
      assert.equal(entryState.esp, fixture.initialSp);
      initialized = true;
    }
    if (initialized) {
      const now = state(vm);
      if (observed.length < 12 && (now.cs === 0x43 || (now.cs === 8 && now.ip === fixture.CALLEE))) {
        observed.push(now);
      }
      // Existing slice:1 executes one linked block at a time, not necessarily
      // one instruction. No requirement that these optional exact PCs appear.
      if (now.ip === fixture.labels.call) beforeCall = now;
      if (now.ip === fixture.labels.ret) beforeReturn = now;
    }
    return Reflect.apply(original, this, args);
  }
  DosSession.prototype.step = wrapped;
  let run;
  try {
    run = await runDos({ exe: file, budget: 20000, slice: 1, seconds: 0.5,
      autoKey: false, sound: false, log() {} });
  } finally {
    assert.equal(DosSession.prototype.step, wrapped, 'test hook was replaced');
    DosSession.prototype.step = original;
  }
  const words = new DataView(run.vm.mem.buffer, run.vm.mem.byteOffset + fixture.RESULT, 8);
  const row = { name: spec.name, initialized, entryState, observed, beforeCall, beforeReturn,
    stage: words.getUint32(0, true), checkFailed: words.getUint32(4, true),
    final: state(run.vm), stopped: run.protectedTransferStop,
    exited: run.machine.exited, exitCode: run.machine.exitCode,
    fixtureSha256: sha(fixture.bytes), moduleSha256: sha(run.vm.bytes) };
  rows.push(row);
  console.log(JSON.stringify({ case: spec.name, initialized, stage: row.stage,
    checkFailed: row.checkFailed, stopped: row.stopped, moduleSha256: row.moduleSha256 }));
  assert.equal(initialized, true, spec.name + ': checked setup');
  assert.equal(row.checkFailed, 0, spec.name + ': real guest frame assertion');
  if (!spec.stop) {
    assert(observed.some(s => s.cs === 8 && s.ip === fixture.CALLEE && s.csb === fixture.BLOB),
      spec.name + ': actual gate must enter code selector08/base80000/offset0400, not raw gate selector43');
    assert.equal(row.stage, 3, spec.name + ': real CALL/frame/RETF completion');
    assert.equal(row.exited, true);
    assert.equal(row.exitCode, 0);
    assert.equal(row.stopped, null);
    // The COM checked SS/ESP before its terminating INT21; the host may keep
    // the software-interrupt frame after DOS exit, so do not mislabel it RETF.
  } else {
    assert.equal(row.exited, false, spec.name + ': no fabricated guest success');
    assert.equal(row.stopped?.reasonName, spec.stop);
    assert.equal(row.stopped.exceptionDelivered, false);
    assert.equal(row.stage, spec.returnFault ? 2 : 1);
    assert.equal(row.final.cs, spec.returnFault ? 8 : fixture.callerCs);
    assert.equal(row.final.ss, spec.returnFault ? 0x28 : fixture.callerSs);
    assert.equal(row.final.esp, spec.returnFault ? fixture.frameSp : fixture.oldSp);
    if (!spec.returnFault) {
      // No return frame was partly pushed on either stack after validation
      // failed. The caller's parameters are the only legitimate changed bytes.
      const mem = new DataView(run.vm.mem.buffer, run.vm.mem.byteOffset);
      for (let off = 0xfe0; off <= 0x1000; off += 4) {
        assert.equal(mem.getUint32(0x70000 + off, true), 0xa55aa55a,
          spec.name + ': failed gate leaves destination stack untouched');
      }
      for (let i = 0; i < fixture.parameters; i++) {
        assert.equal(mem.getUint32(0x60000 + fixture.oldSp + i * 4, true), (i + 1) * 0x11111111);
      }
    }
  }
}

const rows = [];
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-call-gates-'));
  try {
    for (const callForm of baseOnly ? ['direct16'] : ['direct16', 'direct32', 'memory16', 'memory32']) {
      for (const ring3 of [false, true]) for (const parameters of [0, 2]) {
        await one(dir, { name: `${callForm}-${ring3 ? 'ring3' : 'same'}-${parameters}`, callForm, ring3, parameters });
        if (global.gc) global.gc();
      }
    }
    if (!baseOnly) {
      await one(dir, { name: 'ldt-gate', ring3: true, parameters: 2, useLdt: true });
      await one(dir, { name: 'ldt-cache-after-table-write', ring3: true, parameters: 2, useLdt: true, mutateCache: 'ldt' });
      await one(dir, { name: 'ss-cache-after-table-write', ring3: false, parameters: 2, mutateCache: 'ss' });
      await one(dir, { name: 'tr-cache-after-table-write', ring3: true, parameters: 2, mutateCache: 'tr' });
      const rejected = [
        ['gate-not-present', 'notPresent', b => { b[0x45] = 0x6c; }],
        ['gate-privilege', 'privilege', b => { b[0x45] = 0x8c; }],
        ['target-data', 'type', b => { b.writeUInt16LE(0x48, 0x42); b[0x4d] = 0x92; }],
        ['target-not-present', 'notPresent', b => { b.writeUInt16LE(0x48, 0x42); b[0x4d] = 0x1a; }],
        ['target-limit', 'targetLimit', b => { b.writeUInt16LE(1, 0x46); }],
        ['tss-limit', 'tss', b => { b.writeUInt16LE(4, 0x38); }],
        ['tss-stack-privilege', 'stack', b => { b.writeUInt16LE(0x33, 0x88); }],
        ['new-stack-too-small', 'stack', b => { b.writeUInt32LE(8, 0x84); }],
        ['parameter-span', 'stack', b => { b.writeUInt16LE(0x1ffb, 0x30); }],
      ];
      for (const [name, stop, mutate] of rejected) await one(dir, { name, stop, mutate, ring3: true, parameters: 2 });
      for (const ring3 of [false, true]) await one(dir, {
        name: `retf-null-${ring3 ? 'outer' : 'same'}`, ring3, parameters: 2, returnFault: true, stop: 'descriptor',
      });
    }
    console.log(`PASS ${rows.length} actual CALL gate / RETF cases`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (reportArg) fs.writeFileSync(reportArg.slice(9), JSON.stringify({ root, rows,
      sourceClosure: Object.keys(require.cache).filter(p => p.startsWith(root + path.sep)).sort()
        .map(p => ({ path: path.relative(root, p), sha256: sha(fs.readFileSync(p)) })),
      scope: 'Actual instruction contracts; CPL3 initial fixture state synthetic; rejected transfers stop without delivering a PM exception.' }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
