#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { VirtualFS, createFilesystemImports, expandRtfStylesheet } = require('../lib/filesystem');
const bp = require('../lib/byte-provider');

const text = '{\\rtf1\\ansi{\\stylesheet{\\s0\\ql\\f1\\fs20 Normal;}{\\s1\\sbasedon0\\qc\\b Heading;}}\\pard\\s1 Styled\\par}';
const bytes = Buffer.from(text);
function fixture(source = bytes, behavior = {}) {
  const memory = new ArrayBuffer(0x20000), raw = new Uint8Array(memory), dv = new DataView(memory);
  const vfs = new VirtualFS();
  const host = createFilesystemImports({ vfs, getMemory: () => memory,
    exports: { get_image_base: () => 0x400000 } });
  let reads = 0;
  const cache = bp.cached({ size: source.length, readRange: async (off, len) => {
    reads++;
    if (behavior.read) return behavior.read(off, len, reads);
    return source.subarray(off, off + len);
  } }, { chunkSize: 16, maxChunks: 1 });
  cache.gameData = true;
  vfs.setProviderFile('c:\\eula.rtf', { provider: cache });
  const open = (path = 'c:\\eula.rtf', tid = 1, wide = false, creation = 3, access = 0x80000000) => {
    raw.set(Buffer.from(path + '\0', wide ? 'utf16le' : 'latin1'), 0x100);
    const error = host.fs_create_file_result(0x100, access, creation, 0, +wide, 0x300, tid);
    return { error, handle: dv.getUint32(0x300, true) };
  };
  const live = () => [...vfs.handles.values()].filter(h => !h.closed).length;
  return { vfs, host, open, live, reads: () => reads };
}

(async () => {
  for (const wide of [false, true]) {
    const f = fixture();
    assert.deepStrictEqual(f.open(undefined, 2, wide), { error: 997, handle: 0xffffffff });
    const pending = f.vfs.getPendingRead(2);
    assert(pending.provider.gameData, 'normal delayed game-loading UX remains enabled');
    assert.strictEqual(f.reads(), 0, 'open parks before starting the provider');
    assert.strictEqual(f.live(), 0, 'no provisional handle survives the wait');
    const allocated = f.vfs.handles.size;
    assert.strictEqual(f.open(undefined, 2, wide).error, 997);
    assert.strictEqual(f.vfs.handles.size, allocated, 'polling does not allocate more handles');
    assert.strictEqual(await f.vfs.fillPendingRead(pending), true);
    const opened = f.open(undefined, 2, wide);
    assert.strictEqual(opened.error, 0);
    assert.strictEqual(f.vfs.getPendingRead(2), null);
    const expected = Buffer.from(expandRtfStylesheet(text));
    const out = new Uint8Array(expected.length + 4);
    assert.strictEqual(f.vfs.getFileSize(opened.handle), expected.length);
    assert.strictEqual(f.vfs.readFile(opened.handle, out, out.length).bytesRead, expected.length);
    assert.deepStrictEqual(Buffer.from(out.subarray(0, expected.length)), expected);
    assert.deepStrictEqual(Buffer.from(f.vfs.files.get('c:\\eula.rtf').data), bytes,
      'formatting view never overwrites original media');
    assert.strictEqual(f.live(), 1);
  }
  {
    const f = fixture();
    f.vfs.files.set('c:\\ordinary.bin', f.vfs.files.get('c:\\eula.rtf'));
    assert.strictEqual(f.open('c:\\ordinary.bin').error, 0);
    assert.strictEqual(f.reads(), 0, 'ordinary lazy files are not materialized by open');
    assert.strictEqual(f.vfs.getPendingRead(), null);
    assert.strictEqual(f.open('c:\\missing.rtf').error, 2);
  }
  {
    const f = fixture(bytes, { read: async () => { throw Error('offline'); } });
    assert.strictEqual(f.open().error, 997);
    assert.strictEqual(await f.vfs.fillPendingRead(f.vfs.getPendingRead()), false);
    assert.deepStrictEqual(f.open(), { error: 30, handle: 0xffffffff });
    assert.strictEqual(f.live(), 0, 'failed materialization does not leak handles');
    assert.strictEqual(f.vfs.getPendingRead(), null);
  }
  {
    const f = fixture(bytes, { read: async (off, len, attempt) => {
      if (attempt === 1) throw Error('transient');
      return bytes.subarray(off, off + len);
    } });
    f.open();
    const pending = f.vfs.getPendingRead();
    await assert.rejects(pending.provider.fill(), /transient/);
    await pending.provider.fill(); // GameWait retries before resuming the guest.
    await f.vfs.fillPendingRead(pending);
    assert.strictEqual(f.open().error, 0);
  }
  {
    const f = fixture();
    f.open(undefined, 2);
    const first = f.vfs.getPendingRead(2);
    f.open(undefined, 3);
    assert.notStrictEqual(f.vfs.getPendingRead(3), first, 'peer opens own their waits');
    f.vfs.releaseIoState(2);
    assert.strictEqual(await f.vfs.fillPendingRead(first), false);
    assert.strictEqual(f.reads(), 0, 'retired threads do not start a fetch');
    await f.vfs.fillPendingRead(f.vfs.getPendingRead(3));
    assert.strictEqual(f.open(undefined, 3).error, 0);
    assert.strictEqual(f.live(), 1);
  }
  {
    const f = fixture();
    f.open();
    const pending = f.vfs.getPendingRead();
    const replacement = { data: Buffer.from('{\\rtf1 replacement}'), attrs: 0x20 };
    f.vfs.files.set('c:\\eula.rtf', replacement);
    await f.vfs.fillPendingRead(pending);
    const opened = f.open();
    assert.strictEqual(opened.error, 0);
    assert.strictEqual(f.vfs.getFileSize(opened.handle), replacement.data.length);
    assert.strictEqual(f.vfs.files.get('c:\\eula.rtf'), replacement);
  }
  {
    const f = fixture();
    f.open();
    const pending = f.vfs.getPendingRead();
    f.vfs.files.delete('c:\\eula.rtf');
    await f.vfs.fillPendingRead(pending);
    assert.strictEqual(f.open().error, 2, 'deleted media is not resurrected');
    assert.strictEqual(f.live(), 0);
  }
  console.log('PASS lazy RTF opens: A/W, formatting parity, waits, bounded cache, failures, retries, threads and replacement');
})().catch(error => { console.error(error); process.exitCode = 1; });
