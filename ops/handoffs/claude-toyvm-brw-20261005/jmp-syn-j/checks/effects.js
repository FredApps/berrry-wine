'use strict';
// Pure table inspection: what the flag analysis (emit.js FLAG_EFFECTS) and
// handler-effects.js say about jmp_syn. Text/analysis only; nothing runs.
//   node effects.js <toyvm-root> [--jmp-syn-budget-test]
const path = require('path');
const root = path.resolve(process.argv[2]);
const emit = require(path.join(root, 'tools/toyvm/emit'));
const he = require(path.join(root, 'tools/toyvm/handler-effects'));
emit.prepareTables();
const i = emit.HANDLERS.findIndex(h => h.name === 'jmp_syn');
const e = he.table().find(x => x.name === 'jmp_syn');
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v instanceof Set ? [...v] : v instanceof Map ? [...v] : v)));
process.stdout.write(JSON.stringify({
  flagEffects: strip(emit.FLAG_EFFECTS[i]),
  handlerEffects: e ? { readable: e.readable, escapes: e.escapes, unresolved: e.unresolved,
    regRead: e.regRead.length, regWrite: e.regWrite.length } : null,
}) + '\n');
