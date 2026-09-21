#!/usr/bin/env node
'use strict';

// The Quake II demo is published under id's own demo license, which lets it be
// copied freely only with that license beside it (§3). So check three things
// about what a deploy would upload: everything the game mounts is there, the
// license and the source note are there, and nothing ELSE from the extracted
// installer is -- no 3Dfx/PowerVR drivers, no manual, no 39MB installer.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DESKTOP_APPS, APPS, appFileUrl } = require('../lib/apps');
const { desktopAssetPaths, shipsAsSiteText } = require('../tools/deploy-berrry');
const iconManifest = require('../lib/app-icon-manifest.json');

const ROOT = path.join(__dirname, '..');
const id = 'quake2_demo';
const app = APPS[id];
const root = path.dirname(app.exe) + '/';

assert(DESKTOP_APPS.some(([name]) => name === id), 'Quake II Demo must appear on the desktop');
assert(iconManifest.icons.includes(id), 'Quake II Demo must have a desktop icon');
assert(fs.existsSync(path.join(ROOT, 'icons', 'apps', `${id}.png`)), 'Quake II icon is missing');

const mounted = [app.exe, ...app.dlls, ...app.files.map(appFileUrl)];
const license = root + 'DOCS/license.txt';
const source = 'lib/quake2-demo-source.txt';
assert(mounted.includes(license), 'the demo license must be mounted with the game (§3)');
assert(mounted.includes(source), 'the source note must be mounted with the game');

const deployed = desktopAssetPaths();
const haveAssets = fs.existsSync(path.join(ROOT, app.exe));
if (haveAssets) {
  for (const file of mounted) {
    if (file.startsWith('lib/')) continue;       // the site's own files, below
    assert(deployed.has(file), `deploy is missing ${file}`);
  }
}
// A site file ships only if its extension is on the deploy's text list; the
// source note 404'd on the first deploy because .txt was not.
for (const file of mounted.filter(f => f.startsWith('lib/')))
  assert(shipsAsSiteText(file), `deploy does not ship ${file}`);
const extra = [...deployed].filter(p => p.startsWith(root) && !mounted.includes(p));
assert.deepStrictEqual(extra, [], 'deploy ships Quake files the game does not mount');
assert(![...deployed].some(p => /quake-2-demo-installer\/[^/]+\.exe$/i.test(p)),
  'the installer itself must not ship');

// The note's hashes must be the ones of the installer we extracted from.
const note = fs.readFileSync(path.join(ROOT, source), 'utf8');
const installer = path.join(ROOT, root, '../../../q2-314-demo-x86.exe');
if (fs.existsSync(installer)) {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(installer)).digest('hex');
  assert(note.includes(md5), `source note does not carry the installer's MD5 ${md5}`);
}
assert(/ftp\.idsoftware\.com\/idstuff\/quake2\/q2-314-demo-x86\.exe/.test(note),
  'source note must name id\'s official download');

console.log(`PASS  Quake II Demo desktop entry, license, source note and release assets`
  + (haveAssets ? '' : ' (assets not present: file checks skipped)'));
