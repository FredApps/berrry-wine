#!/usr/bin/env node
'use strict';
// Switch jump tables, `cmp r,N ; ja default ; jmp [tbl+r*4]` and the byte-index
// double table `movzx r,byte [r+btab] ; jmp [dtab+r*4]`, in both tiers.
//
// Threaded tier: handler 498 ($th_jmp_tbl, 06b) re-reads the table entry on
// every dispatch and leaves through $branch_end. Micro-op tier (07e kind 28,
// 07d JTBL, engine op 81): a guarded br_table over the targets the table held at compile
// time; an index past the snapshot or an entry that no longer holds its
// snapshot value exits to threaded code at the jump.
//
// Every case runs against a reference arm (jump-table op off, uop tier off)
// and must match it in registers, EIP, flags, the working buffer, the table
// bytes and -- under the branch clock -- every batch stop. The uop arms must
// also actually enter a program: a lowering that declines everything is
// trivially exact. The table-rewrite cases have the loop itself store into
// its own table mid-run, both to another in-table target and to a target the
// table never held.

const path = require('path');
const ROOT = path.join(__dirname, '..');
const bench = require(path.join(ROOT, 'tools', 'bench-loops.js'));

// ---- assembler: bytes, {label}, {jcc,to}/{jmp,to} rel8, {abs,to} imm32 ----
function asm(items, origin) {
  const at = new Map();
  let out;
  for (let pass = 0; pass < 2; pass++) {
    let pc = 0;
    out = [];
    for (const it of items) {
      if (typeof it === 'number') { out.push(it); pc++; continue; }
      if (Array.isArray(it)) { out.push(...it); pc += it.length; continue; }
      if (it.label) { at.set(it.label, pc); continue; }
      const t = at.get(it.to) ?? pc;
      if (it.abs) { out.push(...d32(origin + t)); pc += 4; continue; }
      const rel = t - (pc + 2);
      if (pass === 1 && (rel < -128 || rel > 127)) throw new Error(`rel8 out of range to ${it.to}`);
      out.push(it.jmp ? 0xEB : 0x70 | it.jcc, rel & 0xFF);
      pc += 2;
    }
  }
  const labels = {};
  for (const [k, v] of at) labels[k] = origin + v;
  return { bytes: out, labels };
}
const J = (cc, to) => ({ jcc: cc, to });
const JMP = (to) => ({ jmp: true, to });
const L = (label) => ({ label });
const ABS = (to) => ({ abs: true, to });
const d32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
const cc = { Z: 4, NZ: 5, A: 7 };

const N = 3000;
const BATCH = +(process.env.JT_BATCH || 37);
const REGS = ['eax', 'ecx', 'edx', 'ebx', 'ebp', 'esi', 'edi'];

// Case bodies shared by the cases below. Each ends by jumping to 'n'.
const BODIES = [
  ['c0', [0x83, 0xC0, 0x01]],            // add eax,1
  ['c1', [0x83, 0xF0, 0x55]],            // xor eax,0x55
  ['c2', [0x01, 0xC3]],                  // add ebx,eax
  ['c3', [0x83, 0xE8, 0x03]],            // sub eax,3
  ['c4', [0xD1, 0xE0]],                  // shl eax,1
  ['c5', [0x88, 0x07, 0x47]],            // mov [edi],al ; inc edi
];
function bodies(extra = {}) {
  const out = [];
  for (const [name, b] of BODIES) out.push(L(name), b, ...(extra[name] || []), JMP('n'));
  return out;
}
// Tail: default case, then the loop counter.
const TAIL = [L('def'), [0x83, 0xC2, 0x01], L('n'), 0x4D, J(cc.NZ, 'l'), 0xC3];  // add edx,1 ; dec ebp ; jnz l ; ret

// jmp dword [disp32 + ecx*4]: FF /4, modrm 00 100 100, SIB 10 001 101
const JMP_TBL_ECX = (tbl) => [0xFF, 0x24, 0x8D, ...d32(tbl)];

const CASES = [
  {
    // 6 entries, index = byte & 7, so 6 and 7 take the default arm.
    name: 'switch6',
    tables: (a) => ({ tbl: a.tbl, ents: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'] }),
    code: (a) => [L('l'), [0x0F, 0xB6, 0x0E], 0x46, [0x83, 0xE1, 0x07], [0x83, 0xF9, 0x05], J(cc.A, 'def'),
      JMP_TBL_ECX(a.tbl), ...bodies(), ...TAIL],
  },
  {
    // Two table entries share a target, so distinct targets < entries.
    name: 'switch8-shared',
    tables: (a) => ({ tbl: a.tbl, ents: ['c0', 'c1', 'c2', 'c1', 'c4', 'c5', 'c0', 'c3'] }),
    code: (a) => [L('l'), [0x0F, 0xB6, 0x0E], 0x46, [0x83, 0xE1, 0x0F], [0x83, 0xF9, 0x07], J(cc.A, 'def'),
      JMP_TBL_ECX(a.tbl), ...bodies(), ...TAIL],
  },
  {
    // Byte-index double table: movzx ecx, byte [ecx+btab] ; jmp [dtab+ecx*4].
    name: 'double-table',
    tables: (a) => ({ tbl: a.tbl, ents: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'],
      btab: a.btab, bents: [0, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 0, 2, 2, 5, 1] }),
    code: (a) => [L('l'), [0x0F, 0xB6, 0x0E], 0x46, [0x83, 0xE1, 0x1F], [0x83, 0xF9, 0x0F], J(cc.A, 'def'),
      [0x0F, 0xB6, 0x89, ...d32(a.btab)], JMP_TBL_ECX(a.tbl), ...bodies(), ...TAIL],
  },
  {
    // MSVC's form of the double table (tools/find-jump-tables.js XORMOV2,
    // the commonest bounded shape in Heroes III): xor eax,eax ;
    // mov al, byte [ecx+btab] ; jmp [tbl+eax*4].
    name: 'xormov-table',
    tables: (a) => ({ tbl: a.tbl, ents: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'],
      btab: a.btab, bents: [5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 1, 1, 3, 0] }),
    code: (a) => [L('l'), [0x0F, 0xB6, 0x0E], 0x46, [0x83, 0xE1, 0x1F], [0x83, 0xF9, 0x0F], J(cc.A, 'def'),
      [0x33, 0xC0], [0x8A, 0x81, ...d32(a.btab)], [0xFF, 0x24, 0x85, ...d32(a.tbl)], ...bodies(), ...TAIL],
  },
  {
    // The loop rewrites its own table: case 3 points entry 0 at case 4 (a
    // target the table already holds), then later case 5 points entry 1 at
    // 'x', a block the table never held. Both tiers must follow the table.
    name: 'rewrite',
    tables: (a) => ({ tbl: a.tbl, ents: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'] }),
    code: (a) => [L('l'), [0x0F, 0xB6, 0x0E], 0x46, [0x83, 0xE1, 0x07], [0x83, 0xF9, 0x05], J(cc.A, 'def'),
      JMP_TBL_ECX(a.tbl),
      ...bodies({
        // cmp ebp, N-500 ; jnz skip ; mov dword [tbl], c4
        c3: [[0x81, 0xFD, ...d32(N - 500)], J(cc.NZ, 's3'), [0xC7, 0x05, ...d32(a.tbl)], ABS('c4'), L('s3')],
        // cmp ebp, N-1500 ; jnz skip ; mov dword [tbl+4], x
        c5: [[0x81, 0xFD, ...d32(N - 1500)], J(cc.NZ, 's5'), [0xC7, 0x05, ...d32(a.tbl + 4)], ABS('x'), L('s5')],
      }),
      L('x'), [0x83, 0xC3, 0x07], JMP('n'),                // add ebx,7
      ...TAIL],
  },
  {
    // The host rewrites the table between batches (the uop tier's snapshot
    // must deopt on the stale entry, not take the old target).
    name: 'host-rewrite',
    tables: (a) => ({ tbl: a.tbl, ents: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'] }),
    hostRewrite: { batch: 30, entry: 2, to: 'c5' },
    code: (a) => [L('l'), [0x0F, 0xB6, 0x0E], 0x46, [0x83, 0xE1, 0x07], [0x83, 0xF9, 0x05], J(cc.A, 'def'),
      JMP_TBL_ECX(a.tbl), ...bodies(), ...TAIL],
  },
];

function seed(mem, g2w, a) {
  let x = 0x2468ACE;
  const src = g2w(a.buf);
  for (let k = 0; k < 0x10000; k++) {
    x = (Math.imul(x, 1103515245) + 12345) | 0;
    mem[src + k] = (x >>> 16) & 0xFF;
  }
  mem.fill(0x11, g2w(a.buf + 0x10000), g2w(a.buf + 0x10000) + 0x10000);
}

function hash(mem, g2w, a, codeAddr) {
  let h = 0x811C9DC5;
  const s = g2w(a.buf);
  for (let k = 0; k < 0x20000; k++) h = Math.imul(h ^ mem[s + k], 16777619);
  // Table entries are code addresses: hash them relative to the code.
  const dv = new DataView(mem.buffer);
  for (let k = 0; k < 16; k++) h = Math.imul(h ^ ((dv.getUint32(g2w(a.tbl + 4 * k), true) - codeAddr) | 0), 16777619);
  return h >>> 0;
}

function runCase(inst, c, a, codeAddr, arm) {
  const { e, mem, g2w } = inst;
  const dv = new DataView(e.memory.buffer);
  seed(mem, g2w, a);
  const { bytes, labels } = asm(c.code(a), codeAddr);
  mem.set(bytes, g2w(codeAddr));
  const t = c.tables(a);
  for (let k = 0; k < 16; k++) dv.setUint32(g2w(t.tbl + 4 * k), codeAddr, true);
  t.ents.forEach((n, k) => dv.setUint32(g2w(t.tbl + 4 * k), labels[n], true));
  if (t.btab) t.bents.forEach((v, k) => { mem[g2w(t.btab + k)] = v; });
  const init = { eax: 7, ecx: 0, edx: 0, ebx: 0, ebp: N, esi: a.buf, edi: a.buf + 0x10000 };
  for (const r of REGS) e['set_' + r](init[r] >>> 0);
  e.set_jump_table(arm.jt);
  e.set_uop(arm.uop === 'off' ? 0 : 1);
  if (arm.hist) { e.reset_handler_hist(); e.set_handler_hist_enabled(1); }
  const before = { enters: e.uop_stats(4), blocks: e.uop_stats(5) };
  if (arm.uop === 'pre') {
    const pc = e.uop_compile(codeAddr);
    if (!pc) {
      e.set_uop(0); e.set_jump_table(1);
      const why = WAT_REASONS.findIndex((_, k) => k && e.uop_decline_count(k) !== arm.declines[k]);
      return { err: 'pre-compile declined: ' + (WAT_REASONS[why] || '?') };
    }
    e.uop_install(codeAddr, pc);
  }
  e.set_esp(a.stackTop);
  dv.setUint32(g2w(a.stackTop), 0, true);
  e.set_eip(codeAddr);
  const stops = [];
  let ok = false;
  for (let k = 0; k < 40000; k++) {
    if (c.hostRewrite && k === c.hostRewrite.batch) {
      dv.setUint32(g2w(a.tbl + 4 * c.hostRewrite.entry), labels[c.hostRewrite.to], true);
    }
    e.run(BATCH);
    const eip = e.get_eip() >>> 0;
    if (eip === 0) { ok = true; break; }
    stops.push(eip - codeAddr);
  }
  let h498 = 0;
  if (arm.hist) {
    e.set_handler_hist_enabled(0);
    h498 = new DataView(e.memory.buffer).getUint32(e.get_handler_hist_base() + 498 * 4, true);
  }
  const st = {
    ok, eip: e.get_eip() >>> 0, stops: stops.join(','), nstops: stops.length, flags: e.uop_flags(),
    mem: hash(mem, g2w, a, codeAddr), regs: REGS.map((r) => e['get_' + r]() >>> 0),
    enters: e.uop_stats(4) - before.enters, blocks: (e.uop_stats(5) - before.blocks) >>> 0, h498,
  };
  e.set_uop(0);
  e.set_jump_table(1);
  return st;
}

const WAT_REASONS = [null, 'scan-limit', 'overlap', 'head-unsupported', 'no-backedge', 'loop-too-big',
  'seam-ambiguous', 'long-block', 'unreached-block', 'demand-no-fixpoint', 'branch-mid-block',
  'dead-flags-consumed', 'dead-cf', 'cf-no-recipe', 'cf-kind', 'dead-flags-rec', 'rec-no-recipe', 'rec-kind',
  'dead-flags-jcc', 'kind', 'too-many-windows', 'label', 'arg', 'too-many-temps', 'program-too-big',
  'ranges-full', 'scratch-overflow', 'call-indirect'];

async function main() {
  bench.ensureBuilt();
  const inst = await bench.newInstance();
  const { e } = inst;
  const a = bench.layout(inst.imageBase, 0x20000);
  // Tables live in the page after the LUT (a.lut is 256 bytes).
  a.tbl = a.lut + 0x400;
  a.btab = a.lut + 0x800;
  let slot = 0;
  let fails = 0;
  const only = process.env.JT_CASE;
  const noUop = !!process.env.JT_NO_UOP;
  for (const clock of [0, 1]) {
    e.set_branch_clock(clock);
    console.log(clock ? '-- branch clock' : '-- block clock');
    for (const c of CASES) {
      if (only && c.name !== only) continue;
      const at = () => a.code + 0x1000 * slot++;
      const ref = runCase(inst, c, a, at(), { jt: 0, uop: 'off' });
      if (!ref.ok) { fails++; console.log(`${c.name.padEnd(16)} FAIL reference did not return`); continue; }
      const arms = [
        { name: 'jt', jt: 1, uop: 'off', hist: true },
        ...(noUop ? [] : [
          { name: 'jt+uop', jt: 1, uop: 'hot' },
          { name: 'jt+pre', jt: 1, uop: 'pre' },
          { name: 'nojt+uop', jt: 0, uop: 'hot' },
        ]),
      ];
      const results = [];
      for (const arm of arms) {
        arm.declines = WAT_REASONS.map((_, k) => k && e.uop_decline_count(k));
        const st = runCase(inst, c, a, at(), arm);
        if (st.err) { fails++; results.push(`${arm.name}: FAIL ${st.err}`); continue; }
        const d = [];
        if (!st.ok) d.push('did not return');
        if (st.eip !== ref.eip) d.push('eip');
        if (st.flags !== ref.flags) d.push(`flags ${st.flags.toString(2)} vs ${ref.flags.toString(2)}`);
        if (st.mem !== ref.mem) d.push('memory');
        REGS.forEach((r, k) => { if (st.regs[k] !== ref.regs[k]) d.push(`${r} ${st.regs[k].toString(16)} vs ${ref.regs[k].toString(16)}`); });
        // Stops: the threaded arm charges exactly what the old indirect jump
        // did, under both clocks. The tier matches under the branch clock
        // (the block clock's cut history differs during warmup, as in
        // test-uop-compiler.js).
        const wantStops = arm.uop === 'off' || (clock && arm.uop !== 'pre');
        if (wantStops && st.stops !== ref.stops) {
          const x = st.stops.split(','), y = ref.stops.split(',');
          let k = 0; while (k < x.length && x[k] === y[k]) k++;
          d.push(`batch ${k} stops at +0x${(+x[k]).toString(16)} vs +0x${(+y[k]).toString(16)} (${st.nstops} vs ${ref.nstops})`);
        }
        if (arm.hist && !st.h498) d.push('handler 498 never ran');
        if (arm.uop !== 'off' && arm.jt && !st.enters) d.push('never entered');
        if (d.length) fails++;
        results.push(`${arm.name}: ${d.length ? 'FAIL ' + d.join(', ') : 'ok'}${arm.uop !== 'off' ? ` (enters=${st.enters} blocks=${st.blocks})` : ''}`);
      }
      console.log(`${c.name.padEnd(16)} ${results.join(' | ')}`);
    }
  }
  e.set_branch_clock(0);
  const why = WAT_REASONS.map((n, k) => [n, k && e.uop_decline_count(k)]).filter(([, n]) => n).map(([k, n]) => `${k}=${n}`).join(' ');
  if (why) console.log(`uop declines: ${why}`);
  if (fails) { console.log(`FAIL: ${fails}`); process.exit(1); }
  console.log('PASS');
}

main().catch((err) => { console.error(err.stack || String(err)); process.exit(1); });
