#!/usr/bin/env node

'use strict';

// Collect the hot loops of the Win98 and DOS corpora and write one
// disassembly file per loop, so the "what does this loop actually compute"
// reading in docs/hot-loop-vocabulary-2026-09.md can be redone.
//
//   node tools/hot-loop-corpus.js win98 --log=RUN.log --hot=HOT.txt \
//     --app=quake2 --out=DIR [--top=25] [--max-ops=48]
//   node tools/hot-loop-corpus.js dos --exe=/tmp/demos/.../BRW.EXE \
//     --out=DIR [--top=10] [--dispatches=8m] [--show=24]
//   node tools/hot-loop-corpus.js index --out=DIR
//
// WHY A TOOL AND NOT A ONE-OFF. The question this serves --- is there a
// recurring vocabulary of integer expression trees across hot loops? --- is
// answered by READING loops, and a reading is only worth anything if the
// loops it read can be produced again. `tools/tree-shape-census.js` already
// counts shapes automatically; this exists because that counting was at the
// wrong grain (exact 6-op skeletons, order-sensitive) and the re-do has to
// be a human/LLM reading of real disassembly.
//
// WHAT A "BLOCK" IS HERE, AND WHY THE WEIGHT IS hits x ops. `--hot-block-dump`
// gives block ENTRY counts, not retired ops: a block is entered once per trip,
// and a 2-op block entered a million times is not the same work as a 40-op
// block entered a million times. So each entry is disassembled from its head
// to its first control-flow instruction and weighted `entries x instructions`.
// That is retired GUEST instructions, an approximation of retired threaded ops
// (a fused pair retires as one dispatch and two guest ops, which is the
// denominator the census wants).
//
// WIN98 ADDRESSES ARE RUNTIME VAs. They are mapped back to (module, original
// VA) through the `DLL: name at 0xBASE, ..., origBase=0xORIG` lines run.js
// prints, plus the EXE's own image base, and then disassembled OUT OF THE FILE.
// That is exact for everything in this corpus except self-modifying code, and
// a block that lands outside every module's sections is reported as unmapped
// rather than guessed at.
//
// DOS GOES THROUGH THE ARENA, NOT THE FILE, because demo stubs unpack
// themselves: `expr-fold-census.js --top --show` prints the ops the VM
// actually dispatched for each hot block, decomposing fusions back into guest
// ops. The static `dos-disasm.js` view is written beside it where the address
// resolves, as a cross-check, never as the primary.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { disasmAt } = require('./disasm');
const { readPE } = require('../lib/pe');

const ROOT = path.join(__dirname, '..');
const ARGV = process.argv.slice(2);
const MODE = ARGV.find(a => !a.startsWith('--')) || '';
const arg = (k, d) => {
  const hit = ARGV.find(a => a.startsWith(`--${k}=`));
  return hit === undefined ? d : hit.slice(k.length + 3);
};
const hex = v => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;

// Anything that ends a basic block in the decoder's sense. The disassembler
// gives us text, so this matches the mnemonic at the head of the line.
const TERMINATORS = /^(j[a-z]{1,3}|call|ret|retn|retf|loop[a-z]*|int|iret|hlt|jmp)\b/;

// ---------------------------------------------------------------- win98 ----

// `DLL: ref_soft.dll at 0xd7e000, DllMain=0x…, thunks=…, origBase=0x10000000`
function parseModules(logText, exePath) {
  const mods = [];
  const re = /^DLL:\s+(\S+)\s+at\s+0x([0-9a-f]+),.*origBase=0x([0-9a-f]+)/gmi;
  let m;
  while ((m = re.exec(logText))) {
    mods.push({ name: m[1], load: parseInt(m[2], 16), orig: parseInt(m[3], 16) });
  }
  if (exePath && fs.existsSync(exePath)) {
    const pe = readPE(exePath);
    mods.push({ name: path.basename(exePath), load: pe.imageBase, orig: pe.imageBase, exe: true });
  }
  return mods;
}

// Find every file on disk that could back a module name. The app registry
// names them; rather than re-parse it, look beside the exe and under the two
// binary roots, which is where every module in this corpus lives.
function findModuleFile(name, exePath) {
  const cands = [];
  if (exePath) cands.push(path.join(path.dirname(exePath), name));
  for (const root of ['test/binaries', 'binaries']) {
    cands.push(path.join(ROOT, root, name));
  }
  for (const c of cands) if (fs.existsSync(c)) return c;
  // Fall back to a bounded find under the exe's own directory tree.
  if (exePath) {
    const dir = path.dirname(exePath);
    try {
      const out = execFileSync('find', [dir, '-maxdepth', '3', '-iname', name],
        { encoding: 'utf8', timeout: 20000 }).trim().split('\n').filter(Boolean);
      if (out.length) return out[0];
    } catch { /* find found nothing */ }
  }
  return null;
}

function loadModuleImages(mods, exePath) {
  for (const mod of mods) {
    const file = mod.exe ? exePath : findModuleFile(mod.name, exePath);
    if (!file) continue;
    try {
      mod.pe = readPE(file);
      mod.file = file;
    } catch { /* not a PE we can read */ }
  }
  return mods;
}

// runtime VA -> { mod, origVa, fileOff }
function resolve(mods, va) {
  for (const mod of mods) {
    if (!mod.pe) continue;
    const origVa = va - mod.load + mod.orig;
    const off = mod.pe.va2off(origVa);
    if (off >= 0) return { mod, origVa, off };
  }
  return null;
}

function disasmBlock(hit, mods, maxOps) {
  const r = resolve(mods, hit.addr);
  if (!r) return { ...hit, lines: null, ops: 1, why: 'unmapped' };
  const lines = disasmAt(r.mod.pe.buf, r.off, r.origVa, maxOps, null, { bits: 32 });
  const body = [];
  for (const line of lines) {
    body.push(line);
    const mnem = (line.split(/\s{2,}/).pop() || line).trim().split(/\s+/)[0];
    if (TERMINATORS.test(mnem)) break;
  }
  return {
    ...hit,
    module: r.mod.name,
    origVa: r.origVa,
    lines: body,
    ops: body.length,
    truncated: body.length >= maxOps,
  };
}

function win98(out) {
  const logPath = arg('log');
  const hotPath = arg('hot');
  const app = arg('app', 'app');
  const top = Number(arg('top', 25));
  const maxOps = Number(arg('max-ops', 48));
  if (!logPath || !hotPath) { console.log('win98 needs --log= and --hot='); process.exit(2); }
  const logText = fs.readFileSync(logPath, 'utf8');
  let exePath = arg('exe', null);
  if (!exePath) {
    const m = /^(?:Loading|Running|exe:)\s+(\S+\.exe)/mi.exec(logText)
      || /--exe=(\S+)/.exec(logText);
    if (m) exePath = m[1];
  }
  if (exePath && !path.isAbsolute(exePath)) exePath = path.join(ROOT, exePath);
  const mods = loadModuleImages(parseModules(logText, exePath), exePath);

  const hits = fs.readFileSync(hotPath, 'utf8').trim().split('\n')
    .map(l => l.trim().split(/\s+/))
    .filter(p => p.length === 2)
    .map(p => ({ addr: parseInt(p[0], 16) >>> 0, entries: Number(p[1]) }));

  const blocks = hits.map(h => disasmBlock(h, mods, maxOps));
  for (const b of blocks) b.retired = b.entries * b.ops;
  const totalRetired = blocks.reduce((a, b) => a + b.retired, 0);
  blocks.sort((a, b) => b.retired - a.retired);

  const dir = path.join(out, 'win98', app);
  fs.mkdirSync(dir, { recursive: true });
  const index = [];
  blocks.slice(0, top).forEach((b, i) => {
    const share = totalRetired ? b.retired * 100 / totalRetired : 0;
    const id = `${app}-${String(i + 1).padStart(2, '0')}-${hex(b.addr)}`;
    const L = [];
    L.push(`; ${id}`);
    L.push(`; runtime ${hex(b.addr)}  module ${b.module || '?'}`
      + (b.origVa === undefined ? '' : `  orig ${hex(b.origVa)}`));
    L.push(`; entries ${b.entries}  guest ops ${b.ops}  retired ${b.retired}`
      + `  ${share.toFixed(2)}% of window`);
    if (b.truncated) L.push('; TRUNCATED at --max-ops: no terminator within the window');
    if (!b.lines) L.push(`; ${b.why}: no module section covers this address`);
    L.push('');
    for (const line of b.lines || []) L.push(line);
    fs.writeFileSync(path.join(dir, `${id}.asm`), `${L.join('\n')}\n`);
    index.push({
      rank: i + 1, id, app, addr: hex(b.addr), module: b.module || null,
      origVa: b.origVa === undefined ? null : hex(b.origVa),
      entries: b.entries, ops: b.ops, retired: b.retired, share,
    });
  });
  fs.writeFileSync(path.join(dir, 'index.json'),
    `${JSON.stringify({ app, totalRetired, distinct: blocks.length, blocks: index }, null, 1)}\n`);
  console.log(`${app}: ${blocks.length} distinct blocks, ${totalRetired.toLocaleString()} retired guest ops, `
    + `top ${index.length} written to ${dir}`);
  for (const r of index) {
    console.log(`  ${String(r.rank).padStart(2)} ${r.addr} ${(r.module || '?').padEnd(16)} `
      + `${String(r.ops).padStart(3)} ops x ${String(r.entries).padStart(9)} = `
      + `${String(r.retired).padStart(11)}  ${r.share.toFixed(2)}%`);
  }
}

// ------------------------------------------------------------------ dos ----

function dos(out) {
  const exe = arg('exe');
  if (!exe) { console.log('dos needs --exe='); process.exit(2); }
  const top = arg('top', '10');
  const show = arg('show', '24');
  const dispatches = arg('dispatches', '8m');
  const name = path.basename(exe).replace(/\.[^.]+$/, '');
  const dir = path.join(out, 'dos', name);
  fs.mkdirSync(dir, { recursive: true });

  const args = [path.join(__dirname, 'toyvm', 'expr-fold-census.js'), exe,
    `--dispatches=${dispatches}`, `--top=${top}`, `--show=${show}`];
  for (const pass of ['pit-clock', 'auto-key']) if (ARGV.includes(`--${pass}`)) args.push(`--${pass}`);
  let text;
  try {
    text = execFileSync('node', args, { encoding: 'utf8', timeout: 180000, maxBuffer: 1 << 28 });
  } catch (e) {
    text = `${e.stdout || ''}\n; census failed: ${e.message}`;
  }
  fs.writeFileSync(path.join(dir, 'census.txt'), text);
  const rec = splitBlocks(text, dir, name, exe);
  fs.writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify(rec, null, 1)}\n`);
  console.log(`${name}: ${rec.blocks.length} hot blocks written to ${dir}`
    + (rec.retiredTotal ? `  (window retired ${rec.retiredTotal.toLocaleString()})` : ''));
}

// ------------------------------------------------------------ dos-sweep ----

// Every .exe/.com under a demo root, enumerated exactly the way
// tools/toyvm/sweep-dos.js does it, so the two sweeps cover the same corpus.
function findExes(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(d, e.name);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (/\.(exe|com)$/i.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

// One bounded census per program, N at a time. A demo that will not boot, or
// that sits on a key wait past its budget, costs its 60 seconds and is recorded
// as a failure rather than stopping the sweep -- the corpus has both.
function dosSweep(out) {
  const root = arg('root', '/tmp/demos');
  const jobs = Math.max(1, Number(arg('jobs', 6)));
  const secs = Number(arg('secs', 60));
  const top = arg('top', '5');
  const show = arg('show', '24');
  const dispatches = arg('dispatches', '12m');
  const only = arg('only', null);
  let exes = findExes(root);
  if (only) exes = exes.filter(e => e.toLowerCase().includes(only.toLowerCase()));
  console.log(`dos-sweep: ${exes.length} programs, ${jobs} at a time, ${secs}s each`);

  const results = [];
  let next = 0;
  const runOne = (exe) => new Promise((resolve) => {
    const name = path.basename(exe).replace(/\.[^.]+$/, '');
    const demo = path.basename(path.dirname(exe));
    const dir = path.join(out, 'dos', `${demo}__${name}`);
    fs.mkdirSync(dir, { recursive: true });
    const args = [path.join(__dirname, 'toyvm', 'expr-fold-census.js'), exe,
      `--dispatches=${dispatches}`, `--top=${top}`, `--show=${show}`,
      '--auto-key', '--pit-clock'];
    const cp = require('child_process').spawn('node', args,
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let text = ''; let killed = false;
    const timer = setTimeout(() => { killed = true; cp.kill('SIGKILL'); }, secs * 1000);
    cp.stdout.on('data', d => { text += d; });
    cp.stderr.on('data', d => { text += d; });
    cp.on('close', (code) => {
      clearTimeout(timer);
      fs.writeFileSync(path.join(dir, 'census.txt'),
        `${text}\n; exit=${code}${killed ? ' (killed at the time cap)' : ''}\n`);
      const rec = splitBlocks(text, dir, `${demo}__${name}`, exe);
      rec.demo = demo; rec.year = /^(\d{4})/.exec(demo) ? Number(demo.slice(0, 4)) : null;
      rec.killed = killed; rec.exit = code;
      fs.writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify(rec, null, 1)}\n`);
      results.push(rec);
      console.log(`  [${results.length}/${exes.length}] ${demo}/${name}: `
        + `${rec.blocks.length} blocks, retired ${rec.retiredTotal ?? '-'}`
        + `${killed ? ' (timed out)' : ''}`);
      resolve();
    });
  });

  const worker = async () => {
    while (next < exes.length) { const i = next++; await runOne(exes[i]); }
  };
  Promise.all(Array.from({ length: jobs }, worker)).then(() => {
    fs.writeFileSync(path.join(out, 'dos-sweep.json'), `${JSON.stringify(results, null, 1)}\n`);
    const ran = results.filter(r => r.blocks.length);
    console.log(`dos-sweep done: ${ran.length}/${results.length} programs produced hot blocks`);
  });
}

// Shared by `dos` and `dos-sweep`: turn a census report into one file per hot
// block plus the index row for it.
function splitBlocks(text, dir, name, exe) {
  // The op lines the report prints are the ONLY thing after the header, and
  // they all start with six spaces and an address. Matching them positively is
  // what this has to do: a lazy `[\s\S]*?` with a `$` in its lookahead stops at
  // the first newline under the `m` flag, which silently truncates every block
  // to one op and makes a 40-op loop body read as a single `push`.
  const secRe = /^\s+--- \S+ block ([0-9a-f]+):([0-9a-f]+) \((.*?)\)\n((?:[ ]+0x[0-9a-f]+[^\n]*\n)*)/gm;
  let m; let i = 0;
  const index = [];
  while ((m = secRe.exec(text))) {
    i += 1;
    const seg = m[1]; const off = m[2]; const meta = m[3];
    const id = `${name}-${String(i).padStart(2, '0')}-${seg}_${off}`;
    const L = [`; ${id}`, `; ${meta}`, '', '; --- arena ops as dispatched ---', m[4].trimEnd()];
    // Only for real-mode addresses. dos-disasm lays the image into a 1MB
    // memory, so a 32-bit protected-mode selector:offset wraps and disassembles
    // whatever is at the wrapped address -- a page of `add [bx+si],al` over the
    // zeroed BSS, which reads exactly like a decoder giving up. Better to print
    // nothing than that.
    const linear = (parseInt(seg, 16) << 4) + parseInt(off, 16);
    if (linear >= 0 && linear < (1 << 20) && !ARGV.includes('--no-static')) {
      let staticDis = '';
      try {
        staticDis = execFileSync('node',
          [path.join(__dirname, 'toyvm', 'dos-disasm.js'), exe, `${seg}:${off}`, '24'],
          { encoding: 'utf8', timeout: 60000 });
      } catch (e) { staticDis = `; dos-disasm failed: ${e.message}`; }
      L.push('', '; --- static image disassembly (wrong if this code was unpacked) ---',
        staticDis.trimEnd());
    } else {
      L.push('', `; (no static view: ${seg}:${off} is outside the 1MB real-mode image)`);
    }
    fs.writeFileSync(path.join(dir, `${id}.asm`), `${L.join('\n')}\n`);
    const em = /(\d+) entries, (\d+) retired ops/.exec(meta);
    index.push({
      rank: i, id, program: name, addr: `${seg}:${off}`,
      entries: em ? Number(em[1]) : null, retired: em ? Number(em[2]) : null, meta,
    });
  }
  const sum = /retired guest ops in live blocks:\s+([\d,]+)/.exec(text);
  const retiredTotal = sum ? Number(sum[1].replace(/,/g, '')) : null;
  for (const b of index) b.share = (retiredTotal && b.retired) ? b.retired * 100 / retiredTotal : null;

  // 16-bit real-mode code is written in 1-3 op basic blocks, so ONE hot block
  // is never a loop body and reading it alone says nothing. The blocks the
  // census dumped, re-sorted by cs:ip, put the pieces of a loop back next to
  // each other -- adjacent ip is adjacent code -- which is the view a dataflow
  // reading actually needs. It is not a control-flow reconstruction and does
  // not claim to be: a block whose successor was too cold to be dumped simply
  // has a gap after it, and the ip column says so.
  const byIp = [...index].sort((a, b) => {
    const [as, ao] = a.addr.split(':'); const [bs, bo] = b.addr.split(':');
    return as === bs ? parseInt(ao, 16) - parseInt(bo, 16) : (as < bs ? -1 : 1);
  });
  const L = [`; ${name} -- ${index.length} hot blocks, sorted by cs:ip`,
    `; window retired ${retiredTotal ?? '?'} guest ops`, ''];
  for (const b of byIp) {
    const body = fs.readFileSync(path.join(dir, `${b.id}.asm`), 'utf8')
      .split('; --- static image')[0]
      .split('; --- arena ops as dispatched ---')[1];
    L.push(`; ${b.addr}  rank ${b.rank}  ${b.meta}`
      + (b.share === null ? '' : `  ${b.share.toFixed(2)}%`));
    L.push((body || '').trimEnd(), '');
  }
  fs.writeFileSync(path.join(dir, 'blocks-by-ip.txt'), `${L.join('\n')}\n`);

  return { program: name, exe, retiredTotal, blocks: index };
}

// ---------------------------------------------------------- dos-summary ----

// The corpus-wide arithmetic that the hand reading has to agree with. Every
// per-loop op line carries a class in brackets, and the classes come from the
// census's own classifier, so counting them over the dumped hot blocks gives a
// hit-weighted answer to "what KIND of work is in the hot loops" that is
// independent of anybody's reading of them.
function dosSummary(out) {
  const base = path.join(out, 'dos');
  if (!fs.existsSync(base)) { console.log(`no ${base}`); process.exit(2); }
  const rows = [];
  const classTotal = new Map();
  const opTotal = new Map();
  let grand = 0;
  for (const demo of fs.readdirSync(base).sort()) {
    const f = path.join(base, demo, 'index.json');
    if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const byIp = path.join(base, demo, 'blocks-by-ip.txt');
    if (!fs.existsSync(byIp)) continue;
    const perDemo = new Map();
    let demoOps = 0;
    let hits = 0;
    for (const line of fs.readFileSync(byIp, 'utf8').split('\n')) {
      const m = /^\s+0x[0-9a-f]+\s+(\d+)\s+(\S+)\s+.*?\[([^\]]+)\]/.exec(line)
        || /^\s+0x[0-9a-f]+\s+(\d+)\s+(\S+)\s*$/.exec(line);
      if (!m) continue;
      hits = Number(m[1]);
      const op = m[2];
      const classes = (m[3] || 'unclassified').split('+');
      demoOps += hits;
      opTotal.set(op, (opTotal.get(op) || 0) + hits);
      for (const c of classes) {
        perDemo.set(c, (perDemo.get(c) || 0) + hits / classes.length);
        classTotal.set(c, (classTotal.get(c) || 0) + hits / classes.length);
      }
    }
    grand += demoOps;
    rows.push({
      demo, year: Number(demo.slice(0, 4)) || null,
      retiredTotal: j.retiredTotal, hotOps: demoOps,
      top: [...perDemo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([c, n]) => `${c} ${(n * 100 / (demoOps || 1)).toFixed(0)}%`).join(' / '),
    });
  }
  const pct = n => `${(n * 100 / (grand || 1)).toFixed(2)}%`;
  console.log(`dos-summary: ${rows.length} programs, ${grand.toLocaleString()} hit-weighted ops in dumped hot blocks`);
  console.log('\nop class share across the whole corpus:');
  for (const [c, n] of [...classTotal.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(20)} ${pct(n).padStart(8)}`);
  }
  console.log('\ntop 30 handler names by hit-weighted share:');
  for (const [o, n] of [...opTotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${o.padEnd(26)} ${pct(n).padStart(8)}`);
  }
  for (const y of [1993, 1994, 1995]) {
    const yr = rows.filter(r => r.year === y);
    const tot = yr.reduce((a, r) => a + r.hotOps, 0);
    console.log(`\n${y}: ${yr.length} programs, ${tot.toLocaleString()} hot ops`);
  }
  fs.writeFileSync(path.join(out, 'dos-summary.json'),
    `${JSON.stringify({ grand, classes: [...classTotal], ops: [...opTotal], rows }, null, 1)}\n`);
  console.log(`\nwrote ${path.join(out, 'dos-summary.json')}`);
}

// ----------------------------------------------------------- load census ----

// What a GENERIC load/store split would remove, as opposed to a vocabulary of
// fused arithmetic trees. Our handlers fetch their operands out of the guest
// register file and out of guest memory on every op, so an obvious alternative
// to fusing whole expression trees is: make loads their own micro-ops, keep
// intermediates in wasm locals, and delete the repeats. This counts what there
// is to delete in the Win98 loops, per loop, from the disassembly:
//
//   * REDUNDANT LOADS -- the same memory operand text loaded more than once in
//     one loop body with no intervening store that could alias it. Each repeat
//     after the first is a load a redundant-load pass would remove.
//   * STORE->LOAD -- a load of a memory operand this body already stored to.
//     Forwarding gives it the stored value instead of a memory round trip.
//   * REG REWRITES -- `mov reg, reg`, which a local-based expression form never
//     emits at all.
//
// The `[esp+0x14]` / `[0x10027ba8]` spill reloads these loops are full of are
// exactly this population, and none of them need a new fused handler.
function loadCensus(out) {
  const base = path.join(out, 'win98');
  if (!fs.existsSync(base)) { console.log(`no ${base}`); process.exit(2); }
  const memRe = /\[([^\]]+)\]/;
  const rows = [];
  for (const app of fs.readdirSync(base).sort()) {
    const idx = path.join(base, app, 'index.json');
    if (!fs.existsSync(idx)) continue;
    const j = JSON.parse(fs.readFileSync(idx, 'utf8'));
    for (const b of j.blocks) {
      const file = path.join(base, app, `${b.id}.asm`);
      if (!fs.existsSync(file)) continue;
      const body = fs.readFileSync(file, 'utf8').split('\n')
        .filter(l => l && !l.startsWith(';'));
      const seenLoad = new Map();
      const stored = new Set();
      let loads = 0; let redundant = 0; let storeLoad = 0; let stores = 0; let regMoves = 0;
      for (const line of body) {
        const text = line.replace(/^\S+\s+(?:[0-9a-f]{2} )+\s*/, '');
        const m = memRe.exec(text);
        if (/^mov\s+e?[a-z]{2},\s*e?[a-z]{2}\s*$/.test(text)) regMoves += 1;
        if (!m) continue;
        const operand = m[1];
        // A destination memory operand is the first one after the mnemonic;
        // `mov [x], r` and `add [x], i` store, everything else loads.
        const isStore = /^\s*\S+\s+(?:\w+\s+)?\[/.test(text);
        if (isStore) { stores += 1; stored.add(operand); seenLoad.delete(operand); continue; }
        loads += 1;
        if (stored.has(operand)) storeLoad += 1;
        else if (seenLoad.has(operand)) redundant += 1;
        seenLoad.set(operand, true);
      }
      rows.push({
        app, id: b.id, share: b.share, ops: b.ops, entries: b.entries,
        loads, redundant, storeLoad, stores, regMoves,
      });
    }
  }
  const per = new Map();
  for (const r of rows) {
    const a = per.get(r.app) || { loads: 0, redundant: 0, storeLoad: 0, stores: 0, regMoves: 0, ops: 0, share: 0 };
    const w = r.entries;
    a.loads += r.loads * w; a.redundant += r.redundant * w; a.storeLoad += r.storeLoad * w;
    a.stores += r.stores * w; a.regMoves += r.regMoves * w; a.ops += r.ops * w; a.share += r.share;
    per.set(r.app, a);
  }
  console.log('load/store split, hit-weighted over each app\'s top blocks');
  console.log('  app          window covered   loads/ops  redundant  store->load  reg moves  REMOVABLE');
  for (const [app, a] of per) {
    const pc = n => `${(n * 100 / (a.ops || 1)).toFixed(1)}%`;
    console.log(`  ${app.padEnd(12)} ${a.share.toFixed(1).padStart(8)}%   `
      + `${pc(a.loads).padStart(8)}   ${pc(a.redundant).padStart(8)}   `
      + `${pc(a.storeLoad).padStart(9)}   ${pc(a.regMoves).padStart(8)}   `
      + `${pc(a.redundant + a.storeLoad + a.regMoves).padStart(8)}`);
  }
  fs.writeFileSync(path.join(out, 'load-census.json'),
    `${JSON.stringify({ rows, per: [...per] }, null, 1)}\n`);
  console.log(`\nwrote ${path.join(out, 'load-census.json')}`);
}

// ------------------------------------------------------------ aggregate ----

// Which class a hand-read family tag belongs to. ARITH is the integer/fixed-point
// expression-tree question the study asks; STREAM is the decompression/bit-stream
// idiom class; MEM is bulk byte movement; OTHER is everything that is not a
// candidate for a fused micro-op at all (waiting, counting, calling).
const FAMILY_CLASS = {
  FIXPT_STEP: 'ARITH', FIXPT_MUL: 'ARITH', ADDR_SCALE: 'ARITH', TEXEL_FETCH: 'ARITH',
  CARRY_STRIDE: 'ARITH', FIELD_REPACK: 'ARITH', BYTE_PACK: 'ARITH', LUT_XLAT: 'ARITH',
  BLEND: 'ARITH', DOT3: 'ARITH', PERSP_DIV: 'ARITH', NEW_SOFTFP_DIV: 'ARITH',
  NEW_PAL_FADE: 'ARITH', INTERP: 'ARITH', NEW_SOFTFP: 'ARITH', NEW_VEC_IMM: 'ARITH',
  NEW_PRNG: 'ARITH', NEW_ISQRT: 'ARITH', NEW_SOFTFP_MUL: 'ARITH',
  NEW_SOFTFP_NORM: 'ARITH',
  REFILL: 'STREAM', GETBITS: 'STREAM', TABLE_DECODE: 'STREAM', COPY_BACK: 'STREAM',
  RLE_TOKEN: 'STREAM', NIBBLE_PACK: 'STREAM', CRC_STEP: 'STREAM',
  MEMCOPY: 'MEM', MEMFILL: 'MEM', STRSEARCH: 'MEM',
  IO_POLL: 'OTHER', COUNTER: 'OTHER', CMP_SKIP: 'OTHER', CALL_GLUE: 'OTHER',
  X87: 'OTHER', FTOL: 'OTHER', STACKPROBE: 'OTHER', NEW_PORT_STREAM: 'OTHER',
  NEW_X87_FN: 'OTHER', NEW_SORT: 'OTHER', NEW_SORT_SWAP: 'OTHER', OTHER: 'OTHER',
};

// A tag may carry a parenthesised qualifier — BLEND(SWAR), GETBITS(1) — which
// names the variant but not the family.
function baseFam(fam) {
  return fam.replace(/\(.*$/, '').trim();
}

function classOf(fam) {
  return FAMILY_CLASS[baseFam(fam)] || 'OTHER';
}

// A row's family cell may be a composite ("RLE_TOKEN+MEMFILL"). The first tag is
// the loop's primary role; every tag is also credited separately.
function readTsvs(dir) {
  const rows = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/^read-.*\.tsv$/.test(f)) continue;
    const slice = f.replace(/^read-|\.tsv$/g, '');
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const c = line.split('\t');
      if (c.length < 4) continue;
      if (c[0] === 'app') continue; // header
      const share = parseFloat(c[2]);
      if (!isFinite(share)) continue;
      const fam = (c.length >= 6 ? c[4] : c[3]).trim();
      const tree = (c.length >= 6 ? c[5] : c[4] || '').trim();
      const prog = c[0].trim();
      // Year comes from the demo directory prefix where the reader kept it,
      // and from the slice name otherwise. The corpus is the slice, never the
      // name: a bare demo name like ANTARES must not read as a Win98 app.
      const year = (prog.match(/^(19\d\d)-/) || slice.match(/^(19\d\d)/) || [])[1] || null;
      rows.push({
        slice, prog, year, corpus: slice === 'win98' ? 'win98' : 'dos',
        block: c[1].trim(), share, fam, parts: fam.split('+').map((s) => baseFam(s)).filter(Boolean),
        tree,
      });
    }
  }
  return rows;
}

function rank(rows, key) {
  const m = new Map();
  for (const r of rows) {
    for (const p of (key === 'parts' ? r.parts : [r.parts[0]])) {
      const e = m.get(p) || { fam: p, share: 0, n: 0, progs: new Set(), example: null };
      e.share += r.share; e.n += 1; e.progs.add(r.prog);
      if (!e.example || r.share > e.example.share) e.example = r;
      m.set(p, e);
    }
  }
  return [...m.values()].sort((a, b) => b.share - a.share);
}

function pct(x, tot) { return tot ? (100 * x / tot).toFixed(1) : '0.0'; }

function printRank(title, list, tot, limit) {
  console.log(`\n${title}`);
  console.log('  rank family              class    loops  demos   Σshare   %of-slice  example');
  list.slice(0, limit).forEach((e, i) => {
    console.log(`  ${String(i + 1).padStart(4)} ${e.fam.padEnd(20)}${classOf(e.fam).padEnd(9)}${String(e.n).padStart(5)}${String(e.progs.size).padStart(7)}${e.share.toFixed(1).padStart(9)}${pct(e.share, tot).padStart(11)}%  ${e.example.prog}@${e.example.block}`);
  });
}

// Which toy-VM op classes are ALU work. This is the denominator the decision
// rule is written against ("share of dynamic ALU ops"), and it has to be
// measured, not inferred from loop weight: an IO_POLL loop contributes ops but
// almost no ALU, a BLEND loop is nearly all ALU, so loop weight and ALU weight
// are not proportional.
const ALU_CLASSES = new Set([
  'fold', 'flags', 'adc-sbb', 'muldiv', 'shift-carry', 'shift-cl', 'shift-rot',
  'terminator-flags',
]);

// Sum the hit-weighted ops of one dumped block, split into ALU and everything
// else, straight out of the blocks-by-ip.txt the sweep wrote.
function blockOps(dosBase, prog, block) {
  if (!blockOps.cache) blockOps.cache = new Map();
  let demos = blockOps.dirs;
  if (!demos) {
    demos = blockOps.dirs = fs.existsSync(dosBase) ? fs.readdirSync(dosBase) : [];
  }
  const dir = demos.includes(prog) ? prog : demos.find((d) => d.endsWith(`__${prog}`));
  if (!dir) return null;
  let byIp = blockOps.cache.get(dir);
  if (!byIp) {
    const f = path.join(dosBase, dir, 'blocks-by-ip.txt');
    if (!fs.existsSync(f)) { blockOps.cache.set(dir, new Map()); return null; }
    byIp = new Map();
    let cur = null;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const h = /^;\s+([0-9a-f]+:[0-9a-f]+)\s+rank/.exec(line);
      if (h) { cur = { alu: 0, other: 0 }; byIp.set(h[1], cur); continue; }
      if (!cur) continue;
      const m = /^\s+0x[0-9a-f]+\s+(\d+)\s+(\S+)\s+.*?\[([^\]]+)\]/.exec(line)
        || /^\s+0x[0-9a-f]+\s+(\d+)\s+(\S+)\s*$/.exec(line);
      if (!m) continue;
      const hits = Number(m[1]);
      const cs = (m[3] || 'other').split('+');
      for (const c of cs) {
        if (ALU_CLASSES.has(c)) cur.alu += hits / cs.length;
        else cur.other += hits / cs.length;
      }
    }
    blockOps.cache.set(dir, byIp);
  }
  return byIp.get(block) || null;
}

// The decision rule's own question, measured: of the ALU ops actually retired
// in the hot blocks we read, what share sits under the top-N families?
function aluCoverage(rows, dosBase) {
  const per = new Map();
  const byProgFam = new Map();
  let alu = 0; let matched = 0; let missed = 0;
  for (const r of rows) {
    const b = blockOps(dosBase, r.prog, r.block);
    if (!b) { missed += 1; continue; }
    matched += 1;
    alu += b.alu;
    const k = r.parts[0];
    per.set(k, (per.get(k) || 0) + b.alu);
    if (!byProgFam.has(k)) byProgFam.set(k, new Map());
    const pm = byProgFam.get(k);
    pm.set(r.prog, (pm.get(r.prog) || 0) + b.alu);
  }
  const list = [...per.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\nMEASURED ALU-op coverage (${matched} of ${matched + missed} read loops located in the dumps; ` +
    `${Math.round(alu).toLocaleString()} hit-weighted ALU ops)`);
  console.log('  rank family            class    %ALU  progs  top prog');
  list.slice(0, 20).forEach(([k, v], i) => {
    const pm = byProgFam.get(k);
    const top = [...pm.values()].sort((a, b) => b - a)[0] || 0;
    console.log(`  ${String(i + 1).padStart(3)} ${k.padEnd(18)}${classOf(k).padEnd(8)}${pct(v, alu).padStart(6)}%${String(pm.size).padStart(6)}${pct(top, v).padStart(9)}%`);
  });
  const arithOnly = list.filter(([k]) => classOf(k) === 'ARITH');
  for (const n of [5, 10, 20]) {
    const cov = arithOnly.slice(0, n).reduce((a, e) => a + e[1], 0);
    console.log(`  top ${String(n).padStart(2)} ARITH families: ${pct(cov, alu).padStart(6)}% of dynamic ALU ops`);
  }
}

// The same measurement for Win98, where there is no toy-VM class tag: classify
// each disassembled mnemonic instead, and weight by block entries. `mov` is not
// ALU here, and neither is a branch -- what a fused arithmetic micro-op could
// stand in for is the arithmetic.
const ALU_MNEM = /^(add|adc|sub|sbb|and|or|xor|not|neg|inc|dec|shl|shr|sar|rol|ror|rcl|rcr|shld|shrd|imul|mul|idiv|div|test|cmp|lea|setn?[a-z]+|movsx|movzx|bswap|bt[a-z]*|xadd|pand|por|pxor|padd[a-z]*|psub[a-z]*|psll[a-z]|psrl[a-z]|psra[a-z]|pmul[a-z]*|cbw|cwde|cdq)$/;

function winAluCoverage(rows, winBase) {
  const idx = new Map();
  if (!fs.existsSync(winBase)) return;
  for (const app of fs.readdirSync(winBase)) {
    const f = path.join(winBase, app, 'index.json');
    if (!fs.existsSync(f)) continue;
    for (const b of JSON.parse(fs.readFileSync(f, 'utf8')).blocks) {
      const asm = path.join(winBase, app, `${b.id}.asm`);
      if (!fs.existsSync(asm)) continue;
      let alu = 0; let other = 0;
      for (const line of fs.readFileSync(asm, 'utf8').split('\n')) {
        if (!/^[0-9a-f]{8}\s/.test(line)) continue;
        const mn = (line.split(/\s{2,}/).pop() || '').trim().split(/\s+/)[0];
        if (ALU_MNEM.test(mn)) alu += b.entries; else other += b.entries;
      }
      idx.set(`${app}|${b.module.replace(/\.(dll|exe)$/i, '')}+${b.origVa}`, { alu, other });
    }
  }
  let alu = 0; let matched = 0; let missed = 0;
  const per = new Map();
  for (const r of rows) {
    const e = idx.get(`${r.prog}|${r.block}`);
    if (!e) { missed += 1; continue; }
    matched += 1; alu += e.alu;
    per.set(r.parts[0], (per.get(r.parts[0]) || 0) + e.alu);
  }
  const list = [...per.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\nMEASURED ALU-op coverage, win98 (${matched} of ${matched + missed} read loops matched; ` +
    `${Math.round(alu).toLocaleString()} entry-weighted ALU instructions)`);
  list.slice(0, 15).forEach(([k, v], i) => {
    console.log(`  ${String(i + 1).padStart(3)} ${k.padEnd(18)}${classOf(k).padEnd(8)}${pct(v, alu).padStart(7)}%`);
  });
  const arithOnly = list.filter(([k]) => classOf(k) === 'ARITH');
  for (const n of [5, 10, 20]) {
    const cov = arithOnly.slice(0, n).reduce((a, e) => a + e[1], 0);
    console.log(`  top ${String(n).padStart(2)} ARITH families: ${pct(cov, alu).padStart(6)}% of dynamic ALU ops`);
  }
}

function aggregate(out) {
  const dir = arg('read', out);
  const rows = readTsvs(dir);
  if (!rows.length) { console.log(`no read-*.tsv in ${dir}`); return; }
  const progs = new Set(rows.map((r) => r.prog));
  console.log(`${rows.length} hand-read loops across ${progs.size} programs (${[...new Set(rows.map((r) => r.slice))].join(', ')})`);

  for (const corpus of ['win98', 'dos']) {
    const sub = rows.filter((r) => r.corpus === corpus);
    if (!sub.length) continue;
    const tot = sub.reduce((a, r) => a + r.share, 0);
    const nprog = new Set(sub.map((r) => r.prog)).size;
    console.log(`\n================ ${corpus}: ${sub.length} loops, ${nprog} programs, Σshare ${tot.toFixed(0)} points`);
    printRank('(1) by total dynamic share', rank(sub, 'parts'), tot, 20);

    // (2) how many programs carry the family in their own top 3
    const top3 = [];
    for (const p of new Set(sub.map((r) => r.prog))) {
      const rs = sub.filter((r) => r.prog === p).sort((a, b) => b.share - a.share).slice(0, 3);
      top3.push(...rs);
    }
    const byProg = rank(top3, 'parts').sort((a, b) => b.progs.size - a.progs.size || b.share - a.share);
    console.log('\n(2) by number of programs with the family in their own top 3');
    console.log('  rank family              class    demos   %of-progs   Σshare');
    byProg.slice(0, 20).forEach((e, i) => {
      console.log(`  ${String(i + 1).padStart(4)} ${e.fam.padEnd(20)}${classOf(e.fam).padEnd(9)}${String(e.progs.size).padStart(6)}${pct(e.progs.size, nprog).padStart(11)}%${e.share.toFixed(1).padStart(9)}`);
    });

    // class rollup + coverage of the ARITH-only denominator
    const cls = new Map();
    for (const r of sub) cls.set(classOf(r.parts[0]), (cls.get(classOf(r.parts[0])) || 0) + r.share);
    console.log('\nclass rollup (primary tag):');
    [...cls.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => console.log(`  ${k.padEnd(8)}${pct(v, tot).padStart(7)}%  of read loop weight`));

    const arith = sub.filter((r) => classOf(r.parts[0]) === 'ARITH');
    const arithTot = arith.reduce((a, r) => a + r.share, 0);
    const ar = rank(arith, 'primary');
    console.log(`\ncoverage if each tree were ONE fused micro-op (denominator = ARITH loops only, Σ${arithTot.toFixed(0)}):`);
    for (const k of [5, 10, 20]) {
      const cov = ar.slice(0, k).reduce((a, e) => a + e.share, 0);
      console.log(`  top ${String(k).padStart(2)} trees: ${pct(cov, arithTot).padStart(6)}% of ARITH weight, ${pct(cov, tot).padStart(6)}% of all read loop weight`);
    }
    const stream = sub.filter((r) => classOf(r.parts[0]) === 'STREAM');
    const st = rank(stream, 'primary');
    console.log(`\nSTREAM idioms ranked separately (Σ${stream.reduce((a, r) => a + r.share, 0).toFixed(0)} = ${pct(stream.reduce((a, r) => a + r.share, 0), tot)}% of read weight):`);
    st.slice(0, 10).forEach((e, i) => console.log(`  ${String(i + 1).padStart(3)} ${e.fam.padEnd(16)}${String(e.progs.size).padStart(4)} progs  Σ${e.share.toFixed(1)}`));

    if (corpus === 'dos') {
      for (const y of ['1993', '1994', '1995']) {
        const ys = sub.filter((r) => r.year === y);
        if (!ys.length) continue;
        const yt = ys.reduce((a, r) => a + r.share, 0);
        const yl = rank(ys, 'parts').slice(0, 8);
        console.log(`\n  ${y}: ${ys.length} loops, ${new Set(ys.map((r) => r.prog)).size} demos — ` +
          yl.map((e) => `${e.fam} ${pct(e.share, yt)}%`).join(', '));
      }
    }
  }
  const dosBase = path.join(arg('dos', path.join(out, 'loops2')), 'dos');
  if (fs.existsSync(dosBase)) aluCoverage(rows.filter((r) => r.corpus === 'dos'), dosBase);
  winAluCoverage(rows.filter((r) => r.corpus === 'win98'), path.join(arg('win', path.join(out, 'loops')), 'win98'));
  fs.writeFileSync(path.join(out, 'aggregate.json'), `${JSON.stringify(rows, null, 1)}\n`);
  console.log(`\nwrote ${path.join(out, 'aggregate.json')}`);
}

// ---------------------------------------------------------------- index ----

function indexAll(out) {
  const rows = [];
  for (const corpus of ['win98', 'dos']) {
    const base = path.join(out, corpus);
    if (!fs.existsSync(base)) continue;
    for (const app of fs.readdirSync(base).sort()) {
      const f = path.join(base, app, 'index.json');
      if (!fs.existsSync(f)) continue;
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const b of j.blocks) rows.push({ corpus, ...b });
    }
  }
  fs.writeFileSync(path.join(out, 'index.json'), `${JSON.stringify(rows, null, 1)}\n`);
  console.log(`${rows.length} loops indexed to ${path.join(out, 'index.json')}`);
}

function main() {
  const out = arg('out', path.join(ROOT, 'build', 'hot-loops'));
  fs.mkdirSync(out, { recursive: true });
  if (MODE === 'win98') win98(out);
  else if (MODE === 'dos') dos(out);
  else if (MODE === 'dos-sweep') dosSweep(out);
  else if (MODE === 'dos-summary') dosSummary(out);
  else if (MODE === 'load-census') loadCensus(out);
  else if (MODE === 'aggregate') aggregate(out);
  else if (MODE === 'index') indexAll(out);
  else {
    console.log('usage: node tools/hot-loop-corpus.js win98|dos|dos-sweep|index [options]');
    console.log('  win98 --log=RUN.log --hot=HOT.txt --app=NAME [--exe=PATH] [--top=25] [--max-ops=48]');
    console.log('  dos   --exe=PROG.EXE [--top=10] [--show=24] [--dispatches=8m] [--pit-clock] [--auto-key]');
    console.log('  dos-sweep [--root=/tmp/demos] [--jobs=6] [--secs=60] [--top=5] [--dispatches=12m]');
    console.log('  aggregate --read=DIR   (rank the hand-read read-*.tsv files)');
    console.log('  index');
    console.log('  common: --out=DIR');
    process.exit(2);
  }
}

if (require.main === module) main();
module.exports = { parseModules, resolve, disasmBlock };
