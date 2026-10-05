#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { APPS } = require(path.join(__dirname, '..', 'lib', 'apps.js'));
const mcm = APPS.mcm;
const files = mcm.files;
const installRoot =
  'c:\\program files\\microsoft games\\motocross madness trial\\';

assert(files.length > 300, 'MCM manifest must include the complete trial media tree');
assert(files.every(file => file && typeof file === 'object' &&
  typeof file.url === 'string' && typeof file.vfsPath === 'string'),
'MCM assets must carry explicit VFS paths instead of basename mounts');

// MCM opens media both relative to its working directory (ui\cursor.tga,
// sbike\*.vub) and below the registry's HardDriveRootPath. On a real install
// those are one Program Files directory. Every asset lives there and the
// process starts there; C:\ itself must stay empty of media, because the
// scene list also probes the (absent) CD root as \teraform\..., and a second
// Quarry01.scn hit on C:\ makes MCM's duplicate filter drop its only quarry.
assert.strictEqual(mcm.workingDirectory, installRoot,
  'MCM starts in its install directory');
assert(files.every(file => file.vfsPath.toLowerCase().startsWith(installRoot)),
  'every MCM asset mounts under the install root');
assert(mcm.persistFiles.length === 2 &&
  mcm.persistFiles.every(pattern => pattern.toLowerCase().startsWith(installRoot + 'ui\\')),
'MCM profiles persist where the game writes them, below its install root');

const bySuffix = suffix => files.find(file =>
  file.url.toLowerCase().endsWith(suffix.toLowerCase()));
for (const [suffix, relative] of [
  ['/TERAFORM/QUARRIES/QUARRY01.SCN', 'TERAFORM\\QUARRIES\\QUARRY01.SCN'],
  ['/TERAFORM/NATIONAL/NATION16.SCN', 'TERAFORM\\NATIONAL\\NATION16.SCN'],
  ['/TERAFORM/QUARRIES/QUARRY01.TRN', 'TERAFORM\\QUARRIES\\QUARRY01.TRN'],
  ['/UI/GLOBAL.DAT', 'UI\\GLOBAL.DAT'],
  ['/SBIKE/RIDER.SLT', 'SBIKE\\RIDER.SLT'],
  ['/UI/ART/16X12/POSE_01A.TGA', 'UI\\ART\\16X12\\POSE_01A.TGA'],
]) {
  const file = bySuffix(suffix);
  assert(file, `MCM manifest must include ${suffix}`);
  assert.strictEqual(file.vfsPath, installRoot + relative,
    `${suffix} must keep its media hierarchy`);
}

const scenes = files.filter(file => /\.scn$/i.test(file.url));
assert.strictEqual(scenes.length, 2, 'trial media has exactly two selectable scenes');

const storage = fs.readFileSync(path.join(__dirname, '..', 'lib', 'storage.js'), 'utf8');
const seed = storage.match(/Motocross Madness Trial\\\\1\.0': \{[\s\S]*?\n    \},/);
assert(seed, 'lib/storage.js seeds the MCM trial registry key');
assert(/'HardDriveRootPath': \{ type: 1, data: 'C:\\\\Program Files\\\\Microsoft Games\\\\Motocross Madness Trial\\\\' \}/
  .test(seed[0]), 'HardDriveRootPath must name the directory the manifest mounts into');

console.log(`PASS  ${files.length} MCM files share the install root with cwd and registry`);
