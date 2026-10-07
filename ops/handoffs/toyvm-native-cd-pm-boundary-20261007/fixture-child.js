'use strict';
// Real instruction fixture; NEVER loaded by pure-JS source tests. Requires
// separate serialized compile/WASM grant. Each baseline/candidate is a fresh
// process to avoid compileWat's per-variant in-process cache.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
async function main() {
  const root = process.argv[2], candidate = process.argv[3] === 'candidate';
  let installed;
  if (candidate) {
    const source = fs.readFileSync(path.join(root, 'tools/toyvm/emit.js'));
    installed = require('./install').install(root, crypto.createHash('sha256').update(source).digest('hex'));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toyvm-cr3-proof-'));
  try {
    const file = path.join(dir, 'CR3.COM');
    // Actual guest MOV CR3,EAX twice. Original core still ignores CR3. This
    // fixture checks recording only; it does not pretend to prove paging.
    fs.writeFileSync(file, Buffer.from([0x66,0xb8,0x00,0x50,0x34,0x12,0x0f,0x22,0xd8,0x66,0xb8,0x00,0x90,0x78,0x56,0x0f,0x22,0xd8,0xb8,0x00,0x4c,0xcd,0x21]));
    const { runDos } = require(path.join(root, 'tools/toyvm/run-dos'));
    const r = await runDos({ exe: file, budget: 1000, seconds: 1, sound: false, autoKey: false, log() {} });
    const ex = r.vm.exports;
    const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    const sourceClosure = Object.keys(require.cache).filter(name => name.startsWith(root + path.sep)).sort().map(name => ({ path: path.relative(root, name), sha256: sha(fs.readFileSync(name)) }));
    console.log(JSON.stringify({ candidate, sourceClosure, moduleSha256: sha(r.vm.bytes), moduleBytes: r.vm.bytes.length, emitter: installed ? { originalSha256: installed.originalSha256, privateSha256: installed.privateSha256 } : { originalSha256: sha(fs.readFileSync(path.join(root, 'tools/toyvm/emit.js'))) }, exited: r.machine.exited, exitCode: r.machine.exitCode, registers: Object.fromEntries(['ax','bx','cx','dx','si','di','sp','bp','cs','ss','ds','es','gip','flags'].map(k => [k, r.vm.get(k)])), cr0: ex.get_cr0() >>> 0, memorySha256: crypto.createHash('sha256').update(r.vm.mem).digest('hex'), recorded: candidate ? { count: ex.diag_get_cr3_count() >>> 0, last: ex.diag_get_cr3_last() >>> 0 } : null }));
  } finally { fs.rmSync(dir, { recursive: true }); if (installed && !installed.restore()) throw Error('emitter restore identity changed'); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
