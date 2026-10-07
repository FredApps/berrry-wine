'use strict';
const assert = require('node:assert/strict'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = process.argv[2];
if (!root || !process.argv.includes('--slot-granted')) throw Error('canonical.test.js source-root --slot-granted; actual compile/WASM proof');
const rows = ['baseline','candidate'].map(mode => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'fixture-child.js'), root, mode], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout.trim().split('\n').at(-1));
});
assert.deepEqual(rows[0].sourceClosure, rows[1].sourceClosure, 'same original loaded source closure');
assert.equal(rows[0].emitter.originalSha256, rows[1].emitter.originalSha256);
assert.notEqual(rows[0].moduleSha256, rows[1].moduleSha256, 'diagnostic compiled shape differs');
assert.equal(rows[1].recorded.count, 2); assert.equal(rows[1].recorded.last, 0x56789000);
for (const key of ['exited','exitCode','registers','cr0','memorySha256']) assert.deepEqual(rows[0][key], rows[1][key], key + ' unchanged');
assert.equal(rows[0].exited, true);
console.log(JSON.stringify({ passed: true, scope: 'real MOV CR3 recording; original registers/memory/exit unchanged; no paging correctness claim', rows }));
