'use strict';

// Exercise the real build CLI/filesystem in a disposable repository. A tiny
// valid module replaces the expensive compiler; output routing is not mocked.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-build-outputs-'));
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
try {
  fs.mkdirSync(path.join(root, 'tools'));
  fs.mkdirSync(path.join(root, 'build'));
  fs.copyFileSync(path.join(__dirname, '../tools/build-compile-wat.js'), path.join(root, 'tools/build-compile-wat.js'));
  fs.writeFileSync(path.join(root, 'tools/watx-closure.js'), `
    exports.watxSourceClosure = () => ({ entry: 'fixture' });
    exports.compileClosure = () => ({ success: true,
      wasmBinary: Buffer.from([0,97,115,109,1,0,0,0]) });
  `);
  fs.writeFileSync(path.join(root, 'tools/region-layout-hash.js'),
    'exports.appendSection = bytes => bytes; exports.layoutHash = () => "fixture";');
  fs.mkdirSync(path.join(root, 'lib'));
  fs.writeFileSync(path.join(root, 'lib/dispatch-trampoline.js'), 'exports.applyToVfs = vfs => vfs;');
  const shared = ['wine-assembly.wasm', 'wine-assembly.compat.wasm', 'wine-assembly.named.wasm'];
  shared.forEach(name => fs.writeFileSync(path.join(root, 'build', name), `shared:${name}`));
  function run(args, ok = true) {
    const result = spawnSync(process.execPath, [path.join(root, 'tools/build-compile-wat.js'), ...args], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, WINE_WAT_COMPILER: 'watx', WINE_WAT_NAMES: '', WINE_REGION_SHAKE: '' },
    });
    if (ok) assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    else assert.notStrictEqual(result.status, 0);
    return result;
  }
  function unchanged() {
    shared.forEach(name => assert.strictEqual(fs.readFileSync(path.join(root, 'build', name), 'utf8'), `shared:${name}`));
  }
  function emitted(name) { assert.deepStrictEqual(fs.readFileSync(path.join(root, name)), wasm); }
  run(['--out=scratch/probe.wasm', '--names']);
  ['scratch/probe.wasm', 'scratch/probe.compat.wasm', 'scratch/probe.named.wasm'].forEach(emitted);
  unchanged();
  run(['--out=scratch/probe.wasm']);
  assert(!fs.existsSync(path.join(root, 'scratch/probe.named.wasm')));
  unchanged();
  run([`--out=${path.join(root, 'absolute', 'probe')}`, '--names']);
  ['absolute/probe', 'absolute/probe.compat.wasm', 'absolute/probe.named.wasm'].forEach(emitted);
  unchanged();
  run(['--out=scratch/custom.wasm', '--compat-out=other/compat.wasm', '--named-out=names/nested/debug.wasm', '--names']);
  ['scratch/custom.wasm', 'other/compat.wasm', 'names/nested/debug.wasm'].forEach(emitted);
  unchanged();
  for (const flag of ['--compat-out=scratch/probe.wasm', '--named-out=scratch/probe.wasm']) {
    const result = run(['--out=scratch/probe.wasm', flag], false);
    assert.match(result.stderr, /must be distinct/);
  }
  unchanged();
  run(['--names']);
  shared.forEach(name => emitted(`build/${name}`));
  run([]);
  assert(!fs.existsSync(path.join(root, 'build/wine-assembly.named.wasm')));
  console.log('PASS build output isolation: scratch, absolute, overrides, cleanup, collisions, canonical defaults');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
