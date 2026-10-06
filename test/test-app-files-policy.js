#!/usr/bin/env node
'use strict';

// lib/app-files.js: the default download policy both hosts apply to an app's
// companion files. Large data streams; executables, small files and what
// synchronous (non-parking) consumers read load at launch; small apps,
// Win16 apps and opted-out apps stay fully eager; explicit declarations win.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeLazyFiles, SMALL_FILE_BYTES, APP_EAGER_BYTES,
} = require('../lib/app-files');

const MB = 1024 * 1024;
const files = [
  { url: 'game/data/levels.pak', vfsPath: 'c:\\data\\levels.pak', size: 40 * MB },
  { url: 'game/movies/intro.smk', vfsPath: 'c:\\movies\\intro.smk', size: 12 * MB },
  { url: 'game/plugin.dll', vfsPath: 'c:\\plugin.dll', size: 2 * MB },
  { url: 'game/music.wav', vfsPath: 'c:\\music.wav', size: 3 * MB },
  { url: 'game/game.ini', vfsPath: 'c:\\game.ini', size: 900 },
  { url: 'game/small.dat', vfsPath: 'c:\\small.dat', size: SMALL_FILE_BYTES - 1 },
  { url: 'game/save/slot1.sav', vfsPath: 'c:\\save\\slot1.sav', size: 1 * MB },
  { url: 'game/ranged.mpq', vfsPath: 'c:\\ranged.mpq', size: 30 * MB, httpRange: true, preloadRanges: [[0, 4096]] },
  { url: 'game/pinned.bin', vfsPath: 'c:\\pinned.bin', size: 9 * MB, eager: true },
];
const app = { persistFiles: ['c:\\save\\*.sav'] };

const { files: out, summary } = normalizeLazyFiles(app, files);
const byUrl = new Map(out.map(f => [f.url, f]));
assert.strictEqual(summary.policy, 'lazy');
assert.deepStrictEqual(byUrl.get('game/data/levels.pak'),
  { ...files[0], httpRange: true }, 'large data streams through httpRange (HEAD, falls back without Range)');
assert.strictEqual(byUrl.get('game/data/levels.pak').loadMode, undefined,
  'never a sized loadMode: that refuses to fall back when a host answers 200');
assert.strictEqual(byUrl.get('game/movies/intro.smk').httpRange, true);
for (const url of ['game/plugin.dll', 'game/music.wav', 'game/game.ini', 'game/small.dat',
  'game/save/slot1.sav', 'game/pinned.bin']) {
  assert.strictEqual(byUrl.get(url), files.find(f => f.url === url), `${url} stays eager and untouched`);
}
assert.strictEqual(byUrl.get('game/ranged.mpq'), files[7], 'an explicit httpRange/preloadRanges entry is left as written');
assert.strictEqual(summary.lazyFiles, 3, 'two defaults plus the explicit ranged archive');
assert.strictEqual(summary.lazyBytes, 82 * MB);

// Audio streams only when the exe hands no file to a synchronous WINMM call.
const { importsSyncAudio } = require('../lib/app-files');
const bytesWith = s => Uint8Array.from([0x4d, 0x5a, 0, ...Buffer.from(s, 'latin1'), 0, 7]);
assert.strictEqual(importsSyncAudio(bytesWith('PlaySoundA')), true, 'PlaySoundA import');
assert.strictEqual(importsSyncAudio(bytesWith('mciSendStringA')), true);
assert.strictEqual(importsSyncAudio(bytesWith('AIL_open_digital_driver')), false, 'Miles only');
assert.strictEqual(importsSyncAudio(bytesWith('mmioOpenA')), false, 'mmio refills park');
assert.strictEqual(normalizeLazyFiles({}, [{ url: 'game/intro.avi', size: 30 * MB }]).files[0].httpRange, true,
  'the AVI reader parks, so a movie streams');
assert.strictEqual(importsSyncAudio(bytesWith('PlaySoundAEx')), false, 'a longer identifier is not the import');
assert.strictEqual(importsSyncAudio(null), true, 'unknown bytes: conservative');
const wav = [{ url: 'game/sfx.wav', size: 3 * MB }, { url: 'game/data.pak', size: 20 * MB }];
assert.strictEqual(normalizeLazyFiles({}, wav).files[0], wav[0], 'audio eager by default');
assert.strictEqual(normalizeLazyFiles({}, wav, { syncAudio: true }).files[0], wav[0]);
assert.strictEqual(normalizeLazyFiles({}, wav, { syncAudio: false }).files[0].httpRange, true,
  'audio streams when nothing synchronous reads it');

// A string entry becomes {url, httpRange}; sizeOf supplies a size the entry
// lacks (it decides small-file and small-app eagerness).
// Unknown size stays eager: a small file a synchronous consumer reads must
// not stream (AoE II's unsized EULA.RTF went black in the page that way).
const unknown = normalizeLazyFiles({}, ['game/big.pak', 'game/EULA.RTF', { url: 'game/x.pak', size: 20 * MB }]);
assert.strictEqual(unknown.files[0], 'game/big.pak', 'an unsized file stays eager');
assert.strictEqual(unknown.files[1], 'game/EULA.RTF');
assert.strictEqual(unknown.files[2].httpRange, true, 'a sized large file still streams');
assert.strictEqual(normalizeLazyFiles({}, ['game/big.pak'], { sizeOf: () => null }).files[0], 'game/big.pak');
const sized = normalizeLazyFiles({}, ['game/big.pak'], { sizeOf: () => 20 * MB });
assert.deepStrictEqual(sized.files, [{ url: 'game/big.pak', httpRange: true }]);
const tiny = normalizeLazyFiles({}, ['game/big.pak', { url: 'game/x.pak', size: 20 * MB }], { sizeOf: () => 1000 });
assert.strictEqual(tiny.files[0], 'game/big.pak', 'sizeOf below the small-file limit keeps it eager');

// Whole-app eager cases.
const small = [{ url: 'a.dat', size: APP_EAGER_BYTES - 1 - SMALL_FILE_BYTES }, { url: 'b.dat', size: SMALL_FILE_BYTES }];
assert.strictEqual(normalizeLazyFiles({}, small).summary.policy, 'eager: small app');
assert.deepStrictEqual(normalizeLazyFiles({}, small).files, small);
assert.strictEqual(normalizeLazyFiles({ lazyFiles: false }, files).summary.policy, 'eager: app.lazyFiles false');
assert.deepStrictEqual(normalizeLazyFiles({ lazyFiles: false }, files).files, files);
assert.strictEqual(normalizeLazyFiles({}, files, { isWin16: true }).summary.policy, 'eager: Win16 image');
assert.strictEqual(normalizeLazyFiles({}, []).summary.policy, 'eager: small app');

// Every lazy entry it produces passes host.js loadFiles' manifest validation.
for (const f of out) {
  if (f.loadMode === undefined) continue;
  assert(['required', 'lazy', 'background'].includes(f.loadMode));
  assert(Number.isSafeInteger(f.size) && f.size >= 0);
  assert(!(f.loadMode !== 'required' && (f.decodeImage || f.preloadRanges)));
}

// Both hosts are wired to it.
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
assert(/appFiles\.normalizeLazyFiles\(app, app\.files/.test(read('lib/browser-shell.js')), 'browser-shell applies the policy');
assert(/require\('\.\.\/lib\/app-files'\)\.normalizeLazyFiles/.test(read('test/run.js')), 'run.js applies the policy');
assert(/"lib\/app-files\.js"/.test(read('index.html')), 'index.html loads lib/app-files.js');

console.log('PASS app file policy: large data streams; exe/dll/sync-consumer/small/persisted files eager; small, Win16 and opted-out apps fully eager');
