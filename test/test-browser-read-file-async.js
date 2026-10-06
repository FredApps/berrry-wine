#!/usr/bin/env node
'use strict';
// ctx.readFileAsync (MCI waveaudio/sequencer open, wallpaper) on a streamed
// file. A lazy VFS entry carries no `data` until it is materialized, so the
// old lookup missed it and fetched exeDir + basename -- the wrong URL for a
// file in a subdirectory (Colin McRae's c:\game\sounds\crowd\crowd.wav). It
// must materialize the entry the guest path resolves to.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const hostSource = fs.readFileSync(path.join(ROOT, 'host.js'), 'utf8');
const context = { console };
vm.runInNewContext(hostSource + '\n;globalThis.WineAssembly = WineAssembly;', context);

(async () => {
  const wine = new context.WineAssembly();
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const materialized = [];
  let fetches = 0;
  wine._fetchMissingFile = () => { fetches++; return Promise.resolve(null); };
  const vfs = {
    cwd: 'c:\\game\\',
    // A streamed entry: a provider and no resident bytes.
    files: new Map([['c:\\game\\sounds\\crowd\\crowd.wav', { _provider: {}, attrs: 0x20 }]]),
    _resolvePath(p) { return (/^[a-z]:/i.test(p) ? p : this.cwd + p).toLowerCase(); },
    async materialize(p) { materialized.push(p); return bytes; },
  };

  // Another streamed entry, elsewhere, sharing a basename with a name nobody
  // mounted: its `data` getter throws VfsPendingError like the real one.
  vfs.files.set('c:\\other\\missing.mid', {
    _provider: {}, attrs: 0x20,
    get data() { throw new Error('VfsPendingError'); },
  });

  const got = await wine._readFileAsync('sounds\\crowd\\crowd.wav', vfs);
  assert.strictEqual(got, bytes, 'the streamed entry the guest path names is materialized');
  assert.deepStrictEqual(materialized, ['c:\\game\\sounds\\crowd\\crowd.wav']);
  assert.strictEqual(fetches, 0, 'no by-basename fetch for a mounted file');

  const none = await wine._readFileAsync('c:\\missing.mid', vfs);
  assert.strictEqual(none, null, 'an unmounted file still takes the by-name fetch, past a pending entry of the same basename');
  assert.strictEqual(fetches, 1);

  assert.match(hostSource, /readFileAsync: \(name\) => self\._readFileAsync\(name, ctx\.vfs\)/,
    'the host ctx routes readFileAsync through _readFileAsync');
  console.log('PASS test-browser-read-file-async');
})().catch(err => { console.error(err); process.exit(1); });
