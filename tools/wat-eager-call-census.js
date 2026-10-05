#!/usr/bin/env node
// Census of `(i32.and ...)` / `(i32.or ...)` expressions that carry a `call`
// as an operand beside a non-call operand.
//
//   node tools/wat-eager-call-census.js [--loops] [--json] [--min-lines=N]
//
// WAT `i32.and`/`i32.or` are bitwise: every operand is evaluated, there is no
// short circuit. So `(i32.and (cheap test) (call $expensive))` runs the call
// even when the cheap test is already false. That is a correctness trap when
// the call has side effects and a cost trap when it loops -- in
// $virtual_map_commit_locked it ran a full-table scan once per record and put
// 40% of StarCraft's gameplay CPU into one function (1630c665). The fix is
// always the same: nest the call under an `if` on the cheap operands.
//
// This walks every src/*.wat in main.watx order and prints each site with
// the callee, whether the callee's body contains a `loop` (--loops keeps only
// those), and the callee's length in lines as a cost proxy. Comments are
// stripped before the s-expression walk, so a `;; (i32.and (call` in prose
// does not count. It is a candidate finder: a listed site is a place to read,
// not a bug -- a call that is cheap and pure is fine where it is.
const fs = require('fs');
const path = require('path');
const { WAT_FILES } = require('../lib/wat-manifest');

const argv = process.argv.slice(2);
const onlyLoops = argv.includes('--loops');
const asJson = argv.includes('--json');
const minLines = Number((argv.find(a => a.startsWith('--min-lines=')) || '=0').split('=')[1]);

const root = path.join(__dirname, '..');
const files = WAT_FILES.map(f => path.join(root, 'src', f));

function stripComments(src) {
  // Block comments first (they may span lines), then line comments. Keep
  // newlines so line numbers survive.
  src = src.replace(/\(;[\s\S]*?;\)/g, m => m.replace(/[^\n]/g, ' '));
  return src.replace(/;;[^\n]*/g, m => ' '.repeat(m.length));
}

// Tokenizer + parser that records the line of every list.
function parse(src) {
  const toks = [];
  let line = 1;
  const re = /\(|\)|"(?:[^"\\]|\\.)*"|[^\s()"]+|\n/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0] === '\n') { line++; continue; }
    toks.push({ t: m[0], line });
  }
  let i = 0;
  function node() {
    const tk = toks[i++];
    if (tk.t === '(') {
      const list = { line: tk.line, items: [] };
      while (i < toks.length && toks[i].t !== ')') list.items.push(node());
      i++; // ')'
      return list;
    }
    return { line: tk.line, atom: tk.t };
  }
  const top = [];
  while (i < toks.length) top.push(node());
  return top;
}

// First pass: every function's body text, to ask "does the callee loop" and
// "how long is it".
const funcs = new Map();
const parsed = new Map();
for (const f of files) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const top = parse(src);
  parsed.set(f, top);
  const walk = n => {
    if (!n.items) return;
    if (n.items[0] && n.items[0].atom === 'func' && n.items[1] && n.items[1].atom && n.items[1].atom.startsWith('$')) {
      const name = n.items[1].atom;
      let last = n.line, hasLoop = false;
      const inner = m => {
        if (!m.items) { last = Math.max(last, m.line); return; }
        last = Math.max(last, m.line);
        if (m.items[0] && m.items[0].atom === 'loop') hasLoop = true;
        m.items.forEach(inner);
      };
      inner(n);
      funcs.set(name, { file: path.basename(f), line: n.line, lines: last - n.line + 1, hasLoop });
      return;
    }
    n.items.forEach(walk);
  };
  top.forEach(walk);
}

const sites = [];
for (const f of files) {
  let current = null;
  const walk = n => {
    if (!n.items) return;
    const head = n.items[0] && n.items[0].atom;
    if (head === 'func' && n.items[1] && n.items[1].atom) current = n.items[1].atom;
    if (head === 'i32.and' || head === 'i32.or') {
      const ops = n.items.slice(1);
      const calls = ops.filter(o => o.items && o.items[0] && (o.items[0].atom === 'call'));
      const others = ops.filter(o => !(o.items && o.items[0] && o.items[0].atom === 'call'));
      if (calls.length && others.length) {
        for (const c of calls) {
          const callee = c.items[1] && c.items[1].atom;
          const info = funcs.get(callee) || {};
          sites.push({ file: path.basename(f), line: n.line, in: current, op: head, callee,
            calleeLoops: !!info.hasLoop, calleeLines: info.lines || 0 });
        }
      }
    }
    n.items.forEach(walk);
  };
  parsed.get(f).forEach(walk);
}

let rows = sites;
if (onlyLoops) rows = rows.filter(r => r.calleeLoops);
if (minLines) rows = rows.filter(r => r.calleeLines >= minLines);
rows.sort((a, b) => (b.calleeLoops - a.calleeLoops) || (b.calleeLines - a.calleeLines));

if (asJson) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
console.log(`${sites.length} eager-call operands in i32.and/i32.or across ${files.length} files; ` +
  `${sites.filter(r => r.calleeLoops).length} call a function that loops`);
console.log('loop  lines  site                                   op       callee');
for (const r of rows) {
  console.log(`${r.calleeLoops ? 'LOOP' : '    '}  ${String(r.calleeLines).padStart(5)}  ` +
    `${(r.file + ':' + r.line).padEnd(38)} ${r.op.padEnd(8)} ${r.callee}   in ${r.in}`);
}
