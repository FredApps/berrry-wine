'use strict';
// Pure require-and-inspect check for fix J. Builds TEXT only: the handler
// table, the helper functions, the whole tailcall module's WAT, and two
// synthetic one-op regions through region-jit's buildRegion. No wasm is
// compiled or instantiated, and no guest program runs.
//
//   node inspect.js <toyvm-root> [--jmp-syn-budget-test]
// prints one JSON object; compare.js diffs three of them.
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(process.argv[2]);
const emit = require(path.join(root, 'tools/toyvm/emit'));
const rj = require(path.join(root, 'tools/toyvm/region-jit'));

emit.prepareTables();
const syn = emit.HANDLERS.find(h => h.name === 'jmp_syn');
const synIdx = emit.HANDLERS.indexOf(syn);
const helpers = emit.helpers();
const wat = emit.emit('tailcall');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function region(closed) {
  const headIp = 0x140;
  const target = closed ? headIp : 0x150;
  const ops = [{ fn: synIdx, name: 'jmp_syn', args: [0, target] }];
  const nexts = ops.map(o => rj.fallThroughIp(o));
  try {
    const r = rj.buildRegion(ops, nexts, headIp, `chk_${closed ? 'loop' : 'line'}`, closed, [], []);
    return {
      declined: r.declined || null,
      locals: r.locals || '',
      bodySha: r.body ? sha(r.body) : null,
      synOut: /\$syn_out/.test(r.body || ''),
      edgeTestsSteps: /\(if \(i32\.or \(i32\.or \(global\.get \$smc\) \(global\.get \$halt\)\) \(i32\.lt_s \(global\.get \$steps\)/.test(r.body || ''),
      edgeSmcHaltOnly: /\(if \(i32\.or \(global\.get \$smc\) \(global\.get \$halt\)\)\n/.test(r.body || ''),
      body: r.body,
    };
  } catch (e) {
    return { threw: String(e && e.message || e) };
  }
}

const out = {
  root,
  argvFlag: process.argv.includes('--jmp-syn-budget-test'),
  JMP_SYN_BUDGET_TEST: emit.JMP_SYN_BUDGET_TEST,
  envAfter: process.env.TOYVM_JMP_SYN_BUDGET_TEST || null,
  handlers: emit.HANDLERS.length,
  tableShapeSha: sha(emit.HANDLERS.map(h => `${h.name}/${h.args}`).join(',')),
  jmpSyn: {
    index: synIdx,
    callsJlookEdge: /\$jlook_edge/.test(syn.body),
    callsJlookSyn: /\$jlook_syn/.test(syn.body),
    testsSteps: /\(i32\.lt_s \(global\.get \$steps\) \(i32\.const 0\)\)/.test(syn.body),
    testsSmc: /\(global\.get \$smc\)/.test(syn.body),
    refunds: syn.body.includes('(global.set $steps (i32.add (global.get $steps) (i32.const 1)))'),
    bodySha: sha(syn.body),
    body: syn.body,
  },
  jmpBodySha: sha(emit.HANDLERS.find(h => h.name === 'jmp').body),
  helpersHaveJlookSyn: /\(func \$jlook_syn /.test(helpers),
  helpersSha: sha(helpers),
  tailcallWatSha: sha(wat),
  tailcallWatBytes: wat.length,
  regionLine: region(false),
  regionLoop: region(true),
};
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
