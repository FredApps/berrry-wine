'use strict';
const assert = require('node:assert/strict');
const { observer } = require('./observe');
function session() {
  const mem = new Uint8Array(4096); mem.set([0xff, 0xff, 0x28, 0, 0, 0x9b, 0, 0], 0x148);
  const values = { cs: 0x4b, gip: 0x200, ss: 8, ds: 8, es: 8, fs: 8, gs: 8, flags: 2 };
  return { handbacks: 1, dispatched: 2, vm: { mem, get: n => values[n], exports: {
    get_cr0: () => 0x80000011, get_gdtb: () => 0x100, get_gdtl: () => 127,
    mget_ldtb: () => 0x300, mget_ldt: () => 0x18, get_csb: () => 0x28,
    get_d32: () => 0, get_vm86: () => 0, diag_get_cr3_count: () => 1, diag_get_cr3_last: () => 0x123000,
  } } };
}
const s = session(), o = observer({ maxRecords: 1 }), saved = Buffer.from(s.vm.mem);
o.entry(s); assert.equal(o.result().rows[0].selectors.cs.descriptor.hex, 'ffff2800009b0000'); assert.equal(o.result().rows[0].lastAttemptedCr3Write, 0x123000); assert.deepEqual(Buffer.from(s.vm.mem), saved);
o.entry(s); assert.equal(o.result().rows.length, 1);
s.vm.exports.diag_get_cr3_count = () => 2; o.entry(s); assert.equal(o.result().capped, true);
const bad = session(); bad.vm.exports.get_gdtb = () => 0xfffffff0;
const b = observer(); b.entry(bad); assert.equal(b.result().rows[0].selectors.cs.descriptor.valid, false);
const promise = Promise.resolve(7), args = [{ exact: true }]; let receiver;
const proto = { step(...a) { receiver = this; assert.deepEqual(a, args); return promise; } };
const x = observer(), cleanup = x.install(proto), instance = Object.assign(Object.create(proto), session());
assert.equal(instance.step(...args), promise); assert.equal(receiver, instance); assert.equal(cleanup(), true);
const error = Error('original'); proto.step = () => { throw error; }; const cleanThrow = x.install(proto); assert.throws(() => instance.step(), e => e === error); cleanThrow();
const foreign = () => 9, cleanForeign = x.install(proto); proto.step = foreign; assert.equal(cleanForeign(), false); assert.equal(proto.step, foreign);
console.log('PASS bounded passive descriptor reads, wrap rejection, cap, original receiver/args/promise/throw and foreign cleanup');

const inactive = session(); inactive.vm.exports.mget_ldt = () => 0;
const inactiveObserver = observer(); inactiveObserver.entry(inactive);
assert.deepEqual(inactiveObserver.result().rows[0].ldtBytes, { valid: false, reason: 'inactive LDTR' });
assert.throws(() => observer({ maxRecords: 100 }), /1..32/);
