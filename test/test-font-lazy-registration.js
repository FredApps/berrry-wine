#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootRenderHarness } = require('./render-helper');
const { ChunkCache, ChunkCacheBudget } = require('../lib/byte-provider');
const apis = require('../src/api_table.json');
const extraWat = String.raw`
  (func (export "font_begin") (param $id i32) (param $sp i32)
    (global.set $thunk_guest_base (i32.const 0x200000))
    (global.set $thunk_guest_end (i32.const 0x200008))
    (i32.store (global.get $THUNK_BASE) (i32.const 0x80000001))
    (i32.store offset=4 (global.get $THUNK_BASE) (local.get $id))
    (global.set $esp (local.get $sp)) (global.set $eip (i32.const 0x200000))
    (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0)))
  (func (export "font_retry")
    (global.set $yield_reason (i32.const 0)) (global.set $yield_flag (i32.const 0))
    (call $run (i32.const 2)))
  (func (export "font_nodes") (result i32)
    (local $n i32) (local $p i32)
    (local.set $p (global.get $font_explicit_reads))
    (block $done (loop $walk
      (br_if $done (i32.eqz (local.get $p)))
      (local.set $n (i32.add (local.get $n) (i32.const 1)))
      (local.set $p (call $gl32 (local.get $p))) (br $walk)))
    (local.get $n))
  (func (export "font_fot_source") (param i32) (result i32)
    (call $scalable_font_source_for (local.get 0)))
  (func (export "font_retarget_fot") (param i32)
    (call $gs32 (i32.add (global.get $scalable_font_resources) (i32.const 8)) (local.get 0)))
`;
(async () => {
  const h = await bootRenderHarness({ extraWat, fonts: 'all' });
  const e = h.exports, vfs = h.hostCtx.vfs;
  const ttf = vfs.files.get('c:\\windows\\fonts\\arial.ttf').data.slice();
  const fon = fs.readFileSync(path.join(__dirname, '..', 'fonts', 'System.fon'));
  function str(text) {
    const p = e.guest_alloc(text.length + 1);
    [...text].forEach((c, i) => e.guest_write8(p + i, c.charCodeAt(0)));
    e.guest_write8(p + text.length, 0); return p;
  }
  function mount(name, bytes, failure = false) {
    const provider = new ChunkCache({ size: bytes.length,
      async readRange(off, len) {
        if (failure) throw Error('font media unavailable');
        return bytes.slice(off, off + len);
      },
    }, { budget: new ChunkCacheBudget({ maxBytes: 0 }), chunkSize: 1024, readAhead: 0 });
    vfs.setProviderFile(name, { provider });
    return vfs.files.get(vfs._normPath(name));
  }
  function begin(name, args, sp = 0x110100, ret = 0) {
    e.font_begin(apis.find(a => a.name === name).id, sp);
    [ret, ...args, 0, 0].forEach((x, i) => e.guest_write32(sp + i * 4, x));
    e.run(2);
  }
  function parked(sp = 0x110100) {
    assert.strictEqual(e.get_eip(), 0x200000);
    assert.strictEqual(e.get_esp(), sp);
    assert.strictEqual(e.get_yield_reason(), 12);
    assert.strictEqual(e.get_eax(), 0);
  }
  function done(result, count = 1, sp = 0x110100) {
    assert.strictEqual(e.get_eip(), 0);
    assert.strictEqual(e.get_esp(), sp + 4 + 4 * count);
    assert.strictEqual(e.get_eax(), result);
    assert.strictEqual(e.get_yield_reason(), 0);
  }
  async function fill() { assert(vfs.pendingRead); await vfs.fillPendingRead(vfs.pendingRead); }

  for (const [name, bytes] of [['c:\\lazy.fon', fon], ['c:\\lazy.ttf', ttf]]) {
    const entry = mount(name, bytes), p = str(name);
    begin('AddFontResourceA', [p]); parked();
    assert.strictEqual(e.font_nodes(), 1);
    await fill(); e.font_retry();
    assert(e.get_eax() > 0); done(e.get_eax());
    assert.strictEqual(e.font_nodes(), 0);
    assert(entry._provider, 'font registration does not materialize VFS file');
  }

  const src = str('c:\\scalable.ttf'), fot = str('c:\\resource.fot');
  mount('c:\\scalable.ttf', ttf);
  begin('CreateScalableFontResourceA', [0, fot, src, 0]); parked();
  assert.strictEqual(e.font_fot_source(fot), 0, 'pending source has no association');
  assert(!vfs.files.has('c:\\resource.fot'), 'pending source cannot write destination');
  await fill(); e.font_retry(); done(1, 4);
  assert(e.font_fot_source(fot)); assert(vfs.files.has('c:\\resource.fot'));
  // A real process-local FOT association must still work when copying the FOT
  // was unavailable or its representation was subsequently removed.
  vfs.files.delete('c:\\resource.fot');
  vfs.files.delete('c:\\scalable.ttf');
  begin('AddFontResourceA', [fot]); done(1);
  begin('AddFontResourceA', [src]); done(1);
  begin('CreateScalableFontResourceA', [0, str('c:\\cached.fot'), src, 0]); done(1, 4);
  // Point the latest process-local alias at a not-yet-cached source to cover
  // the pending fallback independently of the cached-face fast path.
  const fresh = str('c:\\fallback.ttf'), cachedFot = str('c:\\cached.fot');
  mount('c:\\fallback.ttf', ttf);
  e.font_retarget_fot(fresh);
  begin('AddFontResourceA', [cachedFot]); parked();
  await fill(); e.font_retry(); done(1);
  assert.strictEqual(e.font_nodes(), 0);

  for (const scalable of [false, true]) {
    const failed = str('c:\\failed.ttf'), output = str('c:\\failed.fot');
    mount('c:\\failed.ttf', ttf, true);
    begin(scalable ? 'CreateScalableFontResourceA' : 'AddFontResourceA',
      scalable ? [0, output, failed, 0] : [failed]);
    parked(); await fill(); e.font_retry(); done(0, scalable ? 4 : 1);
    assert.strictEqual(e.font_nodes(), 0);
    assert.strictEqual(e.font_fot_source(output), 0);
    assert(!vfs.files.has('c:\\failed.fot'));
  }

  // Two simultaneously parked guest frames retain separate handles/results.
  const a = str('c:\\outer.ttf'), b = str('c:\\inner.ttf');
  mount('c:\\outer.ttf', ttf); mount('c:\\inner.ttf', ttf);
  begin('AddFontResourceA', [a]); parked();
  const outer = vfs.pendingRead;
  begin('AddFontResourceA', [b], 0x111100); parked(0x111100);
  assert.strictEqual(e.font_nodes(), 2);
  await fill(); e.font_retry(); done(1, 1, 0x111100);
  assert.strictEqual(e.font_nodes(), 1);
  await vfs.fillPendingRead(outer);
  begin('AddFontResourceA', [a]); done(1);
  assert.strictEqual(e.font_nodes(), 0);

  // A reused frame with identical argument pointers but a new caller is a
  // new operation too; do not attach its result to the abandoned return PC.
  const returnPath = str('c:\\return-frame.ttf');
  mount('c:\\return-frame.ttf', ttf);
  begin('AddFontResourceA', [returnPath], 0x110100, 0x123456); parked();
  const abandoned = vfs.pendingRead;
  begin('AddFontResourceA', [returnPath]); parked();
  assert(vfs.handles.get(abandoned.handle).closed);
  assert.strictEqual(e.font_nodes(), 1);
  await fill(); e.font_retry(); done(1);
  assert.strictEqual(e.font_nodes(), 0);

  // Replacing a debug call at the same ESP cannot consume the old request.
  mount('c:\\old.ttf', ttf); mount('c:\\replacement.fon', fon);
  begin('AddFontResourceA', [str('c:\\old.ttf')]); parked();
  const oldRequest = vfs.pendingRead;
  begin('AddFontResourceA', [str('c:\\replacement.fon')]); parked();
  assert(vfs.handles.get(oldRequest.handle).closed, 'replaced continuation closes old handle');
  assert.strictEqual(e.font_nodes(), 1);
  await fill(); e.font_retry(); assert(e.get_eax() > 0); done(e.get_eax());
  assert.strictEqual(e.font_nodes(), 0);
  console.log('PASS lazy font registration: real API frames, FON/TTF/FOT fallback, zero-cache retries, no premature FOT, faults and nested/replaced frames');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
