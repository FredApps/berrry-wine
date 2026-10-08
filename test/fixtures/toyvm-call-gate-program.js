'use strict';
// Synthetic self-checking instruction fixture, never a proprietary game.
const BLOB = 0x80000, RESULT = 0x50000, CALLER = 0x200, CALLEE = 0x400;
const d32 = n => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255];
const w16 = n => [n & 255, n >>> 8 & 255];
function descriptor(base, limit, access, flags = 0) {
  return [...w16(limit), ...w16(base), base >>> 16 & 255, access, (limit >>> 16 & 15) | flags, base >>> 24 & 255];
}
function build({ ring3 = false, parameters = 0, callForm = 'direct16', returnFault = false,
  useLdt = false, mutateCache = null, mutateData = null } = {}) {
  if (![0, 2].includes(parameters)) throw Error('bounded parameter cases0/2');
  if (!['direct16', 'direct32', 'memory16', 'memory32'].includes(callForm)) throw Error('unknown CALL form');
  const blob = Buffer.alloc(0x1000), labels = {}, fixes = [], assertions = [];
  let pos = 0;
  const emit = (...bytes) => { if (pos + bytes.length > blob.length) throw Error('fixture overflow'); blob.set(bytes, pos); pos += bytes.length; };
  const label = name => { if (name in labels) throw Error('duplicate label'); labels[name] = pos; };
  const jump = name => { emit(0xe9); fixes.push({ at: pos, name, relative: true }); emit(0, 0); };
  const store = (at, value) => emit(0x67, 0x66, 0xc7, 0x05, ...d32(at), ...d32(value));
  const check = name => { const id = assertions.length + 1; assertions.push({ id, name }); emit(0x0f, 0x85); fixes.push({ at: pos, name: 'fail' + id, relative: true }); emit(0, 0); };
  const cmpAx = (value, name) => { emit(0x3d, ...w16(value)); check(name); };
  const cmpEsp = (value, name) => { emit(0x66, 0x81, 0xfc, ...d32(value)); check(name); };
  const cmpStack = (offset, value, name) => { emit(0x36, 0x67, 0x66, 0x81, 0x7b, offset, ...d32(value)); check(name); };
  // GDT: null, code0, code3, flat data0/data3, distinct stack0/stack3, TSS, gate.
  emit(...Array(8).fill(0));
  emit(...descriptor(BLOB, 0xffff, 0x9a)); emit(...descriptor(BLOB, 0xffff, 0xfa));
  emit(...descriptor(0, 0xfffff, 0x92, 0xc0)); emit(...descriptor(0, 0xfffff, 0xf2, 0xc0));
  emit(...descriptor(0x70000, 0xffff, 0x92, 0x40)); emit(...descriptor(0x60000, 0xffff, 0xf2, 0x40));
  emit(...descriptor(BLOB + 0x80, 0x67, 0x89));
  emit(...w16(CALLEE), ...w16(8), parameters, 0xec, 0, 0); // typeC, target D=0.
  emit(...descriptor(BLOB, 0xffff, 0x9a)); // Separate invalid-target controls at48.
  if (useLdt) {
    emit(...descriptor(BLOB + 0xf40, 0x0f, 0x82));
    blob.set([...w16(CALLEE), ...w16(8), parameters, 0xec, 0, 0], 0xf48);
  }
  blob.writeUInt32LE(0x1000, 0x84); blob.writeUInt16LE(0x28, 0x88);
  pos = 0x100;
  emit(0xb8, 0x18, 0, 0x8e, 0xd8, 0x8e, 0xc0, 0x8e, 0xe0, 0x8e, 0xe8);
  emit(0xb8, 0x28, 0, 0x8e, 0xd0, 0x66, 0xbc, ...d32(0x1000));
  emit(0xb8, 0x38, 0, 0x0f, 0x00, 0xd8); // LTR AX.
  if (useLdt) emit(0xb8, 0x50, 0, 0x0f, 0x00, 0xd0); // LLDT AX.
  for (let off = 0xfe0; off <= 0x1000; off += 4) store(0x70000 + off, 0xa55aa55a);
  // Only current stack sentinel range above overlaps setup code size, not GDT.
  if (pos >= CALLER) throw Error('setup crossed caller');
  jump('caller');
  pos = CALLER; label('caller');
  store(RESULT, 1);
  if (mutateCache) {
    const descriptorOffset = { ss: 0x28, tr: 0x38, ldt: 0x50 }[mutateCache];
    if (descriptorOffset === undefined || (mutateCache === 'ldt' && !useLdt)) throw Error('invalid cached-descriptor case');
    // Actual guest stores invalidate the table entry AFTER it was loaded.
    // Cached selector metadata must remain usable until a later reload.
    store(BLOB + descriptorOffset, 0);
    store(BLOB + descriptorOffset + 4, 0);
  }
  const initialSp = ring3 ? 0x2000 : 0x1000, callerCs = ring3 ? 0x13 : 8, callerSs = ring3 ? 0x33 : 0x28;
  // Initialize the ring3 stack via ordinary guest writes as well.
  if (ring3) for (let off = 0x1fc0; off <= 0x2000; off += 4) store(0x60000 + off, 0xa55aa55a);
  for (let i = parameters - 1; i >= 0; i--) emit(0x66, 0x68, ...d32((i + 1) * 0x11111111));
  const gateSelector = useLdt ? 0x0f : 0x43;
  if (callForm.startsWith('memory')) {
    // CS-relative pointer is original fixture data, not a host-injected gate.
    blob.writeUInt32LE(0x4567, 0xf00);
    blob.writeUInt16LE(gateSelector, callForm === 'memory32' ? 0xf04 : 0xf02);
  }
  emit(0xf9); // STC; CALL must preserve flags.
  label('call');
  if (callForm === 'direct16') emit(0x9a, ...w16(0x4567), ...w16(gateSelector));
  if (callForm === 'direct32') emit(0x66, 0x9a, ...d32(0x4567), ...w16(gateSelector));
  if (callForm === 'memory16') emit(0x2e, 0xff, 0x1e, ...w16(0xf00));
  if (callForm === 'memory32') emit(0x66, 0x2e, 0xff, 0x1e, ...w16(0xf00));
  label('returned');
  emit(0x0f, 0x92, 0xc0, 0x66, 0x0f, 0xb6, 0xc0); cmpAx(1, 'RETF preserves carry');
  emit(0x8c, 0xc8); cmpAx(callerCs, 'return CS');
  emit(0x8c, 0xd0); cmpAx(callerSs, 'return SS'); cmpEsp(initialSp, 'return ESP with parameters released');
  if (mutateData) {
    if (!ring3 || !['retain', 'clear'].includes(mutateData)) throw Error('invalid data-cache case');
    emit(0x8c, 0xe0); cmpAx(mutateData === 'clear' ? 0 : 0x23, 'cached FS access after outer RETF');
    emit(0x8c, 0xe8); cmpAx(mutateData === 'clear' ? 0 : 0x23, 'cached GS access after outer RETF');
  }
  store(RESULT, 3); jump('exit');
  if (pos >= CALLEE) throw Error('caller crossed callee');
  pos = CALLEE; label('callee'); store(RESULT, 2);
  // SETC/MOVZX observe CF without overwriting the below-frame sentinel, unlike
  // PUSHFD/POP used by the original negative-only fixture.
  emit(0x0f, 0x92, 0xc0, 0x66, 0x0f, 0xb6, 0xc0); cmpAx(1, 'CALL preserves carry');
  emit(0x8c, 0xc8); cmpAx(8, 'gate loads target code selector');
  emit(0x8c, 0xd0); cmpAx(0x28, 'callee SS');
  const oldSp = initialSp - parameters * 4;
  const frameSp = ring3 ? 0x1000 - 16 - parameters * 4 : oldSp - 8;
  cmpEsp(frameSp, 'typeC frame uses dwords with target D0');
  emit(0x66, 0x89, 0xe3); // MOV EBX,ESP; use SS override for all frame reads.
  emit(0x36, 0x67, 0x66, 0x81, 0x7b, 0); const returnValueAt = pos; emit(0, 0, 0, 0); check('frame return offset');
  cmpStack(4, callerCs, 'frame return CS');
  cmpStack(-4, 0xa55aa55a, 'below-frame sentinel unchanged');
  emit(0x67, 0x66, 0x81, 0x3d, ...d32(0x71000), ...d32(0xa55aa55a)); check('above-stack sentinel unchanged');
  for (let i = 0; i < parameters; i++) cmpStack(8 + i * 4, (i + 1) * 0x11111111, 'parameter' + i);
  if (ring3) { cmpStack(8 + parameters * 4, oldSp, 'frame old ESP'); cmpStack(12 + parameters * 4, callerSs, 'frame old SS'); }
  if (mutateData === 'clear') {
    // Load DPL0 FS/GS, then change the table to DPL3. Hidden DPL remains0.
    emit(0xb8, 0x18, 0, 0x8e, 0xe0, 0x8e, 0xe8);
    store(BLOB + 0x1c, 0x00cff200);
  } else if (mutateData === 'retain') {
    // Existing ring3 data caches stay usable despite a DPL0 table rewrite.
    store(BLOB + 0x24, 0x00cf9200);
  }
  if (returnFault) emit(0x36, 0x67, 0xc7, 0x43, 4, 0, 0); // Guest writes a null return CS.
  emit(0xf9); label('ret');
  emit(0x66, 0xca, ...w16(parameters * 4)); // RETF32 imm, even though CS.D=0.
  for (const { id } of assertions) { label('fail' + id); store(RESULT + 4, id); jump('exit'); }
  label('exit'); emit(0xb8, 0x00, 0x4c, 0xcd, 0x21);
  for (const fix of fixes) { if (!(fix.name in labels)) throw Error('missing label'); blob.writeUInt16LE((labels[fix.name] - (fix.relative ? fix.at + 2 : 0)) & 0xffff, fix.at); }
  blob.writeUInt32LE(labels.returned, returnValueAt);
  // Genuine real-mode COM bootstrap: copy blob, LGDT, enable PE, far jump code0.
  const boot = [0xfa,0x8c,0xc8,0x8e,0xd8,0xbe,0,0,0xb8,0x00,0x80,0x8e,0xc0,0x31,0xff,0xb9,...w16(blob.length),0xf3,0xa4,
    0x2e,0x0f,0x01,0x16,0,0,0x0f,0x20,0xc0,0x66,0x83,0xc8,1,0x0f,0x22,0xc0,0xea,0x00,0x01,0x08,0x00];
  const gdtLimit = useLdt ? 0x57 : 0x4f;
  const gdtr = 0x100 + boot.length; boot.push(...w16(gdtLimit), ...d32(BLOB));
  const blobOffset = 0x100 + boot.length; boot[6] = blobOffset & 255; boot[7] = blobOffset >>> 8; boot[24] = gdtr & 255; boot[25] = gdtr >>> 8;
  return { bytes: Buffer.concat([Buffer.from(boot), blob]), assertions, ring3, parameters, callForm, blobOffset: boot.length,
    BLOB, RESULT, CALLER, CALLEE, gdtLimit, callerCs, callerSs, initialSp, frameSp, oldSp, labels };
}
module.exports = { build };
