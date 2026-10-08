'use strict';
const assert = require('node:assert/strict');
const {installTiberianPumpReceipt} = require('./tiberian-pump-receipt');
function fixture(emit) {
  const memory = {buffer: new ArrayBuffer(16384)}, v = new DataView(memory.buffer), rows = [], calls = [];
  let eax = 1, reads = 0, nameIndex = 0; const names = new Map();
  const ex = {get_eax: () => eax, get_esp: () => 0x600, get_eip: () => 0x56291b, get_current_thread_id: () => 1, guest_to_wasm: p => { reads++; return p >= 0x400000 ? 0x1200 : p; }};
  const host = Object.fromEntries(['log', 'log_api_exit'].map(n => [n, function(...args) { calls.push({n, args, receiver: this}); return 71; }]));
  const original = {...host};
  const observer = installTiberianPumpReceipt(host, () => ({exports: ex, memory, slot: 0}), emit || (r => rows.push(r)));
  function api(name, ret, args, result = 1, msg = [0x10002, 0xf, 0, 0, 0, 0, 0]) {
    if (!names.has(name)) { const p = 0x2000 + nameIndex++ * 64; names.set(name, p); new Uint8Array(memory.buffer, p, name.length).set(Buffer.from(name)); }
    [ret, ...args].forEach((w, i) => v.setUint32(0x600 + i * 4, w, true));
    const base = 0x600 + (args.length + 1) * 4; v.setUint32(base + 44, 0x58cdb5, true); v.setUint32(base + 48, 0x4de743, true);
    msg.forEach((w, i) => v.setUint32(0x900 + i * 4, w, true));
    assert.equal(host.log(names.get(name), name.length), 71); eax = result; assert.equal(host.log_api_exit(), 71);
  }
  return {observer, host, original, rows, calls, api, ex, memory, reads: () => reads};
}
const f = fixture(); f.api('PeekMessageA', 0x56292e, [0x900, 0, 0, 0, 0]); assert.equal(f.reads(), 0); f.observer.arm();
f.api('PeekMessageA', 0x56292e, [0x900, 0, 0, 0, 0]);
for (let i = 0; i < 400; i++) f.api('GetMessageA', 0x56287e, [0x900, 0, 0, 0]);
assert.equal(f.rows.filter(r => r.name === 'GetMessageA').length, 1, 'paint flood summarized');
f.api('DispatchMessageA', 0x56291b, [0x900], 0);
assert.equal(f.rows.find(r => r.name === 'DispatchMessageA').msg[1], 0xf);
f.api('PeekMessageA', 0x56292e, [0x900, 0, 0, 0, 0], 0);
const empty = f.rows.find(r => r.kind === 'first-empty'); assert(empty); assert.equal(empty.identity.frameWords[11], 0x58cdb5); assert.equal(empty.identity.frameWords[12], 0x4de743);
f.api('DestroyWindow', 0x58c976, [0x10002]); f.api('CreateDialogIndirectParamA', 0x58c99a, [0, 0x900, 0, 0x4dce30, 0]);
const final = f.observer.close(); assert.equal(final.error, null); assert(Object.values(final.counts).includes(400)); assert(f.calls.every(c => c.receiver === f.host)); assert.equal(f.calls.length, 812); assert.deepEqual(f.host, f.original);
const flood = fixture(); flood.observer.arm(); for (let i = 0; i < 5000; i++) flood.api('GetMessageA', 0x56287e, [0x900, 0, 0, 0]);
flood.api('PeekMessageA', 0x56292e, [0x900, 0, 0, 0, 0], 0); flood.api('DestroyWindow', 0x58c976, [0x10002]); flood.api('DialogBoxIndirectParamA', 0x58c9aa, [0, 0x900, 0, 0x4dce30, 0]);
const capped = flood.observer.close(); assert(capped.used.regular.capped); assert(flood.rows.some(r => r.kind === 'first-empty')); assert(flood.rows.some(r => r.kind === 'boundary-entry' && r.name === 'DestroyWindow')); assert(flood.rows.some(r => r.kind === 'boundary-entry' && r.name === 'DialogBoxIndirectParamA'));
assert(Object.values(capped.used).reduce((n, u) => n + u.bytes, 0) <= 65536); assert(Object.values(capped.used).reduce((n, u) => n + u.rows, 0) <= 96);
const fail = fixture(() => { throw Error('emit failure'); }); fail.observer.arm(); fail.api('DestroyWindow', 0x58c976, [0x10002]); assert.match(fail.observer.close().error, /emit failure/);
const clock = Date.now; let time = 1000; Date.now = () => time;
try { for (const stage of ['getter', 'translator', 'buffer']) {
  const g = fixture(); time = 1000; g.observer.arm(); g.api('DestroyWindow', 0x58c976, [0x10002]);
  if (stage === 'getter') g.ex.get_esp = () => { time += 9000; return 0x600; };
  if (stage === 'translator') g.ex.guest_to_wasm = p => { time += 9000; return p; };
  if (stage === 'buffer') Object.defineProperty(g.memory, 'buffer', {get() { time += 9000; return new ArrayBuffer(16384); }});
  g.host.log(0x2000, 13); const before = g.reads(); g.host.log_api_exit(); g.host.log(0x2000, 13); assert.equal(g.reads(), before); assert.match(g.observer.close().error, /deadline/);
} } finally { Date.now = clock; }
const throwing = {log() { throw Error('original exception'); }, log_api_exit() { return 9; }}; const o = installTiberianPumpReceipt(throwing, () => { throw Error('unarmed context'); }, () => {}); assert.throws(() => throwing.log(), /original exception/); o.close();
const newer = fixture(); const replacement = () => 8; newer.host.log = replacement; newer.observer.close(); assert.equal(newer.host.log, replacement);
console.log('PASS owning pump MSG/counts, flood/reserved empty+teardown+dialog, forward-once, errors, guards and caps');
