#!/usr/bin/env node
'use strict';
// Exercise the IF fixture's engagement parser on lines produced by run-dos.js's
// OWN report statements (base 2683a6e3), evaluated with stub run objects --
// source-only, no emulator. No real captured run-dos output with these arm
// lines exists on this box (searched scratch/, docs/, ops/, the session tmp),
// so this is the closest check available without a rerun.
//   node engagement-parser-check.js [--show]
const { spawnSync } = require('child_process');
const assert = require('assert');
const src = spawnSync('git', ['-C', '/home/user/wine-assembly', 'show', '2683a6e31d0e95e7ffd1805fcafe013f94f1bcec:tools/toyvm/run-dos.js'],
  { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout;

// The full console.log(...) statement starting at `marker` (balanced parens,
// skipping string and template literal contents is not needed here because the
// statements' own text is balanced).
function statement(marker) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const open = src.indexOf('(', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(at, i + 2);
  }
  throw new Error('unbalanced');
}
function run(stmt, vars) {
  const lines = [];
  const names = Object.keys(vars);
  new Function(...names, 'console', stmt)(...names.map((n) => vars[n]), { log: (s) => lines.push(s) });
  return lines.join('\n');
}

const u = { phase: 'installed', outcome: 'ok', windows: 2, samples: 7, bestShare: 0.41, installs: 2,
  heads: [{ head: '0x13a', entries: 120, steps: 9000, bails: 1, shape: null, bailAt: ['0x13c'] }],
  entries: 120, steps: 9000, bails: 1, rebuilds: 0, gaveUp: 0, declined: [], demoted: [], exitsAt: [], chains: 0 };
const uo = { fallbacks: [{ why: 'io', entries: 3, sites: 1, steps: 40 }], passes: 'all', shape: 'loop', uopShare: 0.37,
  builds: 4, shapes: { loop: 3, line: 1 }, entries: 512, chains: 2, fbSites: 1, fbEntries: 3, fbSteps: 40,
  invalidated: 0, flushes: 0, arenaResets: 0, stays: 10, calls: 12, why: { io: 2 }, ioCuts: 0, fbExitWhy: [], buildSecs: 0.01, arenaBytes: 65536 };
const j = { backend: 'sync', phase: 'installed', at: [0x13a], declined: null, gate: 1.8, share: 41.2, installs: 1, drops: 0,
  windows: 1, skipped: 0, ms: { prepare: 1, pick: 0.2, snapshot: 0.1, gate: 3, build: 5, instantiate: 2, swap: 0.1 } };

const out = [
  run(statement("console.log(`  uop-only: "), { u: uo }),
  run(statement("console.log(`  uop: ${u.phase}"), { u, r: { dispatched: 6e6 } }),
  run(statement("console.log(`  region jit ("), { j }),
  // The handbacks summary line that carries ", N tree folds": every field not
  // set here reads 0 (falsy), so only the clauses the stub sets are printed.
  run(statement("console.log(`  ${r.handbacks} handbacks, ${r.ints} interrupts`"),
    { r: new Proxy({ handbacks: 9000, ints: 21, treeFolds: 3 }, { get: (o, k) => (k in o ? o[k] : 0) }) }),
].join('\n');

// The fixture's parser, loaded from the fixture itself.
const fx = require('fs').readFileSync(require('path').join(__dirname, 'test-toyvm-irq-if-enable.js'), 'utf8');
const ARM_LINE = eval(`(${fx.match(/const ARM_LINE = (\{[\s\S]*?\n\});/)[1]})`);
const engagement = new Function('ARM_LINE', `${fx.match(/function engagement\(arm, out\) \{[\s\S]*?\n\}/)[0]}; return engagement;`)(ARM_LINE);

const r = { region: engagement('region', out), uop: engagement('uop', out), uopOnly: engagement('uopOnly', out),
  fold: engagement('fold', out) };
assert.strictEqual(r.fold.installed, true); assert.match(r.fold.summary, /^installed 3 tree fold\(s\)/);
if (process.argv.includes('--show')) { console.log(out); console.log(JSON.stringify(r, null, 1)); }
assert.strictEqual(r.region.installed, true); assert.match(r.region.summary, /^installed 1;/);
assert.strictEqual(r.uop.installed, true); assert.strictEqual(r.uop.executed, true); // run-dos prints u.installs as "N head(s)" (2 in the stub), not heads.length.
assert.match(r.uop.summary, /installed 2 head\(s\); executed 120 entries, 9000 steps/);
assert.strictEqual(r.uopOnly.installed, true); assert.strictEqual(r.uopOnly.executed, true); assert.match(r.uopOnly.summary, /compiled 4 program\(s\); executed 512 entries/);
// Scoping: the uop-only line also contains "entries=" (fallback entries) -- the
// parser must take the FIRST, which is the µop entries, and the uop line's
// regexes must not read the uop-only line.
assert.notStrictEqual(r.uop.summary.includes('512'), true);
// Absent lines read as not installed, never as engaged.
assert.strictEqual(engagement('region', 'nothing').installed, false);
assert.match(engagement('fold', 'nothing').summary, /^NO REPORT LINE FOUND/);
console.log('engagement parser: 10/10 checks on lines produced by run-dos.js format statements (stub values, not real runs)');
