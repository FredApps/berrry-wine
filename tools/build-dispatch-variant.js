#!/usr/bin/env node
'use strict';

// Build a NON-SHIPPED dispatch variant of the emulator, for A/B only.
//
//   node tools/build-dispatch-variant.js [--variant=trampoline] [--out=FILE]
//
// Writes build/wine-assembly.<variant>.wasm next to the two shipped artifacts
// and replaces neither. Stamped with the same region-layout section, so
// `test/run.js --wasm=FILE --no-build` and `tools/bench-loops.js --wasm=` both
// accept it.
//
// WHY A VARIANT AND NOT A THIRD SHIPPED ARTIFACT. The compat artifact (no wasm
// tail calls: iOS Safari before 18.2) lowers every `return_call*` to
// `call*; return`, so one handler chain -- $steps = 256 BLOCKS, ~1000+ ops --
// is ~1000 nested wasm frames, each paying frame setup and a stack check, then
// unwinding all at once. Whether a flat trampoline beats that on JSC is a
// measurement nobody has made. This builds the arm that answers it, without
// touching src/ or the sealed vendored compiler.
//
// VARIANT `trampoline`. Source overlay applied to the compile closure only:
//
//   04-cache.wat   (dispatch-next) tail:  return_call_indirect (op, fn)
//                                 becomes: $tramp_op = op; $tramp_fn = fn; return
//                  + $tramp_drive: loop { f = $tramp_fn; if f < 0: done;
//                                         $tramp_fn = -1; call_indirect (op, f) }
//   13-exports     each `(call $next)` in $run is followed by `(call $tramp_drive)`
//   07c-block-exec each fallback `call_indirect (type $handler_t)` likewise
//
// Those four sites are the ONLY non-tail entries into a handler chain (every
// other entry is a `return_call`, which compat already lowers to call;return,
// so it costs at most one extra frame before the callee parks the next op and
// returns). $tramp_fn is -1 whenever no op is parked, so a chain that ends by
// plain `return` -- $steps exhausted, $th_bx_resume, a yield -- leaves the
// driver nothing to run, exactly as the nested-call shape unwinds.
//
// Every anchor is an exact string and must match the stated number of times;
// a moved source line is a hard error, never a silently different build.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const a = argv.find(x => x.startsWith(`--${name}=`));
  return a === undefined ? dflt : a.slice(name.length + 3);
};

const DRIVER = `
  ;; ---- trampoline dispatch variant (tools/build-dispatch-variant.js) ----
  (global $tramp_fn (mut i32) (i32.const -1))
  (global $tramp_op (mut i32) (i32.const 0))
  (func $tramp_drive
    (local $f i32)
    (loop $again
      (local.set $f (global.get $tramp_fn))
      (if (i32.ge_s (local.get $f) (i32.const 0))
        (then
          (global.set $tramp_fn (i32.const -1))
          (call_indirect (type $handler_t) (global.get $tramp_op) (local.get $f))
          (br $again)))))
`;

const VARIANTS = {
  trampoline: {
    tailCalls: false,
    edits: [
      { file: '04-cache.wat', count: 1,
        from: '(return_call_indirect (type $handler_t) (local.get $nx_op) (local.get $nx_fn)))',
        to: '(global.set $tramp_op (local.get $nx_op))\n' +
            '    (global.set $tramp_fn (local.get $nx_fn))\n' +
            '    (return))' },
      { file: '04-cache.wat', count: 1,
        from: '  (func $next\n    (local $nx_fn i32) (local $nx_op i32)\n    (dispatch-next))\n',
        to: '  (func $next\n    (local $nx_fn i32) (local $nx_op i32)\n    (dispatch-next))\n' + DRIVER },
      { file: '13-exports.wat', count: 2,
        from: '(call $next)\n',
        to: '(call $next) (call $tramp_drive)\n' },
      { file: '07c-block-exec.wat', count: 2,
        from: '(call_indirect (type $handler_t)\n                (local.get $imm) (local.get $a))',
        to: '(call_indirect (type $handler_t)\n                (local.get $imm) (local.get $a))\n' +
            '              (call $tramp_drive)' },
    ],
  },
};

function applyEdits(closure, edits) {
  for (const e of edits) {
    const text = closure.vfs.get(e.file);
    if (text === undefined) throw new Error(`${e.file}: not in the compile closure`);
    const n = text.split(e.from).length - 1;
    if (n !== e.count) {
      throw new Error(`${e.file}: anchor matched ${n} time(s), expected ${e.count}:\n  ` +
        JSON.stringify(e.from));
    }
    const next = text.split(e.from).join(e.to);
    // The closure registers each file under three spellings; keep them one text.
    for (const key of [e.file, `src/${e.file}`, `./${e.file}`]) closure.vfs.set(key, next);
  }
}

function main() {
  const name = opt('variant', 'trampoline');
  const variant = VARIANTS[name];
  if (!variant) throw new Error(`unknown --variant=${name} (${Object.keys(VARIANTS).join(', ')})`);
  const out = opt('out', path.join(ROOT, 'build', `wine-assembly.${name}.wasm`));

  const { watxSourceClosure, compileClosure } = require('./watx-closure.js');
  const { layoutHash, appendSection } = require('./region-layout-hash.js');
  const closure = watxSourceClosure();
  applyEdits(closure, variant.edits);
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
