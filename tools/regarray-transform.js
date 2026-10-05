#!/usr/bin/env node
// EXPERIMENT ONLY (worktree wa-perf-regarray).
//
// Rewrites every x86 GPR access in src/*.wat from a per-instance wasm global
// into an indexed slot of a per-thread register file in shared linear memory.
//
//   (global.get $eax)        -> (i32.load  offset=0  (global.get $reg_base))
//   (global.set $esp EXPR)   -> (i32.store offset=16 (global.get $reg_base) EXPR)
//   (call $get_reg R)        -> (i32.load  (i32.add (global.get $reg_base) (i32.shl R (i32.const 2))))
//   (call $set_reg R V)      -> (i32.store (i32.add (global.get $reg_base) (i32.shl R (i32.const 2))) V)
//
// The rewriter is paren-aware (comments and strings are skipped) so it handles
// folded forms that span lines. Deterministic and re-runnable: it refuses to
// run if the register globals have already been removed from 01-header.wat.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const REGS = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
const OFF = Object.fromEntries(REGS.map((r, i) => [r, i * 4]));

// Skip whitespace/comments starting at i, return next code index.
function skipTrivia(s, i) {
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === ';' && s[i + 1] === ';') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (s[i] === '(' && s[i + 1] === ';') {
      let d = 1; i += 2;
      while (i < s.length && d > 0) {
        if (s[i] === '(' && s[i + 1] === ';') { d++; i += 2; }
        else if (s[i] === ';' && s[i + 1] === ')') { d--; i += 2; }
        else i++;
      }
      continue;
    }
    return i;
  }
}

// Given index of '(' return index just past the matching ')'.
function matchParen(s, i) {
  let d = 0;
  while (i < s.length) {
    if (s[i] === ';' && s[i + 1] === ';') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (s[i] === '(' && s[i + 1] === ';') {
      let bd = 1; i += 2;
      while (i < s.length && bd > 0) {
        if (s[i] === '(' && s[i + 1] === ';') { bd++; i += 2; }
        else if (s[i] === ';' && s[i + 1] === ')') { bd--; i += 2; }
        else i++;
      }
      continue;
    }
    if (s[i] === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; i++; } i++; continue; }
    if (s[i] === '(') { d++; i++; continue; }
    if (s[i] === ')') { d--; i++; if (d === 0) return i; continue; }
    i++;
  }
  throw new Error('unbalanced parens');
}

// Split the operand list of a folded s-expression body (text between the head
// token and the closing paren) into top-level operand strings.
function splitOperands(s, start, end) {
  const ops = [];
  let i = start;
  for (;;) {
    i = skipTrivia(s, i);
    if (i >= end) break;
    if (s[i] === '(') {
      const j = matchParen(s, i);
      ops.push(s.slice(i, j));
      i = j;
    } else {
      let j = i;
      while (j < end && !/[\s()]/.test(s[j])) j++;
      ops.push(s.slice(i, j));
      i = j;
    }
  }
  return ops;
}

// Find the next occurrence of `(head` at a real code position (not in a
// comment or string), starting at `from`.
function findForm(s, head, from) {
  let i = from;
  while (i < s.length) {
    if (s[i] === ';' && s[i + 1] === ';') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (s[i] === '(' && s[i + 1] === ';') {
      let bd = 1; i += 2;
      while (i < s.length && bd > 0) {
        if (s[i] === '(' && s[i + 1] === ';') { bd++; i += 2; }
        else if (s[i] === ';' && s[i + 1] === ')') { bd--; i += 2; }
        else i++;
      }
      continue;
    }
    if (s[i] === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; i++; } i++; continue; }
    if (s[i] === '(') {
      const k = skipTrivia(s, i + 1);
      let j = k;
      while (j < s.length && !/[\s()]/.test(s[j])) j++;
      const tok = s.slice(k, j);
      if (tok === head) return { open: i, headEnd: j };
    }
    i++;
  }
  return null;
}

const stats = {
  'global.get': 0, 'global.set': 0, 'call $get_reg': 0, 'call $set_reg': 0,
  perReg: Object.fromEntries(REGS.map((r) => [r, { get: 0, set: 0 }])),
};

function rewriteHead(text, head, handler) {
  let out = text;
  let from = 0;
  for (;;) {
    const f = findForm(out, head, from);
    if (!f) break;
    const close = matchParen(out, f.open);
    const ops = splitOperands(out, f.headEnd, close - 1);
    const repl = handler(ops);
    if (repl === null) { from = f.headEnd; continue; }
    out = out.slice(0, f.open) + repl + out.slice(close);
    // Rescan from the same offset: the replacement embeds the original
    // operands verbatim, which may themselves contain forms of this head
    // (e.g. (call $set_reg R (... (call $get_reg R) ...))). The head token at
    // f.open is now i32.load/i32.store, so this cannot loop forever.
    from = f.open;
  }
  return out;
}

function transform(text, file) {
  let out = text;

  out = rewriteHead(out, 'global.get', (ops) => {
    if (ops.length !== 1) return null;
    const name = ops[0].replace(/^\$/, '');
    if (!REGS.includes(name) || ops[0][0] !== '$') return null;
    stats['global.get']++; stats.perReg[name].get++;
    return `(i32.load offset=${OFF[name]} (global.get $reg_base))`;
  });

  out = rewriteHead(out, 'global.set', (ops) => {
    if (ops.length < 1) return null;
    const name = ops[0].replace(/^\$/, '');
    if (!REGS.includes(name) || ops[0][0] !== '$') return null;
    if (ops.length !== 2) throw new Error(`${file}: (global.set $${name}) with ${ops.length} operands`);
    stats['global.set']++; stats.perReg[name].set++;
    return `(i32.store offset=${OFF[name]} (global.get $reg_base) ${ops[1]})`;
  });

  // The bodies of $get_reg/$set_reg themselves are rewritten by hand in
  // 03-registers.wat; skip inlining inside their own definitions is not needed
  // because they no longer call themselves.
  out = rewriteHead(out, 'call', (ops) => {
    if (ops[0] === '$get_reg') {
      if (ops.length !== 2) throw new Error(`${file}: call $get_reg with ${ops.length - 1} args`);
      stats['call $get_reg']++;
      return `(i32.load (i32.add (global.get $reg_base) (i32.shl ${ops[1]} (i32.const 2))))`;
    }
    if (ops[0] === '$set_reg') {
      if (ops.length !== 3) throw new Error(`${file}: call $set_reg with ${ops.length - 1} args`);
      stats['call $set_reg']++;
      return `(i32.store (i32.add (global.get $reg_base) (i32.shl ${ops[1]} (i32.const 2))) ${ops[2]})`;
    }
    return null;
  });

  return out;
}

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.wat')).sort();
// Idempotent: safe to re-run over a tree that is already transformed but has
// picked up freshly-merged code in the old spelling (a rebase onto main).
// Refuse only if neither the old globals nor the new $reg_base exist.
const header = fs.readFileSync(path.join(SRC, '01-header.wat'), 'utf8');
const hasOld = /\(global \$eax \(mut i32\)/.test(header);
const hasNew = /\(global \$reg_base \(mut i32\)/.test(header);
if (!hasOld && !hasNew) {
  console.error('01-header.wat declares neither $eax nor $reg_base. Aborting.');
  process.exit(1);
}
console.log(hasOld ? 'mode: first run (register globals present)'
                   : 'mode: re-run over an already-transformed tree');

for (const f of files) {
  const p = path.join(SRC, f);
  const src = fs.readFileSync(p, 'utf8');
  const out = transform(src, f);
  if (out !== src) fs.writeFileSync(p, out);
}

// --tests also rewrites the inline WAT fragments that test/*.js hands to
// bootRenderHarness via extraWat. They are compiled against src/, so a
// fragment left in the old spelling fails to instantiate with
// "Unknown global '$esp'" — a harness artifact that looks exactly like an
// emulator bug. The rewriter is the same paren-aware one used on src/.
if (process.argv.includes('--tests')) {
  const TEST = path.join(__dirname, '..', 'test');
  let touched = 0;
  const skipped = [];
  for (const f of fs.readdirSync(TEST).filter((f) => f.endsWith('.js')).sort()) {
    const p = path.join(TEST, f);
    const src = fs.readFileSync(p, 'utf8');
    // The rewriter walks parens, and a .js file's own parens are not balanced
    // the way a WAT fragment's are, so some files throw. transform() is pure
    // and the write happens only after it returns, so a thrower is left
    // untouched rather than half-rewritten; collect and report them.
    let out;
    try { out = transform(src, `test/${f}`); }
    catch (err) { skipped.push(`${f}: ${err.message}`); continue; }
    if (out !== src) { fs.writeFileSync(p, out); touched++; }
  }
  console.log(`test harness: rewrote inline WAT in ${touched} file(s), ${skipped.length} unparseable`);
  for (const s of skipped) console.log(`  skipped ${s}`);
}

console.log(JSON.stringify(stats, null, 2));
