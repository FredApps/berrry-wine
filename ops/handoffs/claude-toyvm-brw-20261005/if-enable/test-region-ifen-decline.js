#!/usr/bin/env node
'use strict';
// Static test of the IF-enable candidate's region decline (region-jit.js
// buildRegion), WITHOUT running the emulator: no VM, no wasm, no guest. It
// calls the tree's real `buildRegion` with minimal op objects -- the decline is
// the function's first decision after prepareTables() (pure table generation),
// and it reads only each op's `name`.
//
// What it covers that the fixture cannot: the DETOUR-ARM path. A region whose
// detour arm holds an IF-boundary op must be declined (candidate v2,
// ee8265ba); v1 (886c2118) scanned only the path's ops, before detours were
// appended. The fixture never builds a region with a detour, so this path had
// no coverage at all.
//
// What it does NOT show: that a real program produces such a region, that the
// region JIT reaches buildRegion for one, or anything about execution. It is a
// unit test of one decision.
//
//   TOYVM_TREE=<tree> node test-region-ifen-decline.js [--expect=v2|v1]
// --expect=v1 runs the same cases against a v1 tree and asserts that the
// DETOUR cases are NOT declined there -- the discrimination check that shows
// the test would have caught v1's gap.

const assert = require('assert');
const path = require('path');
const tree = process.env.TOYVM_TREE;
if (!tree) { console.error('TOYVM_TREE=<tree> required'); process.exit(2); }
const expect = (process.argv.find((a) => a.startsWith('--expect=')) || '--expect=v2').slice(9);
const { buildRegion } = require(path.join(path.resolve(tree), 'tools/toyvm/region-jit.js'));

const op = (name) => ({ name, args: [], at: 0 });
const IFDECL = /\(IF-enable boundary\)/;
// Call buildRegion; return its decline reason, or the error it threw past the
// IF scan (fake ops are not real arena ops, so a non-declined region may throw
// later, in stripArenaOperands or the tiers -- that is fine: the IF scan ran
// first and did not decline).
function decide(rawOps, forwards) {
  try {
    const r = buildRegion(rawOps, rawOps.map(() => 0), 0x100, 'r_test', true, [], forwards);
    return { declined: r && r.declined ? r.declined : null, threw: null };
  } catch (e) { return { declined: null, threw: String(e && e.message || e) }; }
}
let n = 0, failed = 0;
const check = (name, fn) => { n++; try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };
const detour = (names) => ({ op: 0, ip: 0x200, kind: 'head', detour: { ops: names.map(op), nexts: names.map(() => 0), join: 0x100 } });

if (expect === 'v2') {
  check('path op sti declines', () => {
    assert.match(decide([op('add_rr16'), op('sti'), op('jmp')], []).declined || '', /contains sti \(IF-enable boundary\)/);
  });
  check('path op popf32 declines', () => {
    assert.match(decide([op('popf32'), op('jmp')], []).declined || '', /contains popf32 /);
  });
  check('DETOUR arm with popf declines (the v2 fix)', () => {
    assert.match(decide([op('add_rr16'), op('jmp')], [detour(['inc_r16', 'popf'])]).declined || '', /contains popf \(IF-enable boundary\)/);
  });
  check('DETOUR arm with jmp_ifen declines', () => {
    assert.match(decide([op('add_rr16'), op('jmp')], [detour(['jmp_ifen'])]).declined || '', /contains jmp_ifen /);
  });
  check('second of two detours with sti declines', () => {
    assert.match(decide([op('jmp')], [detour(['inc_r16']), detour(['sti'])]).declined || '', /contains sti /);
  });
  check('a declined region leaves the caller\'s forwards and rawOps untouched', () => {
    const raw = [op('add_rr16'), op('jmp')], fw = [detour(['popf'])];
    decide(raw, fw);
    assert.strictEqual(raw.length, 2); assert.strictEqual('start' in fw[0], false);
  });
  check('control: no boundary op anywhere is NOT an IF decline', () => {
    const r = decide([op('add_rr16'), op('jmp')], [detour(['inc_r16'])]);
    assert.ok(!IFDECL.test(r.declined || ''), `declined: ${r.declined}`);
    assert.ok(!IFDECL.test(r.threw || ''), `threw: ${r.threw}`);
  });
} else if (expect === 'v1') {
  // v1 declines on the PATH but not on a detour arm.
  check('v1: path op sti declines', () => {
    assert.match(decide([op('add_rr16'), op('sti'), op('jmp')], []).declined || '', IFDECL);
  });
  check('v1: DETOUR arm with popf is NOT declined (the gap v2 closes)', () => {
    const r = decide([op('add_rr16'), op('jmp')], [detour(['inc_r16', 'popf'])]);
    assert.ok(!IFDECL.test(r.declined || ''), `v1 declined it: ${r.declined}`);
  });
} else { console.error('--expect=v2|v1'); process.exit(2); }
console.log(`${n - failed}/${n} passed (${expect}, ${tree})`);
process.exit(failed ? 1 : 0);
