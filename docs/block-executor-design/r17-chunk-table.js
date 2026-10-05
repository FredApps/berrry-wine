#!/usr/bin/env node
// Round 17 part B: turn the collect-round17-chunk.sh logs into one table.
//
// tl;dr -- for each *.log in the directory given (default /tmp/r17-chunk),
// pull the six numbers section 27's verdict is written against:
//
//   decodes        `cache: block decodes N`      -- sections 22/23's kill rule
//   rgInstalls     the REGION installer's count  -- what the reserve buys
//   obInstalls     one-block installs (byN 1)    -- what the reserve sells
//   nrChunkFull    region declines for chunk room
//   rgResDecl      declines the reserve itself caused
//   opsNative      micro-ops the executor ran natively
//
// and print them as one row per arm, with decodes also shown as a % of the
// no-executor arm so the kill rule is readable straight off the table.
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || '/tmp/r17-chunk';
const num = (txt, re) => { const m = txt.match(re); return m ? Number(m[1]) : null; };

const rows = [];
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.log')).sort()) {
  const txt = fs.readFileSync(path.join(dir, f), 'utf8');
  const byN1 = txt.match(/byN\(ops\/entries\/installs\)\s+1:(\d+)\/(\d+)\/(\d+)/);
  rows.push({
    arm: f.replace(/\.log$/, ''),
    batches: num(txt, /(\d+) batches in [\d.]+s/),
    decodes: num(txt, /cache: block decodes (\d+)/),
    rgInstalls: num(txt, /block-exec-regions: M\s+armed \w+ installs (\d+)/),
    obInstalls: num(txt, /block-exec: M\s+armed \w+ installs (\d+)/),
    byN1entries: byN1 ? Number(byN1[2]) : null,
    nrChunkFull: num(txt, /nrChunkFull (\d+)/),
    descChunkFull: num(txt, /descChunkFull (\d+)/),
    rgResDecl: num(txt, /rgReserveDeclines (\d+)/),
    opsNative: num(txt, /ops native (\d+)/),
  });
}

const base = rows.find(r => /noexec/.test(r.arm));
const pad = (s, n) => String(s === null ? '-' : s).padStart(n);
console.log(
  'arm'.padEnd(28) + pad('batches', 8) + pad('decodes', 10) + pad('vs off', 8) +
  pad('rgInst', 8) + pad('1blkInst', 10) + pad('nrChunkFull', 12) +
  pad('rgResDecl', 11) + pad('opsNative', 13));
for (const r of rows) {
  const rel = base && base.decodes && r.decodes
    ? `${((100 * r.decodes / base.decodes) - 100).toFixed(1)}%` : '-';
  console.log(
    r.arm.padEnd(28) + pad(r.batches, 8) + pad(r.decodes, 10) + pad(rel, 8) +
    pad(r.rgInstalls, 8) + pad(r.obInstalls, 10) + pad(r.nrChunkFull, 12) +
    pad(r.rgResDecl, 11) + pad(r.opsNative, 13));
}
