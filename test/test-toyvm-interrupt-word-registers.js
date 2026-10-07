'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const isa = require('../tools/toyvm/isa');
const { DosSession } = require('../tools/toyvm/dos-loop');

// Exercise the real interrupt adapter, including its IRET, with nonzero
// upper halves. VM.set is intentionally a masked initialization API.
function adapterContract() {
  const values = Object.fromEntries(isa.REG16.map((r, i) => [r, (0x12340000 + i * 0x10000) | 0x200]));
  Object.assign(values, { ss: 0, cs: 0xf000, gip: 0x21, flags: 0 });
  const mem = new Uint8Array(1 << 20);
  mem.set([0x34, 0x12, 0x40, 0x05, 0x02, 0x02], 0x200);
  const vm = {
    mem, get: r => r === 'sp' ? values[r] >>> 0 : values[r] & 0xffff,
    raw: r => values[r], set: (r, v) => { values[r] = r === 'sp' ? v : v & 0xffff; },
    exports: Object.fromEntries(isa.REG16.map(r => ['set_' + r, v => { values[r] = v; }])),
  };
  const before = { ...values };
  let called = 0;
  const session = { vm, ints: 0, hooks: {}, machine: { service(vec, r) {
    called++; assert.equal(vec, 0x21);
    for (const name of isa.REG16.filter(n => n !== 'sp')) r.set(name, 0xbeef);
    r.setResultCf(true); return true;
  } } };
  DosSession.prototype.serviceInterrupt.call(session);
  assert.equal(called, 1);
  for (const name of isa.REG16) {
    assert.equal(values[name] >>> 16, before[name] >>> 16, name + ' upper half preserved');
    assert.equal(values[name] & 0xffff, name === 'sp' ? 0x206 : 0xbeef, name + ' low word');
  }
  assert.equal(values.cs, 0x540); assert.equal(values.gip, 0x1234);
  assert.equal(values.flags, 0x203);
  console.log('PASS real interrupt adapter preserves GP upper halves and IRET ESP');
}

async function nativeContract() {
  const { runDos } = require('../tools/toyvm/run-dos');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-int-word-'));
  try {
    // DOS create; free-space product in EAX; save only AX/DX across seek,
    // as a 386 real-mode extender does. No installer bytes or capacity tweak.
    const b = Buffer.from([
      0xba,0x80,0x01, 0x31,0xc9, 0xb4,0x5a,0xcd,0x21, 0xa3,0x90,0x01,
      0x66,0x31,0xc0, 0x66,0x31,0xdb, 0x66,0x31,0xc9,
      0xb2,3,0xb4,0x36,0xcd,0x21, 0x66,0xf7,0xe1,0x66,0xf7,0xe3,
      0x66,0xba,0,0,0,0xe0, 0x50,0x52, 0x8b,0x1e,0x90,0x01,
      0xb8,2,0x42,0x31,0xc9,0x31,0xd2,0xcd,0x21,
      0x51,0x52,0x66,0x59,0x5a,0x58,0x66,0x03,0xc1,
      0x66,0xa3,0,3, 0x66,0x89,0x16,4,3, 0xb8,0,0x4c,0xcd,0x21,
    ]);
    const image = Buffer.alloc(0x94); b.copy(image); Buffer.from('C:\\\0').copy(image, 0x80);
    const exe = path.join(dir, 'WORDS.COM'); fs.writeFileSync(exe, image);
    const result = await runDos({ exe, variant: 'tailcall', budget: 2000000, seconds: 2, autoKey: false });
    assert.equal(result.machine.exited, true); assert.equal(result.machine.exitCode, 0);
    const at = (result.machine.pspSeg << 4) + 0x300;
    const words = new DataView(result.vm.mem.buffer);
    assert.equal(words.getUint32(at, true), 0x0f000000, 'free-space product survives AX seek return');
    assert.equal(words.getUint32(at + 4, true), 0xe0000000, 'EDX ceiling survives DX seek return');
    console.log('PASS native DOS free-space/seek sequence preserves full accounting values');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

adapterContract();
if (!process.argv.includes('--pure-js')) nativeContract().catch(e => { console.error(e); process.exitCode = 1; });
