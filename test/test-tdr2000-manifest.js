'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-manifest-'));
try {
  fs.mkdirSync(path.join(root, 'tools'));
  fs.copyFileSync(path.join(__dirname, '../tools/gen-win98-games-a-d-manifests.js'), path.join(root, 'tools/gen.js'));
  const game = path.join(root, 'test/binaries/win98-games-a-d/Carmageddon TDR2000 demo-D3D-installed');
  fs.mkdirSync(path.join(game, 'Assets'), { recursive: true });
  for (const [name, text] of Object.entries({ 'Tdr2000Demo.exe': 'exe', 'Mss32.dll': 'dll', 'Assets/options.TXT': 'original config', 'Assets/sound.INI': 'sound', 'Assets/control.CFG': 'keys', 'Assets/map.pak': 'original data', 'readme.txt': 'readme' })) {
    fs.writeFileSync(path.join(game, name), text);
  }
  const run = (...args) => cp.execFileSync(process.execPath, [path.join(root, 'tools/gen.js'), ...args], { encoding: 'utf8', stdio: 'pipe' });
  run('--only=carmageddon_tdr2000_demo');
  run('--only=carmageddon_tdr2000_demo', '--check');
  const manifest = JSON.parse(fs.readFileSync(path.join(game, '.wine-assembly-browser.json')));
  assert.equal(manifest.files.length, 5);
  const rows = Object.fromEntries(manifest.files.map(row => [row.url, row]));
  assert.equal(rows['Assets/options.TXT'].loadMode, 'required');
  assert.equal(rows['readme.txt'].loadMode, 'required');
  assert.equal(rows['Assets/sound.INI'].loadMode, 'required');
  assert.equal(rows['Assets/control.CFG'].loadMode, 'required');
  assert.equal(rows['Assets/map.pak'].loadMode, 'lazy');
  for (const row of manifest.files) {
    assert.equal(row.size, fs.statSync(path.join(game, row.url)).size);
    assert.equal(row.vfsPath, 'c:\\' + row.url.replaceAll('/', '\\'));
  }
  fs.writeFileSync(path.join(game, 'Assets/map.pak'), 'changed length');
  assert.throws(() => run('--only=carmageddon_tdr2000_demo', '--check'), /stale browser manifest/);
  const destination = path.join(game, '.wine-assembly-browser.json');
  const original = fs.readFileSync(destination);
  const preload = path.join(root, 'disk-guard.js');
  for (const mock of [
    '() => ({ bavail: 1n, bsize: 1024n })',
    '() => { throw new Error("capacity unavailable"); }',
  ]) {
    fs.writeFileSync(preload, `require('fs').statfsSync = ${mock};\n`);
    assert.throws(() => cp.execFileSync(process.execPath, ['--require', preload,
      path.join(root, 'tools/gen.js'), '--only=carmageddon_tdr2000_demo'],
    { stdio: 'pipe' }), /disk floor 2GiB|capacity unavailable/);
    assert.deepEqual(fs.readFileSync(destination), original);
  }
  const apps = require('../lib/apps');
  const app = apps.APPS.carmageddon_tdr2000_demo;
  assert.ok(app.exe.endsWith('/Tdr2000Demo.exe'));
  assert.equal(app.dlls.length, 1);
  assert.ok(app.dlls[0].endsWith('/Mss32.dll'));
  assert.ok(apps.LOCAL_CANDIDATE_APPS.some(row => row[0] === 'carmageddon_tdr2000_demo'));
  assert.ok(!apps.DESKTOP_APPS.some(row => row[0] === 'carmageddon_tdr2000_demo'));
  assert.match(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'),
    /<option value="carmageddon_tdr2000_demo">/);
  assert.equal(app.requiredFiles, true);
  assert.ok(app.localFileManifest.endsWith('/Carmageddon TDR2000 demo-D3D-installed/.wine-assembly-browser.json'));
  console.log('PASS TDR original-path manifest sizes/modes/exclusions/staleness and local-only registration');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
