'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const dir = process.argv[2]; if (!dir) throw Error('prepared evidence directory required');
const paint = process.argv[3] === '--paint';
const memory = {buffer: new ArrayBuffer(16384)}, view = new DataView(memory.buffer), messages = [], forwarded = [];
new Uint8Array(memory.buffer, 0x200, 12).set(Buffer.from('PeekMessageA'));
new Uint8Array(memory.buffer, 0x240, 14).set(Buffer.from('GetWindowLongA'));
[0x56292e, 0x900, 0, 0, 0, 0].forEach((n, i) => view.setUint32(0x600 + i * 4, n, true));
view.setUint32(0x600 + 24 + 44, 0x58cdb5, true); view.setUint32(0x600 + 24 + 48, 0x4de743, true);
const original = {log() { return 17; }, log_api_exit() { return 91; }, check_input() { return 0x202; }, invalidate() { return 73; }, wave_out_open() {}, wave_out_close() {}};
let builtHost, result = 1;
const guest = {get_current_thread_id: () => 1, get_eip: () => 0x56291b, get_esp: () => 0x600, get_eax: () => result, guest_to_wasm: p => p >= 0x400000 ? 0x1000 : p,
  get_yield_reason: () => 0, get_last_run_blocks: () => 1,
  run() {
    builtHost.check_input(); [0x4dea72, 0x10002, 8].forEach((n, i) => view.setUint32(0x600 + i * 4, n, true));
    [0x10002, 0x111, 1559, 0x10004].forEach((n, i) => view.setUint32(0x650 + i * 4, n, true)); view.setUint32(0xa00, 9, true);
    builtHost.log(0x240, 14); result = 0xa00; builtHost.log_api_exit(); view.setUint32(0xa00, 1, true);
    [0x56292e, 0x900, 0, 0, 0, 0].forEach((n, i) => view.setUint32(0x600 + i * 4, n, true)); view.setUint32(0x600 + 24 + 44, 0x58cdb5, true); view.setUint32(0x600 + 24 + 48, 0x4de743, true);
    if (paint) {
      [0x10003, 0xf, 0, 0, 0, 0, 0].forEach((n, i) => view.setUint32(0x900 + i * 4, n, true));
      builtHost.log(0x200, 12); result = 1; builtHost.log_api_exit();
    }
    builtHost.log(0x200, 12); result = 0; builtHost.log_api_exit();
  },
  set_eip() { throw Error('CPU setter forbidden'); }, set_esp() { throw Error('CPU setter forbidden'); }};
const sandbox = {URL, console, Date, performance, setTimeout, clearTimeout, importScripts() {}, Uint8Array, Uint32Array, DataView, ArrayBuffer, Atomics,
  WebAssembly: {instantiate: async (_m, b) => { builtHost = b.host; return {exports: guest}; }}, workerImports: require('../lib/worker-imports')};
sandbox.self = {location: {href: 'http://private/guest-worker.js'}, postMessage: m => messages.push(m), DllLoader: {}, memUtils: {}};
sandbox.GuestRpc = {createWorkerImports: () => ({imports: {host: {...original}}, stats: {}, names: Object.keys(original), advanceGuestTime() {}})};
vm.runInNewContext(fs.readFileSync(dir + '/prepared/lib/guest-worker.js', 'utf8'), sandbox);
const send = m => sandbox.self.onmessage({data: m});
(async () => {
  await send({t: 'init', memory, module: {}, slot: 0, sigs: {}}); assert(messages.some(m => m.t === 'ready'));
  await send({t: 'tiberianInputArm', hwnd: 0x10004, seq: 1}); assert(messages.some(m => m.t === 'tiberianInputArmed' && m.receipt.armed));
  await send({t: 'slice', steps: 1, seq: 2}); assert(messages.some(m => m.t === 'sliceDone' && !m.trapped));
  const empty = messages.find(m => m.t === 'tiberianInputReceipt' && m.record.kind === 'first-empty'); assert(empty); assert.equal(empty.record.identity.frameWords[11], 0x58cdb5);
  await send({t: 'tiberianInputClose', seq: 3}); const close = messages.find(m => m.t === 'tiberianInputClosed'); assert(close.receipt.closed); assert.equal(close.receipt.error, null); assert.equal(builtHost.log, original.log); assert.equal(builtHost.log_api_exit, original.log_api_exit);
  if (paint) {
    const target = messages.find(m => m.t === 'tiberianInputReceipt' && m.record.kind === 'paint-target');
    assert.equal(target.record.hwnd, 0x10003, 'observed MSG target replaces assumed dialog parent');
    const final = messages.find(m => m.t === 'tiberianInputReceipt' && m.record.kind === 'paint-final');
    assert(final.record.receipt.deadline > 0); assert.equal(final.record.receipt.error, null);
  }
  const linkSandbox = {module: {exports: {}}, console: {log: s => forwarded.push(s)}, setTimeout, clearTimeout};
  vm.runInNewContext(fs.readFileSync(dir + '/prepared/lib/guest-thread-host.js', 'utf8'), linkSandbox);
  const link = Object.create(linkSandbox.module.exports.WorkerLink.prototype); link._onMessage(empty); assert.equal(forwarded.length, 1);
  if (!fs.existsSync(dir + '/artifact-index.json')) fs.writeFileSync(dir + '/integration-tests.json', JSON.stringify({at: new Date().toISOString(), passed: true, observerClose: close.receipt, workerRows: forwarded.length, scope: 'actual generated Worker/Link mocked guest init/arm/slice/receipt/close; no native/browser'}, null, 2), {flag: 'wx'});
  console.log('PASS actual prepared Worker/Link init/arm/slice/first-empty/close, original forwarding and cleanup');
})().catch(e => { console.error(e); process.exitCode = 1; });
