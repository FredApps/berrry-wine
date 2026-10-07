'use strict';
// Bounded raw host-memory observation. No guest function calls or setters.
function readGateInputs(vm) {
  const ex = vm.exports, mem = vm.mem;
  const read = (at, n) => {
    if (!Number.isSafeInteger(at) || at < 0 || at > 0xffffffff || !Number.isInteger(n) || n < 0 || n > 256 || at + n > mem.byteLength)
      return { at, n, valid: false, reason: 'unmapped/overflowed span; no diagnostic wrap' };
    return { at, n, valid: true, hex: Buffer.from(mem.subarray(at, at + n)).toString('hex') };
  };
  const gdt = ex.get_gdtb() >>> 0, limit = ex.get_gdtl() >>> 0;
  const descriptor = selector => {
    const offset = selector & 0xfff8;
    if ((selector & 4) || !offset || offset + 7 > limit)
      return { valid: false, reason: 'not a bounded non-null GDT selector', selector };
    return { selector, ...read(gdt + offset, 8) };
  };
  const tr = ex.mget_tr() >>> 0, trDescriptor = descriptor(tr);
  let tss = { valid: false, reason: 'TR descriptor unavailable' };
  if (trDescriptor.valid) {
    const b = Buffer.from(trDescriptor.hex, 'hex'), access = b[5];
    if ((access & 0x90) !== 0x80 || ![9, 11].includes(access & 15)) tss = { valid: false, reason: 'not present 32-bit TSS descriptor', access };
    else {
      const base = (b.readUInt16LE(2) + b[4] * 65536 + b[7] * 16777216) >>> 0;
      const rawLimit = b.readUInt16LE(0) + ((b[6] & 15) << 16);
      const byteLimit = b[6] & 128 ? rawLimit * 4096 + 4095 : rawLimit;
      const prefix = byteLimit >= 31 ? read(base, 32) : { valid: false, reason: 'TSS limit shorter than 32-byte capture', byteLimit };
      tss = { base, byteLimit, prefix, valid: prefix.valid };
      if (prefix.valid) { const bytes = Buffer.from(prefix.hex, 'hex'); tss.esp0 = bytes.readUInt32LE(4); tss.ss0 = bytes.readUInt16LE(8); tss.ss0Descriptor = descriptor(tss.ss0); }
    }
  }
  const ss = vm.get('ss') >>> 0, esp = vm.get('sp') >>> 0;
  const stackBase = ex.get_ssb() >>> 0, stackMask = ex.mget_spm() >>> 0;
  const stackOffset = (esp & stackMask) >>> 0;
  const gate = descriptor(0x4b);
  let target = { valid: false, reason: 'observed gate selector4b unavailable' };
  if (gate.valid) {
    const b = Buffer.from(gate.hex, 'hex');
    if ((b[5] & 0x9f) === 0x8c) target = { selector: b.readUInt16LE(2), offset: (b.readUInt16LE(0) + b.readUInt16LE(6) * 65536) >>> 0,
      parameters: b[4] & 31, descriptor: descriptor(b.readUInt16LE(2)), valid: true };
    else target = { valid: false, reason: 'not a present typeC system gate', access: b[5] };
  }
  return { meaning: 'pre-step raw inputs; no instruction checkpoint or descriptor-validity endorsement',
    cs: vm.get('cs') >>> 0, cplFromCs: vm.get('cs') & 3, tr, trDescriptor, tss,
    ss, esp, stackBase, stackMask, stack: read(stackBase + stackOffset, 64), gate, target };
}
module.exports = { readGateInputs };
