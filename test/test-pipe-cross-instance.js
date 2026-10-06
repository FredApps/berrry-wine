#!/usr/bin/env node
'use strict';

// Anonymous pipes across two instances, step 1 of phase 2 in
// docs/design-anonymous-pipes.md. A child process is a separate emulator
// instance with its own memory, so a redirected child's stdin/stdout are pipe
// ends whose peers live in the parent; the bytes cross the virtual-LAN wire.
// Two nodes on one in-process loopback segment stand in for WinBoard (parent,
// 10.0.0.1) and GNUChess (child, 10.0.0.2). No child process is launched
// here: this pins the transport — pipe_move_to_child on the parent's end,
// pipe_open_remote on the child's, ordered bytes both ways, a write larger
// than the send window parking and resuming as credit returns, and EOF in
// each direction when the far end closes.

const assert = require('assert');
const { LoopbackSegment } = require('../lib/vlan-wire');
const { compile, makeNode, ip2int } = require('./vlan-node');

(async () => {
  const wasm = await compile();
  const seg = new LoopbackSegment();
  const A = await makeNode(wasm, seg.attach(), '10.0.0.1');  // parent (WinBoard)
  const B = await makeNode(wasm, seg.attach(), '10.0.0.2');  // child (GNUChess)

  for (const n of [A, B]) {
    // PeekNamedPipe reads its sixth argument off the stack, so give every
    // call a zeroed frame to read it from.
    const frame = n.alloc(64);
    n.wat.set_esp(frame);
    n.out = n.alloc(64);
  }
  const rd = (n, ga) => new DataView(n.memory.buffer, n.wa(ga), 4).getUint32(0, true);
  const lastErr = n => n.wat.test_call_GetLastError() >>> 0;
  const text = s => Array.from(s, c => c.charCodeAt(0));
  const str = a => String.fromCharCode(...a);
  const pumpBoth = () => { A.pump(); B.pump(); };

  // Call a handler that may park (net_wait); returns { eax, parked }.
  function call(n, name, ...args) {
    const eax = n.wat[`test_call_${name}`](...args) >>> 0;
    const parked = n.wat.get_yield_reason() === 8;
    if (parked) n.wat.clear_yield();
    return { eax, parked };
  }
  // A blocking read, the way the scheduler would service it: re-enter until
  // it stops parking, pumping both machines between attempts.
  function readAll(n, h, cap) {
    const buf = n.buf(cap);
    for (let i = 0; i < 1000; i++) {
      const r = call(n, 'ReadFile', h, buf, cap, n.out, 0);
      if (!r.parked) {
        return { ok: r.eax, err: r.eax ? 0 : lastErr(n), bytes: n.readBuf(buf, rd(n, n.out)) };
      }
      pumpBoth();
    }
    assert.fail('ReadFile never completed');
  }

  const ipA = ip2int('10.0.0.1'), ipB = ip2int('10.0.0.2');

  // --- the child's stdin: parent keeps the write end ---
  assert.strictEqual(call(A, 'CreatePipe', A.out, A.out + 4, 0, 0).eax, 1);
  const inRead = rd(A, A.out), inWrite = rd(A, A.out + 4);
  assert.strictEqual(A.wat.pipe_move_to_child(inRead, ipB, 50001, 50000), 0,
    'the read end moves to the child');
  assert.strictEqual(call(A, 'CloseHandle', inRead).eax, 1,
    'closing the parent copy of a moved end is harmless');
  const childIn = B.wat.pipe_open_remote(0, 50001, ipA, 50000) >>> 0;
  assert.strictEqual(childIn & 0xFFFF0000, 0x00330000, 'the child gets a pipe handle');

  // --- the child's stdout: parent keeps the read end ---
  assert.strictEqual(call(A, 'CreatePipe', A.out, A.out + 4, 0, 0).eax, 1);
  const outRead = rd(A, A.out), outWrite = rd(A, A.out + 4);
  assert.strictEqual(A.wat.pipe_move_to_child(outWrite, ipB, 50003, 50002), 1,
    'the write end moves to the child');
  call(A, 'CloseHandle', outWrite);
  const childOut = B.wat.pipe_open_remote(1, 50003, ipA, 50002) >>> 0;

  // --- a command goes down, a reply comes back ---
  let r = call(A, 'WriteFile', inWrite, A.buf(text('xboard\nnew\n')), 11, A.out, 0);
  assert.deepStrictEqual([r.eax, r.parked, rd(A, A.out)], [1, false, 11], 'parent writes the command');
  let got = readAll(B, childIn, 64);
  assert.strictEqual(str(got.bytes), 'xboard\nnew\n', 'the child reads it, in order');
  r = call(B, 'WriteFile', childOut, B.buf(text('move e7e5\n')), 10, B.out, 0);
  assert.strictEqual(r.eax, 1, 'the child writes its reply');
  got = readAll(A, outRead, 64);
  assert.strictEqual(str(got.bytes), 'move e7e5\n', 'the parent reads the reply');

  // --- the reader waits for the far writer ---
  r = call(A, 'ReadFile', outRead, A.buf(16), 16, A.out, 0);
  assert.ok(r.parked, 'an empty remote pipe parks the reader');

  // --- a write larger than the send window ---
  const N = 40000;
  const big = Array.from({ length: N }, (_, i) => (i * 13 + 5) & 0xFF);
  const src = A.buf(big);
  const sink = [];
  let done = false;
  for (let i = 0; i < 2000 && !(done && sink.length >= N); i++) {
    if (!done) {
      r = call(A, 'WriteFile', inWrite, src, N, A.out, 0);
      if (!r.parked) {
        assert.deepStrictEqual([r.eax, rd(A, A.out)], [1, N], 'the big write completes');
        done = true;
      }
    }
    pumpBoth();
    const buf = B.buf(8192);
    r = call(B, 'ReadFile', childIn, buf, 8192, B.out, 0);
    if (!r.parked) sink.push(...B.readBuf(buf, rd(B, B.out)));
    pumpBoth();
  }
  assert.ok(done, 'the parked write resumed as the child read');
  assert.strictEqual(sink.length, N, 'every byte crossed, once');
  assert.ok(sink.every((v, i) => v === big[i]), 'and in order');

  // --- EOF in each direction ---
  assert.strictEqual(call(B, 'CloseHandle', childOut).eax, 1, 'the child closes its stdout');
  pumpBoth();
  got = readAll(A, outRead, 16);
  assert.deepStrictEqual([got.ok, got.err], [0, 109], 'the parent sees ERROR_BROKEN_PIPE');
  assert.strictEqual(call(A, 'CloseHandle', inWrite).eax, 1, 'the parent closes the child stdin');
  pumpBoth();
  got = readAll(B, childIn, 16);
  assert.deepStrictEqual([got.ok, got.err], [0, 109], 'the child sees EOF on stdin');

  console.log('PASS test-pipe-cross-instance');
})().catch(err => { console.error(err); process.exit(1); });
