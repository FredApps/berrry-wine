#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
const apis = require('../src/api_table.json');
const STACK = 0x110100, PATH = 0x120000, THUNK = 0x200000;
const extraWat = String.raw`
 (func (export "help_begin") (param $id i32) (param $stack i32)
   (global.set $thunk_guest_base (i32.const 0x200000))
   (global.set $thunk_guest_end (i32.const 0x200008))
   (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
   (i32.store offset=4 (global.get $THUNK_BASE) (local.get $id))
   (global.set $esp (local.get $stack)) (global.set $eip (i32.const 0x200000)))
 (func (export "help_resume")
   (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0))
   (call $run (i32.const 2)))
 (func (export "help_eax") (result i32) (global.get $eax))
 (func (export "help_esp") (result i32) (global.get $esp))
 (func (export "help_prepare") (param i32) (result i32) (call $help_document_prepare_vfs (local.get 0)))
 (func (export "help_commit") (param i32) (result i32) (call $help_document_commit_vfs (local.get 0)))
 (func (export "help_cancel") (param i32) (call $help_document_cancel_prepare_vfs (local.get 0)))
 (func (export "help_prepare_owned") (param i32 i32) (result i32)
   (call $help_document_prepare_vfs_owned (local.get 0) (local.get 1)))
 (func (export "help_cancel_owned") (param i32) (call $help_document_cancel_vfs_owned (local.get 0)))
 (func (export "help_owned_handle") (param i32) (result i32)
   (call $help_document_owned_pending_handle (local.get 0)))
 (func (export "help_push") (result i32) (call $help_document_snapshot_push))
 (func (export "help_frames") (result i32) (local $p i32) (local $n i32)
   (local.set $p (global.get $help_vfs_pending))
   (block $done (loop $walk (br_if $done (i32.eqz (local.get $p)))
     (local.set $n (i32.add (local.get $n) (i32.const 1)))
     (local.set $p (call $gl32 (local.get $p))) (br $walk))) (local.get $n))
`;
(async () => {
  const h = await bootRenderHarness({ fonts: 'none', extraWat });
  const e = h.exports, vfs = h.hostCtx.vfs;
  const hlp = fs.readFileSync(path.join(__dirname, 'binaries/help/freecell.hlp'));
  const cnt = Buffer.concat([Buffer.from('; padding\n'.repeat(900)),
    fs.readFileSync(path.join(__dirname, 'binaries/help/freecell.cnt'))]);
  const live = () => [...vfs.handles.values()].filter(handle => !handle.closed).length;
  let reads = [], opens = 0, closes = 0;
  const create = vfs.createFile.bind(vfs), close = vfs.closeHandle.bind(vfs);
  vfs.createFile = (...args) => { opens++; return create(...args); };
  vfs.closeHandle = (...args) => { closes++; return close(...args); };
  function writePath(text, ptr = PATH, wide = false) {
    Buffer.from(text + '\0', wide ? 'utf16le' : 'latin1').forEach((b, i) => e.guest_write8(ptr + i, b));
    return e.guest_to_wasm(ptr);
  }
  function frame(name = 'WinHelpA', stack = STACK, ptr = PATH) {
    e.help_begin(apis.find(a => a.name === name).id, stack);
    [0, 0x4444, ptr, 3, 0].forEach((value, i) => e.guest_write32(stack + i * 4, value));
  }
  function mount(base, { failKind, failOffset, malformed, omitCnt = false } = {}) {
    const budget = new ChunkCacheBudget({ maxBytes: 0 });
    for (const [kind, original] of [['hlp', hlp], ['cnt', cnt]]) {
      if (kind === 'cnt' && omitCnt) continue;
      const bytes = malformed === kind ? Buffer.from(kind === 'hlp' ? 'not help' : '1 Root\n3 Bad\n') : original;
      vfs.setProviderFile(`${base}.${kind}`, { provider: new ChunkCache({
        size: bytes.length, readRange: async (off, len) => {
          reads.push([kind, off, len]);
          if (kind === failKind && off === failOffset) throw new Error('injected help read failure');
          return bytes.slice(off, off + len);
        },
      }, { chunkSize: 4096, maxChunks: 1, readAhead: 0, budget }) });
    }
    return budget;
  }
  function state() {
    return [e.get_help_file_ptr(), e.get_help_file_size(), e.get_help_cnt_node_count(),
      e.get_help_document_path_ptr(), e.get_help_session_owner(), e.get_help_session_topic_ref(),
      e.get_help_document_snapshot_count()];
  }
  function seed(history = 1) {
    e.test_help_reset();
    vfs.files.set('c:\\old.hlp', { data: new Uint8Array(hlp), attrs: 0x20 });
    frame(); assert.strictEqual(e.test_help_load_vfs(writePath('c:\\old.hlp')), 1);
    for (let i = 0; i < history; i++) {
      assert.strictEqual(e.help_push(), 1);
      frame(); assert.strictEqual(e.test_help_load_vfs(writePath('c:\\old.hlp')), 1);
    }
    assert.strictEqual(e.get_help_document_snapshot_count(), history);
    return state();
  }
  async function prepare(text, old, stack = STACK, ptr = PATH, expectedFrames = 1) {
    let rounds = 0, result;
    for (;;) {
      // Content identity survives a newly normalized path address each retry.
      const wa = writePath(text, ptr + ((rounds & 1) * 512));
      frame('WinHelpA', stack, ptr);
      result = e.help_prepare(wa);
      assert.deepStrictEqual(state(), old, 'staging cannot mutate old document or history');
      if (result !== -1) break;
      assert(++rounds < 15); assert.strictEqual(e.help_frames(), expectedFrames);
      const pending = vfs.pendingRead;
      assert.strictEqual(e.help_prepare(wa), -1, 'repeated miss cannot parse partial bytes');
      assert.strictEqual(e.help_frames(), expectedFrames);
      await vfs.fillPendingRead(pending);
    }
    return { result, rounds };
  }
  const expectedRounds = Math.ceil(hlp.length / 4096) + Math.ceil(cnt.length / 4096);
  let old = seed(4); mount('c:\\ready'); reads = [];
  const before = [opens, closes];
  let ready = await prepare('c:\\ready.hlp', old);
  assert(ready.result > 0); assert.strictEqual(ready.rounds, expectedRounds);
  assert.strictEqual(e.help_frames(), 1); assert.strictEqual(live(), 2);
  assert.strictEqual(e.help_commit(ready.result), 1); assert.strictEqual(e.get_help_cnt_node_count(), 3);
  assert.strictEqual(e.get_help_document_snapshot_count(), 4, 'full history survives disposal of only the temporary fifth rollback snapshot');
  assert.strictEqual(e.help_frames(), 0); assert.strictEqual(live(), 0);
  assert.deepStrictEqual([opens - before[0], closes - before[1]], [2, 2]);
  for (const kind of ['hlp', 'cnt']) for (let off = 0; off < (kind === 'hlp' ? hlp : cnt).length; off += 4096) {
    old = seed(); mount('c:\\fault', { failKind: kind, failOffset: off });
    ready = await prepare('c:\\fault.hlp', old);
    assert.strictEqual(ready.result, 0); assert.strictEqual(e.get_help_last_error(), 7);
    assert.strictEqual(e.help_frames(), 0); assert.strictEqual(live(), 0);
  }
  for (const malformed of ['hlp', 'cnt']) {
    old = seed(4); mount('c:\\invalid', { malformed });
    ready = await prepare('c:\\invalid.hlp', old); assert(ready.result > 0);
    assert.strictEqual(e.help_commit(ready.result), 0); assert.deepStrictEqual(state(), old, 'parse failure rolls back');
    assert.strictEqual(e.help_frames(), 0); assert.strictEqual(live(), 0);
  }
  old = seed(); mount('c:\\absent', { omitCnt: true });
  ready = await prepare('c:\\absent.hlp', old); assert(ready.result > 0);
  assert.strictEqual(e.help_commit(ready.result), 1); assert.strictEqual(e.get_help_cnt_node_count(), 0);
  old = seed(); mount('c:\\short');
  const read = vfs.readFile.bind(vfs);
  vfs.readFile = (handle, target, count) => vfs.handles.get(handle)?.pos >= 4096 ? 0 : read(handle, target, count);
  ready = await prepare('c:\\short.hlp', old);
  assert.strictEqual(ready.result, 0, 'EOF before advertised size is terminal failure');
  assert.strictEqual(e.help_frames(), 0); assert.strictEqual(live(), 0); vfs.readFile = read;
  // A native caller that cannot park cancels its own transaction, not a peer.
  old = seed(); mount('c:\\outer'); mount('c:\\inner');
  frame(); const outerWA = writePath('c:\\outer.hlp'); assert.strictEqual(e.help_prepare(outerWA), -1);
  frame('WinHelpA', STACK + 4096, PATH + 4096); const innerWA = writePath('c:\\inner.hlp', PATH + 4096);
  assert.strictEqual(e.help_prepare(innerWA), -1); assert.strictEqual(e.help_frames(), 2);
  e.help_cancel(outerWA); assert.strictEqual(e.help_frames(), 2, 'wrong frame cannot cancel outer transaction');
  e.help_cancel(innerWA); assert.strictEqual(e.help_frames(), 1);
  frame(); e.help_cancel(outerWA); e.help_cancel(outerWA); assert.strictEqual(e.help_frames(), 0);
  assert.strictEqual(live(), 0); assert.deepStrictEqual(state(), old);
  // An owned native job must survive arbitrary service-time ESP/return changes
  // and must not alias an API frame with the same numeric key and same path.
  old = seed(); mount('c:\\owned'); frame();
  const ownedWA = writePath('c:\\owned.hlp'), owner = STACK;
  assert.strictEqual(e.help_prepare(ownedWA), -1);
  assert.strictEqual(e.help_owned_handle(owner), 0, 'API numeric-key collision does not expose an owned handle');
  const foreignRead = vfs.pendingRead;
  assert.strictEqual(e.help_prepare_owned(ownedWA, owner), -1);
  assert.strictEqual(vfs.pendingRead, foreignRead, 'atomic owned read cannot replace another API operation descriptor');
  assert.notStrictEqual(e.help_owned_handle(owner), foreignRead.handle);
  assert.strictEqual(e.help_frames(), 2);
  e.help_cancel(ownedWA); assert.strictEqual(e.help_frames(), 1, 'path/API cancellation cannot consume owned job');
  assert.strictEqual(e.help_prepare_owned(ownedWA, owner), -1);
  assert.strictEqual(e.help_owned_handle(owner), vfs.pendingRead.handle);
  assert.strictEqual(e.help_prepare(ownedWA), -1);
  e.help_cancel_owned(owner); assert.strictEqual(e.help_frames(), 1, 'owned cancellation cannot consume API frame');
  e.help_cancel_owned(0); assert.strictEqual(e.help_frames(), 1);
  assert.strictEqual(e.help_prepare_owned(ownedWA, 0), 0, 'zero owner is invalid');
  assert.strictEqual(e.help_frames(), 1);
  assert.strictEqual(e.help_prepare_owned(ownedWA, owner), -1);
  e.help_cancel(ownedWA); assert.strictEqual(e.help_frames(), 1);
  const ownedOpens = opens;
  let ownedReady, ownedRounds = 0;
  for (;;) {
    frame('WinHelpA', 0x180000 + ownedRounds * 256);
    e.guest_write32(e.help_esp(), 0x500000 + ownedRounds);
    const sp = e.help_esp(), ip = e.get_eip();
    ownedReady = e.help_prepare_owned(ownedWA, owner);
    assert.strictEqual(e.help_esp(), sp); assert.strictEqual(e.get_eip(), ip);
    assert.deepStrictEqual(state(), old); assert.strictEqual(e.help_frames(), 1);
    if (ownedReady !== -1) {
      assert.strictEqual(e.help_owned_handle(owner), 0, 'ready stage owns no pending read');
      break;
    }
    assert.strictEqual(e.help_owned_handle(owner), vfs.pendingRead.handle, 'active handle follows HLP then CNT stages');
    assert(++ownedRounds < 15); await vfs.fillPendingRead(vfs.pendingRead);
  }
  assert(ownedReady > 0); assert.strictEqual(ownedRounds, expectedRounds);
  assert.strictEqual(opens - ownedOpens, 1, 'only CNT opens after initial owned HLP; changing ESP never reopens');
  assert.strictEqual(e.help_commit(ownedReady), 1); assert.strictEqual(e.help_frames(), 0); assert.strictEqual(live(), 0);
  old = seed(); mount('c:\\owned'); mount('c:\\other-owned'); frame();
  assert.strictEqual(e.help_prepare_owned(writePath('c:\\owned.hlp'), owner), -1);
  assert.strictEqual(e.help_prepare_owned(writePath('c:\\other-owned.hlp', PATH + 1024), owner + 1), -1);
  assert.strictEqual(e.help_prepare_owned(0, owner), 0, 'invalid owned path cancels only that owner');
  assert.strictEqual(e.help_frames(), 1);
  frame('WinHelpA', STACK + 8192); e.help_cancel_owned(owner + 1); e.help_cancel_owned(owner + 1);
  assert.strictEqual(e.help_owned_handle(owner + 1), 0);
  assert.strictEqual(e.help_frames(), 0); assert.strictEqual(live(), 0); assert.deepStrictEqual(state(), old);
  for (const badPath of [0, writePath('')]) {
    frame(); const wa = writePath('c:\\outer.hlp', PATH + 2048);
    assert.strictEqual(e.help_prepare(wa), -1); assert.strictEqual(e.help_frames(), 1);
    assert.strictEqual(e.help_prepare(badPath), 0);
    assert.strictEqual(e.help_frames(), 0); assert.strictEqual(live(), 0);
    assert.deepStrictEqual(state(), old, 'invalid replacement cancels staging without changing the old document');
  }
  // Real A/W imports preserve the stdcall frame and old document across every miss.
  for (const name of ['WinHelpA', 'WinHelpW']) for (const failure of [false, true]) {
    old = seed(4); mount('c:\\api', failure ? { failKind: 'cnt', failOffset: 4096 } : {});
    writePath('c:\\api.hlp', PATH, name.endsWith('W')); frame(name);
    let parks = 0;
    for (;;) {
      e.help_resume(); if (e.get_yield_reason() !== 12) break;
      assert(++parks < 15); assert.strictEqual(e.help_esp(), STACK); assert.strictEqual(e.get_eip(), THUNK);
      assert.deepStrictEqual(state(), old, 'API pending must not release old history/document');
      await vfs.fillPendingRead(vfs.pendingRead);
    }
    assert.strictEqual(e.help_esp(), STACK + 20); assert.strictEqual(e.help_eax(), failure ? 0 : 1);
    assert.strictEqual(e.help_frames(), 0); assert.strictEqual(live(), 0);
    if (failure) assert.deepStrictEqual(state(), old);
    else { assert.strictEqual(parks, expectedRounds); assert.strictEqual(e.get_help_cnt_node_count(), 3); }
  }
  for (const terminal of ['quit', 'bad-wide', 'null-a', 'null-w']) {
    old = seed(); mount('c:\\abandoned');
    writePath('c:\\abandoned.hlp', PATH, true); frame('WinHelpW'); e.help_resume();
    assert.strictEqual(e.get_yield_reason(), 12); assert.strictEqual(e.help_frames(), 1);
    frame(terminal === 'null-a' ? 'WinHelpA' : 'WinHelpW');
    if (terminal === 'quit') e.guest_write32(STACK + 12, 2);
    else if (terminal.startsWith('null-')) e.guest_write32(STACK + 8, 0);
    else for (let i = 0; i < 2048; i += 4) e.guest_write32(PATH + i, 0x00410041);
    e.help_resume();
    assert.strictEqual(e.help_esp(), STACK + 20); assert.notStrictEqual(e.get_yield_reason(), 12);
    assert.strictEqual(e.help_frames(), 0); assert.strictEqual(live(), 0);
    if (terminal === 'bad-wide') { assert.strictEqual(e.help_eax(), 0); assert.deepStrictEqual(state(), old); }
    if (terminal.startsWith('null-')) assert.strictEqual(e.get_help_file_ptr(), old[0]);
  }
  console.log('PASS staged HLP/CNT: actual A/W thunks, zero-cache progress, pending preservation, exact snapshots, parse/read faults and scoped cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; });
