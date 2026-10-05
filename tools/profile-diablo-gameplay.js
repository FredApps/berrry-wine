#!/usr/bin/env node
'use strict';
// Resolve a gameplay V8 profile against the actual benchmark WASM name section,
// not source order (which can drift from a compiled artifact).
const fs = require('fs');
const crypto = require('crypto');
const [profilePath, wasmPath, canonicalPath] = process.argv.slice(2);
if (!profilePath || !wasmPath) throw new Error('usage: profile-diablo-gameplay.js PROFILE WASM');
const profile = JSON.parse(fs.readFileSync(profilePath));
const wasm = fs.readFileSync(wasmPath);
function executableSections(b) {
  let p = 8; const sections = [b.subarray(0, 8)];
  while (p < b.length) {
    const start = p, id = b[p++]; let size = 0, shift = 0, byte;
    do { byte = b[p++]; size |= (byte & 127) << shift; shift += 7; } while (byte & 128);
    p += size;
    if (id !== 0) sections.push(b.subarray(start, p));
  }
  return Buffer.concat(sections);
}
const canonical = canonicalPath ? fs.readFileSync(canonicalPath) : wasm;
if (!executableSections(wasm).equals(executableSections(canonical)))
  throw new Error('named reference differs from measured WASM executable sections');
const names = new Map();
for (const section of WebAssembly.Module.customSections(new WebAssembly.Module(wasm), 'name')) {
  const b = new Uint8Array(section); let p = 0;
  const uleb = () => {
    let n = 0, shift = 0, v;
    do { if (p >= b.length || shift > 28) throw new Error('invalid name section');
      v = b[p++]; n |= (v & 127) << shift; shift += 7;
    } while (v & 128);
    return n >>> 0;
  };
  while (p < b.length) {
    const kind = uleb(), size = uleb(), end = p + size;
    if (kind === 1) {
      const count = uleb();
      for (let i = 0; i < count; i++) {
        const index = uleb(), length = uleb();
        names.set(index, Buffer.from(b.subarray(p, p + length)).toString()); p += length;
      }
    }
    p = end;
  }
}
if (!names.size) throw new Error('WASM lacks function names; refusing guessed labels');
const nodes = new Map(profile.nodes.map(n => [n.id, n]));
const time = new Map(); let totalUs = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const node = nodes.get(profile.samples[i]), frame = node.callFrame;
  const wasmFrame = (frame.url || '').startsWith('wasm:') || /^wasm-function\[/.test(frame.functionName);
  const index = /^wasm-function\[(\d+)\]$/.exec(frame.functionName);
  const name = index ? names.get(+index[1]) || frame.functionName : frame.functionName || '(anonymous)';
  const key = `${wasmFrame ? 'wasm' : 'host'}:${name}`;
  const dt = profile.timeDeltas[i] || 0;
  totalUs += dt;
  const row = time.get(key) || { name, wasm: wasmFrame, us: 0, samples: 0,
    functionIndex: index ? +index[1] : null,
    source: frame.url || '', line: frame.lineNumber + 1 };
  row.us += dt; row.samples++; time.set(key, row);
}
const rows = [...time.values()].sort((a, b) => b.us - a.us)
  .map(r => ({ ...r, percent: 100 * r.us / totalUs }));
const wasmUs = rows.filter(r => r.wasm).reduce((n, r) => n + r.us, 0);
const result = { profilePath, wasmSha256: crypto.createHash('sha256').update(canonical).digest('hex'),
  totalMs: totalUs / 1000, samples: profile.samples.length,
  wasmPercent: 100 * wasmUs / totalUs, rows };
fs.writeFileSync(profilePath + '.summary.json', JSON.stringify(result, null, 2) + '\n');
console.log(`Sampled ${(totalUs / 1000).toFixed(1)}ms, ${profile.samples.length} samples; WASM ${result.wasmPercent.toFixed(1)}%`);
for (const r of rows.slice(0, 35)) console.log(`${r.percent.toFixed(2).padStart(6)}%  ${(r.us / 1000).toFixed(1).padStart(8)}ms  ${r.wasm ? 'WASM' : 'host'} ${r.name}`);
