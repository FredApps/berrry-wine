#!/usr/bin/env node
'use strict';
const fs = require('fs');
const assert = require('assert');
const median = values => {
  const a = [...values].sort((x, y) => x - y), m = a.length >> 1;
  return a.length ? a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 : null;
};
const filename = process.argv[2];
assert(filename, 'usage: node tools/bench-lazy-sync-report.js results.json');
const result = JSON.parse(fs.readFileSync(filename, 'utf8'));
console.log(`GPU: ${result.renderer}\n${result.scope}\n`);
console.log('| Workload | Eager ms/unit | Lazy ms/unit | Readbacks eager/lazy | Status |');
console.log('|---|---:|---:|---:|---|');
for (const name of [...new Set(result.rows.map(r => r.name))]) {
  const group = result.rows.filter(r => r.name === name);
  const stats = arm => {
    const rows = group.filter(r => r.arm === arm);
    if (!rows.length || rows.some(r => r.status !== 'PASS')) return { error: rows.find(r => r.error)?.error || 'missing' };
    return { ms: median(rows.map(r => r.msPerFrame)), syncs: median(rows.map(r => r.counts.syncs / r.frames)) };
  };
  const a = stats('eager'), b = stats('lazy');
  console.log(`| ${name} | ${a.ms?.toFixed(3) ?? 'INVALID'} | ${b.ms?.toFixed(3) ?? 'INVALID'} | ${a.syncs ?? '—'}/${b.syncs ?? '—'} | ${a.error || b.error || 'PASS'} |`);
}
console.log('\nValues are medians of per-round work-unit means, not game FPS. INVALID arms have no speed claim.');
console.log(`Load before/after: ${result.manifest.loadBefore?.join(', ')} / ${result.manifest.loadAfter?.join(', ')}`);
