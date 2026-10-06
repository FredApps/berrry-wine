#!/usr/bin/env node
'use strict';

// lib/app-files.js: the default download policy both hosts apply to an app's
// companion files. Everything streams -- small files too -- except, by file
// class, what a synchronous (non-parking) consumer reads; small, Win16 and
// opted-out apps stay fully eager; explicit declarations win.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeLazyFiles, APP_EAGER_BYTES, importsSyncImages,
} = require('../lib/app-files');

const MB = 1024 * 1024;
const files = [
  { url: 'game/data/levels.pak', vfsPath: 'c:\\data\\levels.pak', size: 40 * MB },
  { url: 'game/movies/intro.smk', vfsPath: 'c:\\movies\\intro.smk', size: 12 * MB },
  { url: 'game/plugin.dll', vfsPath: 'c:\\plugin.dll', size: 2 * MB },
  { url: 'game/music.wav', vfsPath: 'c:\\music.wav', size: 3 * MB },
  { url: 'game/game.ini', vfsPath: 'c:\\game.ini', size: 900 },
  { url: 'game/small.dat', vfsPath: 'c:\\small.dat', size: 1000 },
  { url: 'game/save/slot1.sav', vfsPath: 'c:\\save\\slot1.sav', size: 1 * MB },
  { url: 'game/ranged.mpq', vfsPath: 'c:\\ranged.mpq', size: 30 * MB, httpRange: true, preloadRanges: [[0, 4096]] },
  { url: 'game/pinned.bin', vfsPath: 'c:\\pinned.bin', size: 9 * MB, eager: true },
];
const app = { persistFiles: ['c:\\save\\*.sav'] };

const { files: out, summary } = normalizeLazyFiles(app, files);
const byUrl = new Map(out.map(f => [f.url, f]));
assert.strictEqual(summary.policy, 'lazy');
assert.deepStrictEqual(byUrl.get('game/data/levels.pak'),
  { ...files[0], httpRange: true, size: 40 * MB }, 'large data streams through httpRange, with its size');
assert.strictEqual(byUrl.get('game/data/levels.pak').loadMode, undefined,
  'never a sized loadMode: that refuses to fall back when a host answers 200');
assert.strictEqual(byUrl.get('game/movies/intro.smk').httpRange, true);
assert.deepStrictEqual(byUrl.get('game/small.dat'), { ...files[5], httpRange: true, size: 1000 },
  'a small file streams too: there is no size rule, only file classes');
assert.strictEqual(byUrl.get('game/music.wav').httpRange, true,
  'audio streams: every reader of a sound file parks or attaches late');
for (const url of ['game/plugin.dll', 'game/game.ini', 'game/save/slot1.sav', 'game/pinned.bin']) {
  assert.strictEqual(byUrl.get(url), files.find(f => f.url === url), `${url} stays eager and untouched`);
}
assert.strictEqual(byUrl.get('game/ranged.mpq'), files[7], 'an explicit httpRange/preloadRanges entry is left as written');
assert.strictEqual(summary.lazyFiles, 5, 'four defaults plus the explicit ranged archive');

const bytesWith = s => Uint8Array.from([0x4d, 0x5a, 0, ...Buffer.from(s, 'latin1'), 0, 7]);
assert.strictEqual(normalizeLazyFiles({}, [{ url: 'game/intro.avi', size: 30 * MB }]).files[0].httpRange, true,
  'the AVI reader parks, so a movie streams');
const wav = [{ url: 'game/sfx.wav', size: 3 * MB }, { url: 'game/data.pak', size: 20 * MB }];
assert.strictEqual(normalizeLazyFiles({}, wav).files[0].httpRange, true,
  'audio streams even for an app that names PlaySound/MCI');

// Images stream unless the exe can load one from a file synchronously.
assert.strictEqual(importsSyncImages(bytesWith('LoadImageA')), true);
assert.strictEqual(importsSyncImages(bytesWith('LoadCursorFromFileA')), true);
assert.strictEqual(importsSyncImages(bytesWith('LoadBitmapA')), false, 'LoadBitmap reads resources, not files');
assert.strictEqual(importsSyncImages(null), true, 'unknown bytes: conservative');
const art = [{ url: 'game/title.bmp', size: 300000 }, { url: 'game/data.pak', size: 20 * MB }];
assert.strictEqual(normalizeLazyFiles({}, art).files[0], art[0], 'images eager by default');
assert.strictEqual(normalizeLazyFiles({}, art, { syncImages: false }).files[0].httpRange, true,
  'images stream when nothing loads them from a file synchronously');

// Unknown size stays eager (a registry the size map does not cover yet);
// sizeOf supplies a size the entry lacks.
const unknown = normalizeLazyFiles({}, ['game/big.pak', 'game/EULA.RTF', { url: 'game/x.pak', size: 20 * MB }]);
assert.strictEqual(unknown.files[0], 'game/big.pak', 'an unsized file stays eager');
assert.strictEqual(unknown.files[1], 'game/EULA.RTF');
assert.strictEqual(unknown.files[2].httpRange, true, 'a sized file streams');
const sized = normalizeLazyFiles({}, ['game/big.pak', { url: 'game/x.pak', size: 20 * MB }], { sizeOf: () => 1000 });
assert.deepStrictEqual(sized.files[0], { url: 'game/big.pak', httpRange: true, size: 1000 });
assert.strictEqual(normalizeLazyFiles({}, [{ url: 'game/EULA.RTF', size: 6449 }, { url: 'x.pak', size: 20 * MB }]).files[0].httpRange,
  undefined, 'rtf is an eager class (a reader that cannot park)');

// Whole-app eager cases.
const small = [{ url: 'a.dat', size: APP_EAGER_BYTES - 2 }, { url: 'b.dat', size: 1 }];
assert.strictEqual(normalizeLazyFiles({}, small).summary.policy, 'eager: small app');
assert.deepStrictEqual(normalizeLazyFiles({}, small).files, small);
assert.strictEqual(normalizeLazyFiles({ lazyFiles: false }, files).summary.policy, 'eager: app.lazyFiles false');
assert.deepStrictEqual(normalizeLazyFiles({ lazyFiles: false }, files).files, files);
assert.strictEqual(normalizeLazyFiles({}, files, { isWin16: true }).summary.policy, 'eager: Win16 image');
assert.strictEqual(normalizeLazyFiles({}, []).summary.policy, 'eager: small app');

// The policy never emits a sized loadMode (host.js validates those strictly).
for (const f of out) {
  if (f.loadMode === undefined) continue;
  assert(['required', 'lazy', 'background'].includes(f.loadMode));
}

// Both hosts are wired to it.
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
assert(/appFiles\.normalizeLazyFiles\(app, app\.files/.test(read('lib/browser-shell.js')), 'browser-shell applies the policy');
assert(/importsSyncImages\(wine\._exeBytes\)/.test(read('lib/browser-shell.js')), 'browser-shell checks image loaders');
assert(/require\('\.\.\/lib\/app-files'\)\.normalizeLazyFiles/.test(read('test/run.js')), 'run.js applies the policy');
assert(/importsSyncImages\(fs\.readFileSync\(EXE_PATH\)\)/.test(read('test/run.js')), 'run.js checks image loaders');
assert(/"lib\/app-files\.js"/.test(read('index.html')), 'index.html loads lib/app-files.js');

console.log('PASS app file policy: everything streams except non-parking file classes; small, Win16 and opted-out apps fully eager');
