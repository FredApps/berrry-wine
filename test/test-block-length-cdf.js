#!/usr/bin/env node
// tools/block-length-cdf.js, over a committed fixture.
//
// The fixture is nine REAL basic blocks of test/binaries/entertainment-pack/
// freecell.exe -- one each of body length 1, 2, 3, 5, 8, 11, 12, 14 and 18
// micro-ops, a hundred hits each -- so the assertions below exercise the
// shipped cost model at its breakeven rather than around it: the 11-uop block
// must decline and the 12-uop block must install, which is what
// `$BX_C_ENTRY` 190 / `$BX_C_UOP` 16 in src/07c-block-exec.wat means.
'use strict';

const assert = require('assert');
const path = require('path');
const { loadImage } = require('../tools/block-regions.js');
const cdf = require('../tools/block-length-cdf.js');

const REPO = path.join(__dirname, '..');
const FIX = path.join(REPO, 'test/fixtures/block-length-cdf');

// ---------------------------------------------------- the cost model alone --

const insn = s => ({ insn: s, mnem: s.split(/[\s,]/)[0].toLowerCase() });
const rep = (s, n) => Array.from({ length: n }, () => insn(s));

assert.strictEqual(cdf.BX_C_ENTRY, 190, 'cost model drifted from 07c-block-exec.wat');
assert.strictEqual(cdf.BX_C_UOP, 16);
assert.strictEqual(cdf.BX_C_FALLBACK, 20);

// 16*11 = 176 <= 190: declines.  16*12 = 192 > 190: installs.  That pair IS
// the "breakeven at ~12 native micro-ops" the design quotes.
assert.strictEqual(cdf.costModel(rep('mov eax,ebx', 11)).accept, false);
assert.strictEqual(cdf.costModel(rep('mov eax,ebx', 12)).accept, true);

// One TU_FALLBACK micro-op costs $BX_C_FALLBACK, so a 12-native block that
// also carries one falls back below the line: 192 <= 190 + 20.
{
  const body = rep('mov eax,ebx', 12).concat([insn('bswap eax')]);
  const cm = cdf.costModel(body);
  assert.strictEqual(cm.nat, 12);
  assert.strictEqual(cm.nfb, 1);
  assert.strictEqual(cm.accept, false, 'a fallback op must be charged 20ns');
}

// x87 is a HARD decline while $block_exec_x87 is 0 (handlers 188-190 are in
// $bx_op_unsafe), however long the block is.
{
  const cm = cdf.costModel(rep('mov eax,ebx', 40).concat([insn('fld dword [esi]')]));
  assert.strictEqual(cm.x87, 1);
  assert.strictEqual(cm.accept, false, 'an x87 body must decline outright');
}

// Spot checks on the static classifier's three verdicts.
assert.strictEqual(cdf.classifyInsn(insn('lea eax,[ebx+4]')), 'native');
assert.strictEqual(cdf.classifyInsn(insn('push ebp')), 'native');
assert.strictEqual(cdf.classifyInsn(insn('shl eax,3')), 'native');
assert.strictEqual(cdf.classifyInsn(insn('shl eax,cl')), 'fallback');
assert.strictEqual(cdf.classifyInsn(insn('imul eax,edx')), 'native');
assert.strictEqual(cdf.classifyInsn(insn('imul ecx')), 'fallback');
assert.strictEqual(cdf.classifyInsn(insn('div ecx')), 'fallback');
assert.strictEqual(cdf.classifyInsn(insn('fstp qword [esp]')), 'x87');

// --------------------------------------------------- summarize() arithmetic --

{
  // Two blocks: 100 ops in a 4-uop block, 300 in a 20-uop one.
  const s = cdf.summarize([
    { len: 4, ops: 100, accept: false },
    { len: 20, ops: 300, accept: true },
  ]);
  assert.strictEqual(s.ops, 400);
  assert.strictEqual(s.p50, 20, 'p50 is ops-weighted, not block-weighted');
  assert.strictEqual(s.atLeast[4], 1);
  assert.strictEqual(s.atLeast[16], 0.75);
  assert.strictEqual(s.reachable, 0.75);
}

// ------------------------------------------------- the dump path, end to end --

{
  const images = [loadImage(path.join(REPO, 'test/binaries/entertainment-pack/freecell.exe'))];
  const r = cdf.cdfFromDump({
    dumpFile: path.join(FIX, 'freecell-hot.txt'),
    window: 'fixture', images,
  });

  assert.strictEqual(r.blocks, 9, 'every fixture address must decode');
  assert.strictEqual(r.unmappedBlocks, 0);
  assert.strictEqual(r.undecodableTransfers, 0);
  assert.strictEqual(r.transfers, 900);

  const lens = r.hist.map(h => h.len).sort((a, b) => a - b);
  assert.deepStrictEqual(lens, [1, 2, 3, 5, 8, 11, 12, 14, 18],
    'fixture block lengths changed -- re-pick the fixture, do not relax this');

  // ops = hits x static instruction count, and instruction count is body + the
  // threaded terminator.
  const expectedOps = lens.reduce((s, L) => s + 100 * (L + 1), 0);
  assert.strictEqual(r.ops, expectedOps);
  assert.strictEqual(expectedOps, 8300);

  // Only the 12/14/18-uop blocks clear the cost model.
  assert.strictEqual(Math.round(r.reachable * 10000) / 10000,
    Math.round((100 * (13 + 15 + 19) / 8300) * 10000) / 10000);
  assert.strictEqual(r.atLeast[12], r.reachable,
    'with no fallbacks and no x87, reachable == share>=12');
  assert.strictEqual(r.p50, 12);
}

// ----------------------------------------------------------- the index path --

{
  const r = cdf.cdfFromIndex(path.join(FIX, 'index.json'));
  assert.strictEqual(r.partial, true);
  assert.strictEqual(r.ops, 760);
  assert.strictEqual(r.window, 'fixture-window');
  // lens are ops-1: 2, 12, 19.  460 of 760 ops sit at >= 12.
  assert.strictEqual(Math.round(r.atLeast[12] * 1000) / 1000,
    Math.round((460 / 760) * 1000) / 1000);
  assert.strictEqual(r.reachable, undefined,
    'index.json carries no instructions, so it cannot answer the cost model');
}

console.log('test-block-length-cdf: OK');
