'use strict';
const assert = require('node:assert/strict');
const { readGateInputs } = require('./gate-inputs');
function fixture() {
  const mem = new Uint8Array(4096);
  const set = (off, hex) => mem.set(Buffer.from(hex, 'hex'), off);
  set(0x120, '7401000400890000'); // TR23 -> TSS400, 175bytes.
  set(0x128, 'ffff0021009a0000'); // Real captured target28 descriptor.
  set(0x148, 'ad13280000ec0000'); // Real captured gate4b descriptor.
  const b = Buffer.from(mem.buffer); b.writeUInt32LE(0x12345678, 0x404); b.writeUInt16LE(0x30, 0x408);
  const values = { cs: 0x5b, ss: 0x30, sp: 0x100 };
  return { mem, get: n => values[n], exports: { get_gdtb: () => 0x100, get_gdtl: () => 255,
    mget_tr: () => 0x23, get_ssb: () => 0x600, mget_spm: () => -1 } };
}
const vm = fixture(), before = Buffer.from(vm.mem), r = readGateInputs(vm);
assert.equal(r.tr, 0x23); assert.equal(r.cplFromCs, 3); assert.equal(r.tss.base, 0x400);
assert.equal(r.tss.esp0, 0x12345678); assert.equal(r.tss.ss0, 0x30);
assert.equal(r.target.selector, 0x28); assert.equal(r.target.offset, 0x13ad); assert.equal(r.target.parameters, 0);
assert.equal(r.target.descriptor.hex, 'ffff0021009a0000'); assert.equal(r.stack.at, 0x700);
assert.deepEqual(Buffer.from(vm.mem), before, 'all memory unchanged');
const inactive = fixture(); inactive.exports.mget_tr = () => 0; assert.equal(readGateInputs(inactive).tss.valid, false);
const wrong = fixture(); wrong.mem[0x125] = 0x92; assert.equal(readGateInputs(wrong).tss.valid, false);
const truncated = fixture(); truncated.mem[0x120] = 8; truncated.mem[0x121] = 0; assert.equal(readGateInputs(truncated).tss.prefix.valid, false);
const overflow = fixture(); overflow.exports.get_gdtb = () => 0xfffffff0; assert.equal(readGateInputs(overflow).gate.valid, false);
const bounds = fixture(); bounds.exports.get_gdtl = () => 0x4e; assert.equal(readGateInputs(bounds).gate.valid, false);
const foreignTable = fixture(); foreignTable.exports.mget_tr = () => 0x27; assert.equal(readGateInputs(foreignTable).tss.valid, false);
const missing = fixture(); delete missing.exports.mget_tr; assert.throws(() => readGateInputs(missing), TypeError);
console.log('PASS raw captured gate/target layout, real TSS offsets, stack/CPL, unchanged memory and bounded invalid states');
