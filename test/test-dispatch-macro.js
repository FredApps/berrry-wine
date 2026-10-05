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

// The operand-word read is the (read-thread-word) macro for the same reason:
// as a call it was never inlined by V8 and cost 3.5-7% self CPU per game.
let rtwCalls = [];
let oldSites = [], macroSites = 0, funcsMissingLocals = [], macroDefs = 0, nextDefs = 0;
for (const f of WAT_FILES) {
  const text = stripComments(fs.readFileSync(path.join(SRC, f), 'utf8'));
  text.split('\n').forEach((line, i) => { if (line.includes('(return_call $next)')) oldSites.push(`${f}:${i + 1}`); });
  text.split('\n').forEach((line, i) => { if (line.includes('(call $read_thread_word)')) rtwCalls.push(`${f}:${i + 1}`); });
  macroDefs += (text.match(/\(defmacro \(dispatch-next\)/g) || []).length;
  nextDefs += (text.match(/\(func \$next\b/g) || []).length;
  // Function extents: split on top-level "(func " / "(defmacro " and look
  // inside each. A macro whose body expands (dispatch-next) -- 05-alu.wat's
  // (jcc-finish) -- is not itself a site, but every function expanding IT is.
  const parts = text.split(/\n(?=  \((?:func|defmacro) )/);
  const wrappers = [];
  for (const part of parts) {
    const dm = /^\s*\(defmacro \(([^\s()]+)\)/.exec(part);
    if (dm && dm[1] !== 'dispatch-next' && part.includes('(dispatch-next)')) wrappers.push(dm[1]);
  }
  for (const part of parts) {
    if (/^\s*\(defmacro /.test(part)) continue;
    const n = (part.match(/\(dispatch-next\)/g) || []).length
      + wrappers.reduce((k, w) => k + part.split(`(${w})`).length - 1, 0);
    if (!n) continue;
    macroSites += n;
    const m = /^\s*\(func\s+(\$[^\s()]+)/.exec(part);
    const name = m ? m[1] : '<anon>';
    if (!part.includes('(local $nx_fn i32)') || !part.includes('(local $nx_op i32)')) funcsMissingLocals.push(`${f} ${name}`);
  }
}
ok(oldSites.length === 0, `no (return_call $next) in src/ outside comments${oldSites.length ? ': ' + oldSites.slice(0, 5).join(', ') : ''}`);
ok(rtwCalls.length === 0, `no (call $read_thread_word) in src/ outside comments -- use (read-thread-word)${rtwCalls.length ? ': ' + rtwCalls.slice(0, 5).join(', ') : ''}`);
ok(macroDefs === 1, `exactly one (defmacro (dispatch-next)) (got ${macroDefs})`);
ok(nextDefs === 1, `exactly one $next (got ${nextDefs})`);
ok(macroSites >= 400, `${macroSites} (dispatch-next) sites, at least the 420 that landed`);
ok(funcsMissingLocals.length === 0, `every expanding function declares $nx_fn/$nx_op${funcsMissingLocals.length ? ': ' + funcsMissingLocals.slice(0, 5).join(', ') : ''}`);
console.log(`\n${checks} checks, all PASS`);
