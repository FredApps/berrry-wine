'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { build } = require('./program');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
async function main() {
  const [root, out, mode] = process.argv.slice(2);
  if (!root || !out || !['before', 'candidate'].includes(mode) || !process.argv.includes('--slot-granted') || fs.existsSync(out)) throw Error('contract.js source-root fresh-output before|candidate --slot-granted');
  fs.mkdirSync(out, { recursive: true });
  const { DosSession } = require(path.join(root, 'tools/toyvm/dos-loop'));
  const { runDos } = require(path.join(root, 'tools/toyvm/run-dos'));
  const rows = [], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-call-gate-'));
  try {
    for (const ring3 of [false, true]) for (const parameters of [0, 2]) {
      const program = build({ ring3, parameters }), name = (ring3 ? 'ring3' : 'same-cpl') + '-params' + parameters;
      const file = path.join(dir, name + '.COM'); fs.writeFileSync(file, program.bytes);
      const original = DosSession.prototype.step; let initialized = false, initial, switched, gateDescriptor, expectedMisdecodeBase, observed = [], run, failure;
      const state = vm => ({ cs: vm.get('cs'), ip: vm.get('gip'), ss: vm.get('ss'), esp: vm.get('sp'),
        csb: vm.exports.get_csb() >>> 0, ssb: vm.exports.get_ssb() >>> 0,
        d32: vm.exports.get_d32(), spm: vm.exports.mget_spm() >>> 0,
        cr0: vm.exports.get_cr0() >>> 0, gdt: vm.exports.get_gdtb() >>> 0,
        gdtLimit: vm.exports.get_gdtl() >>> 0, tr: vm.exports.mget_tr() >>> 0 });
      function wrapped(...args) {
        const vm = this.vm;
        if (!initialized && vm.get('cs') === 8 && vm.get('gip') === program.CALLER) {
          initial = state(vm);
          assert.equal(initial.cr0 & 1, 1); assert.equal(initial.csb, program.BLOB); assert.equal(initial.d32, 0);
          assert.equal(initial.ss, 0x28); assert.equal(initial.ssb, 0x70000); assert.equal(initial.esp, 0x1000); assert.equal(initial.spm, 0xffffffff);
          assert.equal(initial.gdt, program.BLOB); assert.equal(initial.gdtLimit, 0x47); assert.equal(initial.tr, 0x38);
          const gate = Buffer.from(vm.mem.subarray(program.BLOB + 0x40, program.BLOB + 0x48));
          assert.deepEqual(gate, Buffer.from([0x00,0x04,0x08,0x00,parameters,0xec,0x00,0x00]), 'exact original gate bytes');
          gateDescriptor = gate.toString('hex');
          assert.equal(gate.readUInt16LE(2), 8, 'proper target code selector');
          assert.equal(gate.readUInt16LE(0) + gate.readUInt16LE(6) * 65536, program.CALLEE, 'proper target offset');
          expectedMisdecodeBase = (gate.readUInt16LE(2) + gate[4] * 65536 + gate[7] * 16777216) >>> 0;
          if (ring3) {
            // Synthetic UNIT FIXTURE initial architectural context only. This
            // does not claim guest-only CPL3 bootstrap or exercise IRET setup.
            vm.set('cs', 0x13); vm.set('ss', 0x33); vm.set('sp', 0x2000);
            for (const r of ['ds', 'es', 'fs', 'gs']) vm.set(r, 0x23);
          }
          switched = state(vm);
          assert.equal(switched.cs, program.callerCs); assert.equal(switched.ss, program.callerSs);
          assert.equal(switched.esp, program.initialSp); assert.equal(switched.ssb, ring3 ? 0x60000 : 0x70000);
          assert.equal(switched.csb, program.BLOB); assert.equal(switched.d32, 0); assert.equal(switched.spm, 0xffffffff);
          initialized = true;
        }
        if (initialized && observed.length < 8 && ((vm.get('cs') === 0x43) || (vm.get('cs') === 8 && vm.get('gip') === program.CALLEE))) {
          const value = state(vm); if (!observed.some(r => r.cs === value.cs && r.ip === value.ip)) observed.push(value);
        }
        return Reflect.apply(original, this, args);
      }
      DosSession.prototype.step = wrapped;
      try { run = await runDos({ exe: file, budget: 20000, slice: 1, seconds: 0.3, autoKey: false, sound: false, log() {} }); }
      catch (e) { failure = String(e.stack || e); }
      finally { if (DosSession.prototype.step !== wrapped) throw Error('foreign test wrapper replacement'); DosSession.prototype.step = original; }
      const fields = run ? Buffer.from(run.vm.mem.buffer, run.vm.mem.byteOffset + program.RESULT, 8) : null;
      const row = { name, ring3, parameters, initialized, initial, switched, gateDescriptor, expectedMisdecodeBase, expectedProperTarget: { cs: 8, csb: program.BLOB, ip: program.CALLEE }, observed, failure,
        stage: fields?.readUInt32LE(0), checkFailed: fields?.readUInt32LE(4), assertions: program.assertions,
        exited: run?.machine.exited, exitCode: run?.machine.exitCode, moduleSha256: run && sha(run.vm.bytes), fixtureSha256: sha(program.bytes) };
      rows.push(row); fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(row, null, 2));
      assert.equal(failure, undefined, 'harness/runtime error is not expected CPU negative');
      assert.equal(initialized, true, 'real COM setup must reach checked initial context');
      if (mode === 'before') {
        assert.equal(row.stage, 1, 'guest reached real CALL and has not entered callee');
        assert.equal(row.checkFailed, 0);
        assert(observed.some(r => r.cs === 0x43 && r.csb === expectedMisdecodeBase && r.ip === 0x4567), 'negative must be actual wrong gate target, not setup/time budget');
      } else {
        assert.equal(row.checkFailed, 0, 'guest self-check failed'); assert.equal(row.stage, 3, 'actual CALL/frame/RETF checks complete');
        assert.equal(row.exited, true); assert.equal(row.exitCode, 0);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({ mode, rows, at: new Date().toISOString(), temporaryFixtureRemoved: !fs.existsSync(dir),
      scope: 'self-checking real CALL/RETF instructions; ring3 initial context synthetic; no game or IRET-bootstrap claim',
      sourceClosure: Object.keys(require.cache).filter(p => p.startsWith(root + path.sep)).sort().map(p => ({ path: path.relative(root,p), sha256: sha(fs.readFileSync(p)) })) }, null, 2));
  }
  console.log('PASS ' + mode + ': four real instruction cases; mode distinguishes actual CPU negative from harness failure');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
