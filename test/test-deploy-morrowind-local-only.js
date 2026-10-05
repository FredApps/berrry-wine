#!/usr/bin/env node
'use strict';
// Morrowind is retail: the `morrowind` entry may appear in the localhost
// dropdown, but none of its bytes may ever reach the public deploy or git.

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { APPS, DESKTOP_APPS, LOCAL_CANDIDATE_APPS, DEBUG_ONLY_APPS } = require('../lib/apps');
const { desktopAssetPaths, neverPublish } = require('../tools/deploy-berrry');

const id = 'morrowind';
const app = APPS[id];
assert(app, 'lib/apps.js has the morrowind entry');
assert(LOCAL_CANDIDATE_APPS.some(([name]) => name === id), 'morrowind is a local candidate');
assert(!DESKTOP_APPS.some(([name]) => name === id), 'morrowind is never a public desktop app');
assert(!DEBUG_ONLY_APPS.some(([name]) => name === id), 'morrowind is not a debug-only app either');
// The <select> is hand-written: an entry with no <option> is only an icon.
// Off localhost the page removes every option not in DESKTOP_APPS.
assert(require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .includes(`<option value="${id}">`), 'index.html has the dropdown option');

// Every way the entry names its bytes is refused, including the `binaries`
// symlink spelling a future edit might use and the disc image itself.
const named = [app.exe, ...(app.dlls || []), app.localFileManifest, app.cdAudio.cue,
  app.exe.replace(/^test\//, ''), 'downloads/Morrowind.iso', './downloads/Morrowind.iso',
  'TEST/Binaries/Candidates/Morrowind/installed/Data Files/Morrowind.bsa'];
for (const p of named) assert(neverPublish(p), `deploy refuses ${p}`);
for (const p of ['binaries/notepad.exe', 'lib/apps.js', 'test/binaries/candidates/diablo-shareware/installed/x'])
  assert(!neverPublish(p), `deploy still allows ${p}`);

const deployed = [...desktopAssetPaths()];
const leaked = deployed.filter(p => neverPublish(p) || /morrowind/i.test(p));
assert.deepStrictEqual(leaked, [], 'the release asset set holds no Morrowind file');

const tracked = execFileSync('git', ['ls-files', '--', 'test/binaries/candidates/morrowind', ':(icase)downloads/*morrowind*'],
  { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
assert.strictEqual(tracked, '', 'git tracks no Morrowind media');

console.log(`PASS  morrowind is localhost-only: ${named.length} spellings refused, ` +
  `${deployed.length} release assets clean, nothing tracked`);
