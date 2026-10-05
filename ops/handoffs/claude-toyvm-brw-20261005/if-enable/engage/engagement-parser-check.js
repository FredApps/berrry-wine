#!/usr/bin/env node
'use strict';
// Source-only check of the ENGAGEMENT fixture's executed-evidence parsing. It
// renders the lines with run-dos.js's OWN code at base 2683a6e3 and stub
// values, then runs the fixture's own parser (loaded from the fixture file):
// the `--step-audit` console.log (~1583) and the `--tree-fold-stats` payoff
// expression (~1696). No emulator runs; the values are stubs, not a run.
//   node engagement-parser-check.js [--show]
const { spawnSync } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = spawnSync('git', ['-C', '/home/user/wine-assembly', 'show', '2683a6e31d0e95e7ffd1805fcafe013f94f1bcec:tools/toyvm/run-dos.js'],
  { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout;
assert.ok(src.length > 10000, 'could not read run-dos.js at base');

// A balanced-paren span of `src` starting at `marker`'s first '(' after `from`.
function span(marker, opener = '(') {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const open = src.indexOf(opener, at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return { at, end: i + 1 };
  }
  throw new Error('unbalanced');
}
// The step-audit statement: console.log(...);
const sa = span('console.log(`  step audit:');
const stepAuditStmt = src.slice(sa.at, sa.end + 1);
// The payoff formatter: the IIFE `(() => { const p = r.tree.payoff; ... })()`.
const pAt = src.indexOf('const p = r.tree.payoff;');
assert.ok(pAt > 0, 'payoff formatter not found');
const iifeStart = src.lastIndexOf('(() => {', pAt);
let depth = 0, iifeEnd = -1;
for (let i = iifeStart; i < src.length; i++) {
  if (src[i] === '(') depth++;
  else if (src[i] === ')' && --depth === 0) { iifeEnd = i + 1; break; }
}
const payoffExpr = src.slice(iifeStart, iifeEnd) + '()';
assert.ok(/^\(\(\) => \{[\s\S]*\}\)\(\)$/.test(payoffExpr), 'payoff IIFE not isolated');

function render(code, vars, isExpr) {
  const lines = [];
  const names = Object.keys(vars);
  const body = isExpr ? `return ${code};` : code;
  const v = new Function(...names, 'console', body)(...names.map((n) => vars[n]), { log: (s) => lines.push(s) });
  return isExpr ? v : lines.join('\n');
}
const u32 = new Uint32Array(8); const base = 2; u32[base] = 4321; u32[base + 1] = 4300;
const stepLine = render(stepAuditStmt, { u32, base }, false);
const payoff = (rows) => render(payoffExpr, { r: { tree: { payoff: { window: 1000000, span: 2000000, from: 1250000,
  projected: 10, actual: 12, k: 3, precision: 0.66, dead: 1, rows } } } }, true);
const rows = [{ i: 0, loop: true, ops: 9, save: 8, projected: 5, actual: 6, entries: 1700 },
  { i: 1, call: true, ops: 4, save: 3, projected: 2, actual: 1, entries: 25 },
  { i: 2, ops: 5, save: 4, projected: 1, actual: 0, entries: 0 }];
const handbacks = '  9000 handbacks, 21 interrupts, 3 tree folds';   // fold count, as the existing check renders it
const outRegion = `  region jit (sync): installed at 0x13a, 1 install(s), share 41%\n${stepLine}`;
const outFold = `${handbacks}\n${payoff(rows)}`;

const fx = fs.readFileSync(path.join(__dirname, 'test-toyvm-irq-if-enable.js'), 'utf8');
const ARM_LINE = eval(`(${fx.match(/const ARM_LINE = (\{[\s\S]*?\n\});/)[1]})`);
const STEP_AUDIT = eval(fx.match(/const STEP_AUDIT = (\/.*\/m);/)[1]);
const PAYOFF = eval(fx.match(/const PAYOFF = (\/.*\/m);/)[1]);
const engagement = new Function('ARM_LINE', 'STEP_AUDIT', 'PAYOFF',
  `${fx.match(/function engagement\(arm, out\) \{[\s\S]*?\n\}/)[0]}; return engagement;`)(ARM_LINE, STEP_AUDIT, PAYOFF);

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
if (process.argv.includes('--show')) console.log(`${outRegion}\n${outFold}`);
ok(/^ {2}step audit: regions charged 4321 steps for 4300 instruction weights$/m.test(stepLine), `step line: ${stepLine}`);
const rg = engagement('region', outRegion);
ok(rg.installed === true && rg.executed === true, JSON.stringify(rg));
ok(/regions charged 4321 steps for 4300 weights/.test(rg.summary), rg.summary);
const rz = engagement('region', outRegion.replace(/charged 4321/, 'charged 0'));
ok(rz.executed === false, 'zero charged steps must read as NOT executed');
const rn = engagement('region', '  region jit (sync): installed at 0x13a, 1 install(s)');
ok(rn.executed === null && /NO step-audit line/.test(rn.summary), 'missing step audit must be "no report", never executed');
const fs1 = engagement('foldStats', outFold);
ok(fs1.installed === true && fs1.executed === true, JSON.stringify(fs1));
ok(/1725 entries over the top-12 payoff rows/.test(fs1.summary), fs1.summary);
const fs0 = engagement('foldStats', `${handbacks}\n${payoff([{ i: 0, ops: 5, save: 4, projected: 1, actual: 0, entries: 0 }])}`);
ok(fs0.executed === false, 'all-zero entries must read as NOT executed');
const fsn = engagement('foldStats', handbacks);
ok(fsn.executed === null && /NO payoff line/.test(fsn.summary), 'missing payoff must be "no report"');
const fd = engagement('fold', outFold);
ok(fd.installed === true && fd.executed === null, 'plain fold arm: installed only');
console.log(`engagement parser (engagement fixture): ${n}/${n} checks on lines rendered by run-dos.js's own code at 2683a6e3 (stub values, not real runs)`);
