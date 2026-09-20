#!/usr/bin/env node
// The dispatch step is the `(dispatch-next)` macro in src/04-cache.wat, and
// every handler must end in it — never in `(return_call $next)`. A tree with
// both spellings has two dispatch paths that drift apart (it happened once:
// docs/next-source-inline.md, "It briefly shipped, partially"), so this
// refuses the old spelling anywhere in src/ outside comments, and checks
// that every function expanding the macro declares the two locals the body
// is written on (the compiler would refuse an undeclared local, but a
// located message here is cheaper than a compile).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WAT_FILES } = require(path.join(__dirname, '..', 'lib', 'wat-manifest.js'));
const SRC = path.join(__dirname, '..', 'src');

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); console.log('  PASS  ' + msg); }

function stripComments(s) {
  return s.replace(/\(;[\s\S]*?;\)/g, '').replace(/;;[^\n]*/g, '');
}

let oldSites = [], macroSites = 0, funcsMissingLocals = [], macroDefs = 0, nextDefs = 0;
let operandMacroDefs = 0, operandMacroSites = 0, operandCalls = 0, operandFuncsMissingLocal = [];
for (const f of WAT_FILES) {
  const text = stripComments(fs.readFileSync(path.join(SRC, f), 'utf8'));
  text.split('\n').forEach((line, i) => { if (line.includes('(return_call $next)')) oldSites.push(`${f}:${i + 1}`); });
  macroDefs += (text.match(/\(defmacro \(dispatch-next\)/g) || []).length;
  operandMacroDefs += (text.match(/\(defmacro \(read-thread-word\)/g) || []).length;
  operandMacroSites += (text.match(/(?<!\(defmacro )\(read-thread-word\)/g) || []).length;
  operandCalls += (text.match(/\(call \$read_thread_word\)/g) || []).length;
  nextDefs += (text.match(/\(func \$next\b/g) || []).length;
  // Function extents: split on top-level "(func " and look inside each.
  const parts = text.split(/\n(?=  \(func )/);
  for (const part of parts) {
    // The definition itself, `(defmacro (dispatch-next) ...)`, is not a site.
    const n = (part.match(/(?<!\(defmacro )\(dispatch-next\)/g) || []).length;
    if (!n) continue;
    macroSites += n;
    const m = /^\s*\(func\s+(\$[^\s()]+)/.exec(part);
    const name = m ? m[1] : '<anon>';
    if (!part.includes('(local $nx_fn i32)') || !part.includes('(local $nx_op i32)')) funcsMissingLocals.push(`${f} ${name}`);
  }
  for (const part of text.split(/\n(?=  \(func )/)) {
    if (!part.includes('(read-thread-word)') || part.includes('(defmacro (read-thread-word)')) continue;
    const m = /^\s*\(func\s+(\$[^\s()]+)/.exec(part);
    if (!part.includes('(local $operand_word i32)')) operandFuncsMissingLocal.push(`${f} ${m ? m[1] : '<anon>'}`);
  }
}
ok(oldSites.length === 0, `no (return_call $next) in src/ outside comments${oldSites.length ? ': ' + oldSites.slice(0, 5).join(', ') : ''}`);
ok(macroDefs === 1, `exactly one (defmacro (dispatch-next)) (got ${macroDefs})`);
ok(nextDefs === 1, `exactly one $next (got ${nextDefs})`);
ok(macroSites >= 400, `${macroSites} (dispatch-next) sites, at least the 420 that landed`);
ok(funcsMissingLocals.length === 0, `every expanding function declares $nx_fn/$nx_op${funcsMissingLocals.length ? ': ' + funcsMissingLocals.slice(0, 5).join(', ') : ''}`);
ok(operandMacroDefs === 1, `exactly one (defmacro (read-thread-word)) (got ${operandMacroDefs})`);
ok(operandMacroSites >= 200, `${operandMacroSites} inlined operand-fetch sites`);
ok(operandCalls === 0, `no handler-side call to $read_thread_word remains (got ${operandCalls})`);
ok(operandFuncsMissingLocal.length === 0, `every operand-fetch function declares $operand_word${operandFuncsMissingLocal.length ? ': ' + operandFuncsMissingLocal.slice(0, 5).join(', ') : ''}`);
console.log(`\n${checks} checks, all PASS`);
