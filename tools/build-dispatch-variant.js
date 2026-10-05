#!/usr/bin/env node
'use strict';

// Build a NON-SHIPPED dispatch variant of the emulator, for A/B only.
//
//   node tools/build-dispatch-variant.js [--variant=nested] [--out=FILE]
//
// Writes build/wine-assembly.<variant>.wasm next to the shipped artifacts and
// replaces neither. Stamped with the same region-layout section, so
// `test/run.js --wasm=FILE --no-build` and `tools/bench-loops.js --wasm=` both
// accept it.
//
// VARIANT `nested`. The compat artifact's shape BEFORE 2026-09-22: no tail
// calls and no trampoline, so the compiler lowers every `return_call*` to
// `call*; return` and one handler chain is ~1000+ nested wasm frames. The
// shipped build/wine-assembly.compat.wasm now dispatches through the flat
// trampoline in lib/dispatch-trampoline.js; this is the arm that re-measures
// that decision (it was -28..-30% user CPU on V8 and -49..-50% on JSC across
// Moorhuhn 2, StarCraft and Diablo when it was made). Note that on real games
// Node needs `--stack-size=60000` to run this variant at all.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const a = argv.find(x => x.startsWith(`--${name}=`));
  return a === undefined ? dflt : a.slice(name.length + 3);
};

const VARIANTS = {
  nested: { tailCalls: false, overlay: null },
};

function main() {
  const name = opt('variant', 'nested');
  const variant = VARIANTS[name];
  if (!variant) throw new Error(`unknown --variant=${name} (${Object.keys(VARIANTS).join(', ')})`);
  const out = opt('out', path.join(ROOT, 'build', `wine-assembly.${name}.wasm`));

  const { watxSourceClosure, compileClosure } = require('./watx-closure.js');
  const { layoutHash, appendSection } = require('./region-layout-hash.js');
  const closure = watxSourceClosure();
  if (variant.overlay) variant.overlay(closure.vfs);
  const r = compileClosure(closure, { tailCalls: variant.tailCalls });
  if (!r || !r.success || !r.wasmBinary) {
    const where = r && r.file ? ` at ${r.file}:${r.line || '?'}:${r.col || '?'}` : '';
    throw new Error(`WATX compile failed${where}: ` +
      String((r && (r.error || r.message)) || 'compile() returned no binary'));
  }
  const bytes = appendSection(Buffer.from(r.wasmBinary), layoutHash(r.regions.regions));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, bytes);
  console.log(`wrote ${path.relative(ROOT, out)} (${bytes.length} bytes, variant ${name}, ` +
    `tailCalls=${variant.tailCalls})`);
}

main();
