#!/usr/bin/env node
'use strict';
// Write a tree's toyvm wasm module to a file, for native disassembly
// (tools/wasm-native.js --wasm=<file>, V8 and SpiderMonkey). STATIC: it calls
// the tree's own vm.js `buildModule(variant, opts)` -- emit + compile to bytes
// -- and never instantiates or runs anything. The options are buildModule's
// defaults as makeVm passes them for a plain run (no hist, lazy flags and cond
// fusion on), so the module is the one a plain `--variant=tailcall` run uses.
//   node dump-toyvm-wasm.js --tree=<dir> --out=<file.wasm> [--variant=tailcall]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((a) => a.startsWith(`--${k}=`)); return h === undefined ? d : h.slice(k.length + 3); };
const tree = arg('tree'), out = arg('out'), variant = arg('variant', 'tailcall');
if (!tree || !out) { console.error('usage: node dump-toyvm-wasm.js --tree=<dir> --out=<file.wasm> [--variant=tailcall]'); process.exit(2); }
if (fs.existsSync(out)) { console.error(`refusing: ${out} exists`); process.exit(2); }
(async () => {
  const { buildModule } = require(path.join(path.resolve(tree), 'tools/toyvm/vm.js'));
  const { bytes, wat } = await buildModule(variant, { hist: false, ipHist: false, lazyFlags: true, fuseCond: true, exportAll: false, regions: null });
  fs.writeFileSync(out, Buffer.from(bytes));
  if (wat) fs.writeFileSync(out.replace(/\.wasm$/, '') + '.wat', wat);
  console.log(JSON.stringify({ tree: path.resolve(tree), variant, bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex').slice(0, 16) }));
})().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
