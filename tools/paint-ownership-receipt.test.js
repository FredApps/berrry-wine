'use strict';
const assert = require('node:assert/strict');
const {installPaintOwnershipReceipt, readPaintDamage} = require('./paint-ownership-receipt');
function fixture(emit) {
  const memory = {buffer: new ArrayBuffer(16384)}, view = new DataView(memory.buffer), rows = [], calls = [], names = new Map();
  let esp = 0x600, eax = 0, tid = 1, damage = {update: 1, paint: 1, rect: [3, 4, 12, 15]};
  const ex = {get_esp: () => esp, get_eax: () => eax, get_eip: () => 0x400800, get_current_thread_id: () => tid, guest_to_wasm: p => p >= 0x400000 ? 0x1000 : p};
  const host = Object.fromEntries(['log', 'log_api_exit', 'invalidate'].map(n => [n, function(...args) { calls.push({n, args, receiver: this}); return 71; }]));
  const original = {...host};
  const observer = installPaintOwnershipReceipt(host, () => ({exports: ex, memory, slot: 0}), () => structuredClone(damage), emit || (r => rows.push(r)));
  function entry(name, args, address = 0x600) {
    esp = address;
    if (!names.has(name)) { const p = 0x2000 + names.size * 64; names.set(name, p); new Uint8Array(memory.buffer, p, name.length).set(Buffer.from(name)); }
    [0x400810, ...args].forEach((n, i) => view.setUint32(esp + i * 4, n, true));
    assert.equal(host.log(names.get(name), name.length), 71);
  }
  function exit(result = 0) { eax = result; assert.equal(host.log_api_exit(), 71); }
  return {observer, host, original, rows, calls, entry, exit, ex, memory,
    damage: d => { damage = d; }, thread: t => { tid = t; }};
}
const f = fixture(); f.entry('BeginPaint', [0x10002, 0x900]); f.exit(); assert.equal(f.rows.length, 0);
f.observer.arm(0x10002);
f.entry('CallWindowProcA', [0xffff0004, 0x10002, 0xf, 0, 0]);
f.entry('BeginPaint', [0x10002, 0x900], 0x500);
f.damage({update: 0, paint: 0, rect: [0, 0, 0, 0]}); f.exit(7);
f.entry('InvalidateRect', [0x10002, 0, 0], 0x500);
f.damage({update: 1, paint: 1, rect: [8, 9, 10, 11]}); f.exit(1);
f.entry('EndPaint', [0x10002, 0x900], 0x500); f.exit(1); f.exit(0);
const marker = f.rows.find(r => r.kind === 'entry' && r.name === 'CallWindowProcA');
for (const r of f.rows.filter(r => r.kind === 'entry' && r.name !== 'CallWindowProcA')) assert.equal(r.parent, marker.id);
const begin = f.rows.find(r => r.kind === 'handler-exit' && r.name === 'BeginPaint');
assert.equal(begin.before.update, 1); assert.equal(begin.after.update, 0);
const end = f.rows.find(r => r.kind === 'handler-exit' && r.name === 'EndPaint');
assert.deepEqual(end.after.rect, [8, 9, 10, 11], 'new invalidation survives EndPaint');
const native = f.rows.find(r => r.kind === 'handler-exit' && r.name === 'CallWindowProcA');
assert.equal(native.after.update, 1); assert.match(native.dlgprocHandled, /unknown/);
assert.match(native.callbackReturn, /unmeasured/);
const receipt = f.observer.close(); assert.equal(receipt.error, null); assert.deepEqual(receipt.pending, []); assert.deepEqual(f.host, f.original);
assert(f.calls.every(c => c.receiver === f.host)); assert.equal(f.calls.length, 10);
assert.throws(() => f.observer.arm(0x10002), /single arm/);
const retained = fixture(); retained.observer.arm(0x10002);
retained.entry('CallWindowProcA', [0x400a00, 0x10002, 0xf, 0, 0]); retained.exit();
assert.equal(retained.rows[1].after.update, 1, 'guest redirection never invents validation'); retained.observer.close();
const interleave = fixture(); interleave.observer.arm(0x10002);
interleave.entry('CallWindowProcW', [0xffff0004, 0x10002, 0xf, 0, 0]);
interleave.entry('BeginPaint', [0x10003, 0x900], 0x500); interleave.exit(); interleave.exit();
assert.equal(interleave.rows.length, 2, 'non-target nested frame cannot consume outer ownership'); assert.equal(interleave.observer.close().error, null);
const switched = fixture(); switched.observer.arm(0x10002); switched.entry('BeginPaint', [0x10002, 0x900]); switched.thread(2); switched.exit();
assert.match(switched.observer.close().error, /owning context/);
const thrown = fixture(() => { throw Error('collector failed'); }); thrown.observer.arm(0x10002); thrown.entry('BeginPaint', [0x10002, 0x900]);
assert.match(thrown.observer.close().error, /collector failed/); assert.deepEqual(thrown.host, thrown.original);
const trap = fixture(); trap.observer.arm(0x10002); trap.entry('BeginPaint', [0x10002, 0x900]);
const finalTrap = trap.observer.close(); assert.equal(finalTrap.pending.length, 1, 'guest trap preserves pending owning evidence');
let forwards = 0;
const throwingHost = {log() { forwards++; throw Error('original guest trap'); }, log_api_exit() { return 9; }, invalidate() {}};
const throwingOriginal = {...throwingHost};
const throwingObserver = installPaintOwnershipReceipt(throwingHost, () => { throw Error('unarmed getter forbidden'); }, () => {}, () => {});
assert.throws(() => throwingHost.log(), /original guest trap/); assert.equal(forwards, 1);
assert.match(throwingObserver.close().error, /original import trap/); assert.deepEqual(throwingHost, throwingOriginal);
const flood = fixture(); flood.observer.arm(0x10002);
for (let i = 0; i < 15000; i++) { flood.entry('BeginPaint', [0x10002, 0x900]); flood.exit(); }
const limited = flood.observer.close(); assert(limited.capped); assert(limited.bytes <= 65536); assert(limited.rows <= 96); assert(limited.hookCount <= 20001);
const now = Date.now; let time = 1000;
try {
  Date.now = () => time; const expired = fixture(); expired.observer.arm(0x10002); time += 9000;
  expired.entry('BeginPaint', [0x10002, 0x900]); expired.exit(); assert.equal(expired.rows.length, 0); assert.equal(expired.observer.close().capped, 'deadline');
} finally { Date.now = now; }
// Direct region reader must report empty-but-flagged damage without repairing it.
const buf = new ArrayBuffer(4096), v = new DataView(buf), regions = {WND_RECORDS: {base: 256, size: 48}, UPDATE_RECT: {base: 512}, UPDATE_FLAGS: {base: 600}, PAINT_FLAGS: {base: 700}};
v.setUint32(280, 0x10002, true); v.setUint8(601, 1); v.setUint8(701, 1);
const before = new Uint8Array(buf).slice();
assert.deepEqual(readPaintDamage({}, 0x10002, (p, n) => new Uint8Array(buf).slice(p, p + n), regions), {slot: 1, update: 1, paint: 1, rect: [0, 0, 0, 0]});
assert.deepEqual(new Uint8Array(buf), before); assert.deepEqual(readPaintDamage({}, 9, (p, n) => new Uint8Array(buf).slice(p, p + n), regions), {destroyed: true});
console.log('PASS paint ownership, nested frames, retained/renewed damage, zero-result ambiguity, trap preservation, forwarding and budgets');

const writer=fixture();writer.observer.arm(0x10002);
writer.entry('CallWindowProcA',[0xffff0004,0x10002,0xf,0,0]);
for(let i=0;i<21000;i++)writer.host.log(0x2000,15);
writer.damage({update:1,paint:1,rect:[0,0,299,202]});
assert.equal(writer.host.invalidate.call(writer.host,0x10002,123),71);
const w=writer.rows.find(r=>r.kind==='writer');assert(w,'reserved writer survives broad flood');assert.equal(w.target,0x10002);assert.equal(w.parent[0].name,'CallWindowProcA');assert.equal(w.stack.length,24);assert.deepEqual(w.damage.rect,[0,0,299,202]);
writer.host.invalidate(0x10003);assert(writer.rows.some(r=>r.kind==='writer'&&r.target===0x10003));
for(let i=0;i<100;i++)writer.host.invalidate(0x10002);
const wr=writer.observer.close();assert(wr.writer.writerCount<=64);assert(wr.writer.writerBytes<=32768);assert.equal(wr.writer.writerError,null);assert.deepEqual(writer.host,writer.original);
console.log('PASS reserved invalidate writer ownership, alternate target, forwarding and independent flood limits');
