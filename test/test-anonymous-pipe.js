#!/usr/bin/env node
'use strict';

// Anonymous pipes, phase 1 of docs/design-anonymous-pipes.md: CreatePipe and
// the file APIs on its handles inside one process. WinBoard trapped in the
// CreatePipe stub at startup; this pins the semantics the GNUChess link will
// rest on — ordered bytes, partial reads, peek without consume, the reader
// parking until a writer writes, EOF (ERROR_BROKEN_PIPE) only once every
// write handle is closed, ERROR_NO_DATA for a writer with no reader, a write
// larger than the pipe parking part way and resuming, and every handler
// popping exactly its stdcall frame.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_last_error") (result i32) (global.get $last_error))
  (func (export "test_set_last_error") (param $v i32) (global.set $last_error (local.get $v)))
  (func (export "t_CreatePipe") (param $a i32) (param $b i32) (param $c i32) (param $d i32)
    (call $handle_CreatePipe (local.get $a) (local.get $b) (local.get $c) (local.get $d) (i32.const 0) (i32.const 0)))
  (func (export "t_ReadFile") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32)
    (call $handle_ReadFile (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $e) (i32.const 0)))
  (func (export "t_WriteFile") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32)
    (call $handle_WriteFile (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $e) (i32.const 0)))
  (func (export "t_PeekNamedPipe") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32)
    (call $handle_PeekNamedPipe (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $e) (i32.const 0)))
  (func (export "t_CloseHandle") (param $a i32)
    (call $handle_CloseHandle (local.get $a) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))
  (func (export "t_GetFileType") (param $a i32)
    (call $handle_GetFileType (local.get $a) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))
  (func (export "t_DuplicateHandle") (param $a i32) (param $b i32) (param $c i32) (param $d i32) (param $e i32)
    (call $handle_DuplicateHandle (local.get $a) (local.get $b) (local.get $c) (local.get $d) (local.get $e) (i32.const 0)))
`;

const NARGS = { CreatePipe: 4, ReadFile: 5, WriteFile: 5, PeekNamedPipe: 6,
  CloseHandle: 1, GetFileType: 1, DuplicateHandle: 7 };

(async () => {
  const harness = await bootRenderHarness({ extraWat, fonts: 'none' });
  const e = harness.exports;
  const mem = () => new Uint8Array(harness.memory.buffer);

  const stackLo = e.guest_alloc(0x2000) >>> 0;
  const ESP0 = (stackLo + 0x1000) >>> 0;
  const scratch = e.guest_alloc(0x10000) >>> 0;   // out-params and buffers
  const out = i => (scratch + i * 4) >>> 0;        // dword out-param i
  const BUF = (scratch + 0x100) >>> 0;
  const BIG = (scratch + 0x1000) >>> 0;

  // Build the stdcall frame the dispatcher would have, call the handler,
  // and report EAX, last error, whether it parked, and the ESP it left.
  function call(name, ...args) {
    e.guest_write32(ESP0, 0x0DEAD000);
    args.forEach((a, i) => e.guest_write32(ESP0 + 4 + 4 * i, a >>> 0));
    e.set_esp(ESP0);
    e.test_set_last_error(0);
    const first5 = args.slice(0, 5);
    while (first5.length < 5) first5.push(0);
    e[`t_${name}`](...first5.slice(0, name === 'CloseHandle' || name === 'GetFileType' ? 1
      : name === 'CreatePipe' ? 4 : 5));
    const parked = e.get_yield_reason() === 8;
    const r = { eax: e.get_eax() >>> 0, err: e.test_last_error() >>> 0, parked,
      esp: e.get_esp() >>> 0 };
    if (parked) {
      assert.strictEqual(r.esp, ESP0, `${name} parks with its frame intact`);
      e.clear_yield();
    } else {
      assert.strictEqual(r.esp, ESP0 + 4 * (NARGS[name] + 1),
        `${name} pops exactly its ${NARGS[name]}-argument stdcall frame`);
    }
    return r;
  }
  const put = (ga, s) => { for (let i = 0; i < s.length; i++) e.guest_write8(ga + i, s.charCodeAt(i)); };
  const get = (ga, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(e.guest_read8(ga + i)); return s; };
  const rd = ga => e.guest_read32(ga) >>> 0;

  // --- CreatePipe, handle shape, GetFileType ---
  let r = call('CreatePipe', out(0), out(1), 0, 0);
  assert.strictEqual(r.eax, 1, 'CreatePipe succeeds');
  const hr = rd(out(0)), hw = rd(out(1));
  assert.strictEqual(hr & 0xFFFF0000, 0x00330000, 'read handle carries the pipe tag');
  assert.strictEqual(hw & 0xFFFF0000, 0x00330000, 'write handle carries the pipe tag');
  assert.notStrictEqual(hr, hw);
  assert.strictEqual(call('GetFileType', hr).eax, 3, 'GetFileType(read end) = FILE_TYPE_PIPE');
  assert.strictEqual(call('GetFileType', hw).eax, 3, 'GetFileType(write end) = FILE_TYPE_PIPE');

  // --- ordered bytes, peek, partial reads ---
  put(BUF, 'hello');
  r = call('WriteFile', hw, BUF, 5, out(2), 0);
  assert.deepStrictEqual([r.eax, rd(out(2))], [1, 5], 'WriteFile writes all five bytes');
  r = call('PeekNamedPipe', hr, BUF + 0x40, 3, out(3), out(4), out(5));
  assert.strictEqual(r.eax, 1);
  assert.strictEqual(get(BUF + 0x40, 3), 'hel', 'PeekNamedPipe copies the head');
  assert.deepStrictEqual([rd(out(3)), rd(out(4)), rd(out(5))], [3, 5, 0],
    'PeekNamedPipe reports copied, total available, 0 left in message');
  r = call('PeekNamedPipe', hr, 0, 0, 0, out(4), 0);
  assert.deepStrictEqual([r.eax, rd(out(4))], [1, 5], 'peeking consumed nothing');
  r = call('ReadFile', hr, BUF + 0x80, 2, out(6), 0);
  assert.deepStrictEqual([r.eax, rd(out(6)), get(BUF + 0x80, 2)], [1, 2, 'he']);
  r = call('ReadFile', hr, BUF + 0x80, 64, out(6), 0);
  assert.deepStrictEqual([r.eax, rd(out(6)), get(BUF + 0x80, 3)], [1, 3, 'llo'],
    'a read larger than what is buffered returns what is there');

  // --- empty with a live writer: the reader parks ---
  r = call('ReadFile', hr, BUF + 0x80, 64, out(6), 0);
  assert.ok(r.parked, 'ReadFile on an empty pipe with a live writer parks (net_wait)');
  r = call('PeekNamedPipe', hr, 0, 0, 0, out(4), 0);
  assert.deepStrictEqual([r.eax, rd(out(4))], [1, 0], 'PeekNamedPipe never blocks');

  // --- wrong direction ---
  r = call('ReadFile', hw, BUF, 4, out(6), 0);
  assert.deepStrictEqual([r.eax, r.err], [0, 5], 'reading the write end is ERROR_ACCESS_DENIED');
  r = call('WriteFile', hr, BUF, 4, out(2), 0);
  assert.deepStrictEqual([r.eax, r.err], [0, 5], 'writing the read end is ERROR_ACCESS_DENIED');

  // --- DuplicateHandle keeps the writer alive; EOF after the last close ---
  const self = 0xFFFFFFFF;
  r = call('DuplicateHandle', self, hw, self, out(7), 0, 0, 0);
  const hw2 = rd(out(7));
  assert.strictEqual(r.eax, 1, 'DuplicateHandle(pipe) succeeds');
  assert.ok(hw2 !== hw && (hw2 & 0xFFFF0000) === 0x00330000, 'and returns a distinct pipe handle');
  put(BUF, 'xy');
  call('WriteFile', hw2, BUF, 2, out(2), 0);
  assert.strictEqual(call('CloseHandle', hw).eax, 1, 'CloseHandle(original write end)');
  r = call('ReadFile', hr, BUF + 0x80, 64, out(6), 0);
  assert.deepStrictEqual([r.eax, rd(out(6)), get(BUF + 0x80, 2)], [1, 2, 'xy'],
    'bytes from the duplicate arrive');
  assert.ok(call('ReadFile', hr, BUF + 0x80, 64, out(6), 0).parked,
    'an open duplicate still counts as a writer');
  assert.strictEqual(call('CloseHandle', hw2).eax, 1);
  r = call('ReadFile', hr, BUF + 0x80, 64, out(6), 0);
  assert.deepStrictEqual([r.eax, r.err, rd(out(6))], [0, 109, 0],
    'with every writer closed, ReadFile fails ERROR_BROKEN_PIPE with 0 bytes');
  r = call('PeekNamedPipe', hr, 0, 0, 0, out(4), 0);
  assert.deepStrictEqual([r.eax, r.err], [0, 109], 'and so does PeekNamedPipe');
  assert.strictEqual(call('CloseHandle', hr).eax, 1);
  r = call('CloseHandle', hr);
  assert.deepStrictEqual([r.eax, r.err], [0, 6], 'a closed pipe handle is ERROR_INVALID_HANDLE');
  r = call('PeekNamedPipe', hr, 0, 0, 0, out(4), 0);
  assert.deepStrictEqual([r.eax, r.err], [0, 6]);

  // --- buffered bytes outlive the writer: drain first, then EOF ---
  call('CreatePipe', out(0), out(1), 0, 0);
  const er = rd(out(0)), ew = rd(out(1));
  put(BUF, 'bye');
  call('WriteFile', ew, BUF, 3, out(2), 0);
  call('CloseHandle', ew);
  r = call('ReadFile', er, BUF + 0x80, 64, out(6), 0);
  assert.deepStrictEqual([r.eax, rd(out(6)), get(BUF + 0x80, 3)], [1, 3, 'bye'],
    'bytes written before the close are still read');
  assert.strictEqual(call('ReadFile', er, BUF + 0x80, 64, out(6), 0).err, 109);
  call('CloseHandle', er);

  // --- a writer with no reader: ERROR_NO_DATA ---
  call('CreatePipe', out(0), out(1), 0, 0);
  const nr = rd(out(0)), nw = rd(out(1));
  call('CloseHandle', nr);
  r = call('WriteFile', nw, BUF, 3, out(2), 0);
  assert.deepStrictEqual([r.eax, r.err], [0, 232], 'writing with the read end closed is ERROR_NO_DATA');
  call('CloseHandle', nw);

  // --- a write larger than the pipe parks part way and resumes ---
  call('CreatePipe', out(0), out(1), 0, 0);
  const br = rd(out(0)), bw = rd(out(1));
  const N = 20000;
  for (let i = 0; i < N; i++) e.guest_write8(BIG + i, (i * 7 + 3) & 0xFF);
  r = call('WriteFile', bw, BIG, N, out(2), 0);
  assert.ok(r.parked, 'a 20000-byte write into a 16KB pipe parks');
  r = call('PeekNamedPipe', br, 0, 0, 0, out(4), 0);
  const firstChunk = rd(out(4));
  assert.ok(firstChunk > 0 && firstChunk < N, `part of it is already in the pipe (${firstChunk})`);
  const READ = (scratch + 0x8000) >>> 0;
  r = call('ReadFile', br, READ, firstChunk, out(6), 0);
  assert.strictEqual(rd(out(6)), firstChunk);
  r = call('WriteFile', bw, BIG, N, out(2), 0);   // the same call, re-entered
  assert.deepStrictEqual([r.eax, rd(out(2))], [1, N], 'the re-entered write completes the whole buffer');
  r = call('ReadFile', br, READ + firstChunk, N, out(6), 0);
  assert.strictEqual(rd(out(6)), N - firstChunk, 'the rest arrives, once');
  for (let i = 0; i < N; i++) {
    if (e.guest_read8(READ + i) !== ((i * 7 + 3) & 0xFF)) {
      assert.fail(`byte ${i} out of order after a parked write`);
    }
  }
  call('CloseHandle', bw);
  call('CloseHandle', br);

  // --- inheritable handles via SECURITY_ATTRIBUTES ---
  const sa = out(20);
  e.guest_write32(sa, 12); e.guest_write32(sa + 4, 0); e.guest_write32(sa + 8, 1);
  assert.strictEqual(call('CreatePipe', out(0), out(1), sa, 4096).eax, 1,
    'CreatePipe with inheritable SECURITY_ATTRIBUTES and an nSize');
  call('CloseHandle', rd(out(0)));
  call('CloseHandle', rd(out(1)));

  // --- the records are released: many pipes in a row do not run out ---
  for (let i = 0; i < 200; i++) {
    assert.strictEqual(call('CreatePipe', out(0), out(1), 0, 0).eax, 1, `pipe ${i} created`);
    call('CloseHandle', rd(out(0)));
    call('CloseHandle', rd(out(1)));
  }

  void mem;
  console.log('PASS test-anonymous-pipe');
})().catch(err => { console.error(err); process.exit(1); });
