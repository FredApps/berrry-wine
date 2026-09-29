#!/usr/bin/env node
'use strict';
// Independent Glide 2 ABI/layout and ordered transport checks. The host is
// deliberately a byte recorder, so a shared renderer mistake cannot pass.
const assert = require('assert');
const { compileSrcWasm } = require('./compile-src');
const regions = require('../lib/region-map.generated');
const table = require('../src/api_table.json');
const bytes = compileSrcWasm((file, source) => file === '09a8h-glide.wat'
  ? source + '\n(export "glide_test_dispatch" (func $dispatch_api_table))\n'
    + '(export "glide_test_lookup" (func $lookup_api_id))\n'
    + '(export "glide_test_coordinate" (func $glide_coordinate))\n' : source);
const module_ = new WebAssembly.Module(bytes);
const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
const imports = {host: {memory}};
for (const imp of WebAssembly.Module.imports(module_)) {
  if (imp.kind === 'function') (imports[imp.module] ||= {})[imp.name] = () => 0;
}
const submissions = [];
let ticks = 0, rejectBatch = false, rejectOpen = false;
const windowRects = new Map([[1, [15, 25, 815, 625]]]);
const moves = [];
imports.host.foreground_window = () => 1;
imports.host.get_window_rect = (hwnd, ptr) => {
  const dv = new DataView(memory.buffer);
  (windowRects.get(hwnd) || [0, 0, 0, 0]).forEach((v, i) => dv.setInt32(ptr + i * 4, v, true));
};
imports.host.move_window = (hwnd, x, y, w, h) => {
  assert(windowRects.has(hwnd), 'must not move a phantom HWND');
  moves.push([hwnd, x, y, w, h]);
  windowRects.set(hwnd, [x, y, x + w, y + h]);
};
imports.host.get_ticks = () => ticks;
imports.host.glide_submit = (op, ptr, len) => {
  const packet = new Uint8Array(memory.buffer, ptr, len);
  submissions.push({op, bytes: Buffer.from(packet)});
  if (op === 9) packet.fill(0x5a, 20);
  if (op === 0 && rejectBatch) return 0;
  if (op === 1 && rejectOpen) return 0;
  return 1;
};
const a = new WebAssembly.Instance(module_, imports).exports;
const b = new WebAssembly.Instance(module_, imports).exports;
a.init_thread(0, 0x400000, 0, 0, 0, 0, 0);
b.init_thread(1, 0x400000, 0, 0, 0, 0, 0);
a.heap_init(0x420000);
for (const [input, expected] of [
  [-2048, -2048], [-0.5, -0.5], [0, 0], [589.8125, 589.8125],
  [2047.9375, 2047.9375], [784383.9375, 784383.9375],
  [784384, -2048], [786432, 0], [788479.9375, 2047.9375], [788480, 788480],
]) assert.strictEqual(a.glide_test_coordinate(input), expected, 'bounded snap coordinate ' + input);
const view = new DataView(memory.buffer);
const stack = regions.BASE.GUEST_STACK + 0x1000;
const stackGuest = (stack - regions.BASE.GUEST_BASE + 0x400000) >>> 0;
const wa = p => a.guest_to_wasm(p) >>> 0;
// Allocate the second virtual page AFTER an unrelated page so a single raw
// translation cannot accidentally pass a crossing-structure test.
const sparseBase = 0x38000000, sparseNeighbor = sparseBase + 0x10000;
for (const p of [sparseBase, sparseNeighbor, sparseBase + 4096])
  a.test_virtual_map_commit(p, 4096);
assert.notStrictEqual(wa(sparseBase + 4096), wa(sparseBase) + 4096,
  'Glide ABI fixture must cross physically noncontiguous guest pages');
const readGuest = (p, n) => Buffer.from(Array.from({length: n}, (_, i) => a.guest_read8(p + i)));
const fillGuest = (p, n, value) => {
  for (let i = 0; i < n; ++i) a.guest_write8(p + i, value);
};
fillGuest(sparseNeighbor, 4096, 0xa7);
function sparseGuards(p, n) {
  assert.deepStrictEqual(readGuest(p - 4, 4), Buffer.alloc(4, 0xcc), 'leading output guard');
  assert.deepStrictEqual(readGuest(p + n, 4), Buffer.alloc(4, 0xcc), 'trailing output guard');
  assert.deepStrictEqual(readGuest(sparseNeighbor, 4096), Buffer.alloc(4096, 0xa7),
    'unrelated physical backing is unchanged');
  assert.strictEqual(a.guest_span_cursor_bytes(), 0, 'sparse output span is released');
}
function call(name, args = [], instance = a) {
  const api = table.find(x => x.name === name);
  assert(api, name);
  instance.set_esp(stackGuest);
  args.forEach((v, i) => view.setUint32(stack + 4 + i * 4, v >>> 0, true));
  instance.glide_test_dispatch(api.id, ...Array.from({length: 5}, (_, i) => args[i] || 0), 0);
  assert.strictEqual(instance.get_esp() >>> 0, stackGuest + 4 + api.nargs * 4,
    name + ' consumes exactly the decorated stdcall frame');
  return instance.get_eax() >>> 0;
}
for (const name of ['_grGlideInit@0', '_grSstWinOpen@28', '_grLfbLock@24', '_grTexCombine@28']) {
  const p = wa(0x410000);
  new Uint8Array(memory.buffer, p, name.length + 1).set(Buffer.from(name + '\0'));
  assert.strictEqual(a.glide_test_lookup(p), table.find(x => x.name === name).id);
}
call('_grGlideInit@0');
call('_grSstQueryHardware@4', [0x410ffc]);
assert.strictEqual(view.getUint32(wa(0x410ffc), true), 1, 'one board');
assert.strictEqual(view.getUint32(wa(0x41100c), true), 1, 'one advertised TMU');
// Independent SDK GrHwConfiguration bytes: one Voodoo board, four MiB FBI,
// revision 2, one TMU, no SLI, revision 1 / four MiB TMU, other boards zero.
const hardware = Buffer.alloc(148);
for (const [offset, value] of [[0, 1], [8, 4], [12, 2], [16, 1], [24, 1], [28, 4]])
  hardware.writeUInt32LE(value, offset);
for (const p of [sparseBase + 4094, sparseBase + 4072]) {
  fillGuest(p - 4, 156, 0xcc);
  assert.strictEqual(call('_grSstQueryHardware@4', [p]), 1);
  assert.deepStrictEqual(readGuest(p, 148), hardware, 'complete sparse hardware configuration');
  sparseGuards(p, 148);
}
const dxState = regions.BASE.DX_PROCESS_STATE;
const savedDisplay = Buffer.alloc(32);
[800, 600, 32, 1, 0, 0, 0, 0].forEach((v, i) => savedDisplay.writeUInt32LE(v, i * 4));
new Uint8Array(memory.buffer, dxState, 32).set(savedDisplay);
assert.strictEqual(call('_grSstWinOpen@28', [0, 7, 0, 0, 0, 2, 1]), 1);
assert.strictEqual(b.get_display_fullscreen(), 1, 'fullscreen state is process-shared');
assert.strictEqual(b.get_dx_exclusive_hwnd(), 1, 'zero HWND resolves foreground owner');
assert.deepStrictEqual(moves.at(-1), [1, 0, 0, 640, 480]);
assert.strictEqual(view.getUint32(dxState, true), 640);
assert.strictEqual(view.getUint32(dxState + 4, true), 480);
assert.strictEqual(view.getUint32(dxState + 8, true), 16);
assert.strictEqual(submissions[0].op, 1);
assert.strictEqual(submissions[0].bytes.readUInt32LE(4), 640);
assert.strictEqual(submissions[0].bytes.readUInt32LE(8), 480);
submissions.length = 0;
const vertices = 0x413fe0;
for (let i = 0; i < 45; ++i) view.setFloat32(wa(vertices + i * 4), i + 0.25, true);
call('_grColorCombine@20', [1, 0, 0, 0, 0]);
call('_grDrawTriangle@12', [vertices, vertices + 60, vertices + 120]);
call('_grColorCombine@20', [3, 1, 0, 1, 0], b);
call('_grDrawTriangle@12', [vertices, vertices + 60, vertices + 120], b);
call('_grDrawLine@8', [vertices, vertices + 60]);
call('_grDrawPoint@4', [vertices]);
assert.strictEqual(submissions.length, 0, 'setters and draws stay in WAT until barrier');
new Uint8Array(memory.buffer, wa(vertices), 180).fill(0);
call('_grBufferSwap@4', [1]);
assert.deepStrictEqual(submissions.map(s => s.op), [0, 4]);
const batch = submissions[0].bytes;
assert.strictEqual(batch.readUInt32LE(0), 5);
assert.strictEqual(batch.readUInt32LE(4), 436);
assert.strictEqual(batch.readUInt32LE(8), 1, 'first draw immutable state');
assert.strictEqual(batch.readFloatLE(8 + 256), 0.25, 'vertex copied before mutation');
assert.strictEqual(batch.readUInt32LE(444 + 8), 3, 'second WASM instance shares state/stream');
assert.strictEqual(batch.readUInt32LE(888), 11, 'line topology is preserved');
assert.strictEqual(batch.readUInt32LE(892), 376);
assert.strictEqual(batch.readUInt32LE(1272), 12, 'point topology is preserved');
assert.strictEqual(batch.readUInt32LE(1276), 316);
// The original 3dfx splash feeds this prebiased coordinate encoding directly
// to Glide. Decode its entire signed domain, not only positive screen values.
view.setUint32(wa(vertices), 0x494024dd, true); // NFS III observed: bias + 589.8125
view.setFloat32(wa(vertices + 4), 786432 - 0.5, true);
call('_grDrawLine@8', [vertices, vertices]);
call('_grBufferSwap@4', [0]);
const snapped = submissions.at(-2).bytes;
assert.strictEqual(snapped.readFloatLE(8 + 256), 589.8125);
assert.strictEqual(snapped.readFloatLE(8 + 260), -0.5);
assert.strictEqual(view.getUint32(wa(vertices), true), 0x494024dd, 'guest vertices remain untouched');
assert.strictEqual(call('_grTexCalcMemRequired@16', [8, 0, 3, 10]), 174768,
  '256-square RGB565 mip chain aligns to eight bytes');
const info = 0x416ffc;
view.setUint32(wa(info), 20, true);
assert.strictEqual(call('_grLfbLock@24', [1, 1, 0, 0, 0, info]), 1);
assert.strictEqual(view.getUint32(wa(info + 8), true), 1280);
const lfb = view.getUint32(wa(info + 4), true);
assert.strictEqual(view.getUint16(wa(lfb), true), 0x5a5a, 'ordered host readback is guest-visible');
view.setUint16(wa(lfb), 0xf800, true);
assert.strictEqual(call('_grLfbUnlock@8', [1, 1]), 1);
assert.strictEqual(submissions.at(-1).op, 10);
assert.strictEqual(submissions.at(-1).bytes.readUInt16LE(20), 0xf800);
assert.strictEqual(call('_grLfbUnlock@8', [1, 1]), 0, 'unmatched unlock is rejected');
const sparseInfo = sparseBase + 4094;
fillGuest(sparseInfo - 4, 28, 0xcc);
a.guest_write32(sparseInfo, 20);
assert.strictEqual(call('_grLfbLock@24', [0, 1, 0, 1, 0, sparseInfo]), 1);
const expectedInfo = Buffer.alloc(20);
[20, lfb, 1280, 0, 1].forEach((value, i) => expectedInfo.writeUInt32LE(value, i * 4));
assert.deepStrictEqual(readGuest(sparseInfo, 20), expectedInfo,
  'LFB size and pointer fields crossing sparse pages retain the complete SDK layout');
sparseGuards(sparseInfo, 20);
assert.strictEqual(call('_grLfbUnlock@8', [0, 1]), 1);
const pixel = 0x419ffc;
view.setUint16(wa(pixel), 0x07e0, true);
assert.strictEqual(call('_grLfbWriteRegion@32', [1, 3, 2, 0, 1, 1, 2, pixel]), 1);
assert.strictEqual(submissions.at(-1).bytes.readUInt16LE(20 + (2 * 640 + 3) * 2), 0x07e0);
assert.strictEqual(call('_grLfbReadRegion@28', [1, 3, 2, 1, 1, 2, pixel]), 1);
assert.strictEqual(view.getUint16(wa(pixel), true), 0x5a5a);
assert.strictEqual(call('_grSstVRetraceOn@0'), 0);
ticks = 16;
assert.strictEqual(call('_grSstVRetraceOn@0'), 1, 'virtual retrace advances with clock');
assert.strictEqual(call('_grSstStatus@0') & 64, 0, 'status retrace bit is active low');
assert.strictEqual(call('_grSstControl@4', [2]), 1);
call('_grBufferSwap@4', [0]);
assert.strictEqual(submissions.at(-1).bytes.readUInt32LE(244), 0, 'deactivation accompanies presentation');
const beforePendingClose = submissions.length;
call('_grBufferClear@12', [0x112233, 255, 65535]);
call('_grDrawPoint@4', [vertices]);
assert.strictEqual(submissions.length, beforePendingClose, 'commands remain pending before close');
call('_grSstWinClose@0', [], b);
assert.deepStrictEqual(Buffer.from(new Uint8Array(memory.buffer, dxState, 32)), savedDisplay,
  'close from another instance restores prior display exactly');
assert.deepStrictEqual(moves.at(-1), [1, 15, 25, 800, 600]);
const closedMoveCount = moves.length;
call('_grSstWinClose@0');
assert.strictEqual(moves.length, closedMoveCount, 'repeated close does not resize again');
const retired = submissions.slice(beforePendingClose);
assert.deepStrictEqual(retired.map(s => s.op), [0, 2], 'pending batch is consumed before close');
assert.strictEqual(retired[0].bytes.readUInt32LE(0), 3, 'queued clear remains ordered');
assert.strictEqual(retired[0].bytes.readUInt32LE(264), 0x112233, 'queued clear color is preserved');
assert.strictEqual(retired[0].bytes.readUInt32LE(276), 12, 'queued point follows the clear');
assert.strictEqual(a.guest_span_cursor_bytes(), 0, 'temporary guest spans are released');
call('_grGlideShutdown@0');
assert.strictEqual(view.getUint32(regions.BASE.GLIDE_STATE + 16, true), 0, 'shutdown releases stream');
assert.strictEqual(view.getUint32(regions.BASE.GLIDE_STATE + 40, true), 0, 'shutdown releases LFB');
call('_grGlideInit@0');
rejectOpen = true;
assert.strictEqual(call('_grSstWinOpen@28', [1, 7, 0, 0, 0, 2, 1]), 0);
assert.deepStrictEqual(Buffer.from(new Uint8Array(memory.buffer, dxState, 32)), savedDisplay,
  'failed open leaves display state untouched');
assert.strictEqual(moves.length, closedMoveCount);
rejectOpen = false;
call('_grSstWinOpen@28', [1, 7, 0, 0, 0, 2, 1]);
call('_grGlideShutdown@0', [], b);
assert.deepStrictEqual(Buffer.from(new Uint8Array(memory.buffer, dxState, 32)), savedDisplay,
  'shutdown with live context restores display');
assert.deepStrictEqual(moves.at(-1), [1, 15, 25, 800, 600]);
windowRects.clear();
const missingMoveCount = moves.length;
call('_grSstWinOpen@28', [0, 7, 0, 0, 0, 2, 1]);
assert.strictEqual(a.get_dx_exclusive_hwnd(), 0, 'headless context does not claim a missing HWND');
assert.strictEqual(moves.length, missingMoveCount);
call('_grBufferClear@12', [0, 255, 65535]);
rejectBatch = true;
assert.throws(() => call('_grBufferSwap@4', [0]), WebAssembly.RuntimeError,
  'a failed host batch traps even when worker RPC converted a host error to zero');
console.log('PASS Glide 2 decorated ABI, shared state, immutable draws, sparse output spans, LFB ordering and pending-close retirement');
