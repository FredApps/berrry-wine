#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
// Optional red-baseline mode substitutes only the committed font fragment in
// the compiler's virtual closure; it never rewrites the shared worktree.
if (process.argv.includes('--baseline')) {
  const { execFileSync } = require('child_process');
  const baseline = execFileSync('git', ['show', 'HEAD:src/10c-truetype.wat'],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const compiler = require('./compile-src');
  const compile = compiler.compileSrcWasm;
  compiler.compileSrcWasm = transform => compile((file, source) => {
    if (file === '10c-truetype.wat') source = baseline;
    return transform ? transform(file, source) : source;
  });
}
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "identity_source") (param i32 i32 i32) (result i32)
    (call $tt_face_open_source (local.get 0) (local.get 1) (local.get 2)))
  (func (export "identity_hash") (param i32) (result i32)
    (call $tt_path_hash (call $g2w (local.get 0))))
  (func (export "identity_faces") (result i32) (global.get $tt_faces))
  (func (export "identity_heap") (result i32) (global.get $heap_ptr))
  (func (export "identity_free") (result i32) (global.get $free_list))
`;

(async () => {
  const h = await bootRenderHarness({ fonts: 'none', extraWat });
  const e = h.exports, vfs = h.hostCtx.vfs;
  const memory = new Uint8Array(h.memory.buffer);
  const wa = p => e.guest_to_wasm(p) >>> 0;
  function alloc(data) {
    const p = e.guest_alloc(data.length) >>> 0;
    assert(p); memory.set(data, wa(p)); return p;
  }
  const text = s => alloc(Buffer.from(s + '\0', 'latin1'));
  const font = name => new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'fonts', 'liberation', name)));
  const sans = font('LiberationSans-Regular.ttf');
  const mono = font('LiberationMono-Regular.ttf');
  const pathA = 'c:\\font-id\\5pvu.ttf', pathB = 'c:\\font-id\\c3ea.ttf';
  const pA = text(pathA), pB = text(pathB);
  // Deterministic FNV-1a collision, checked against the actual WAT hash.
  assert.strictEqual(e.identity_hash(pA) >>> 0, 3656534779);
  assert.strictEqual(e.identity_hash(pB), e.identity_hash(pA));
  vfs.dirs.add('c:\\font-id');
  vfs.files.set(pathA, { data: sans, attrs: 0x20 });
  vfs.files.set(pathB, { data: mono, attrs: 0x20 });
  let io = 0;
  for (const name of ['createFile', 'readFile']) {
    const original = vfs[name].bind(vfs);
    vfs[name] = (...args) => { io++; return original(...args); };
  }
  const roots = () => [e.identity_faces(), e.identity_heap(), e.identity_free()];
  const cold = roots();
  assert.strictEqual(e.identity_source(pA, 0, -1), -1);
  assert.deepStrictEqual(roots(), cold, 'cold cache-only lookup must not allocate');
  assert.strictEqual(io, 0, 'cold cache-only lookup must not perform filesystem I/O');

  const a = e.test_tt_face_open(pA), b = e.test_tt_face_open(pB);
  assert(a >= 0 && b >= 0);
  assert.notStrictEqual(b, a, 'distinct paths sharing a hash must own distinct faces');
  assert.strictEqual(e.test_tt_face_size(a), sans.length);
  assert.strictEqual(e.test_tt_face_size(b), mono.length);
  const widths = face => [...'iWm'].map(c => e.test_tt_face_char_width(face, c.charCodeAt(0), 24));
  assert.notDeepStrictEqual(widths(a), widths(b), 'different real fonts must retain different metrics');
  const aWidths = widths(a), bWidths = widths(b);
  const upperA = text(pathA.toUpperCase()), upperB = text(pathB.toUpperCase());
  const warmIO = io;
  assert.strictEqual(e.test_tt_face_open(upperA), a);
  assert.strictEqual(e.test_tt_face_open(upperB), b);
  assert.strictEqual(e.identity_source(pA, 0, -1), a);
  assert.strictEqual(e.identity_source(pB, 0, -1), b);
  assert.strictEqual(io, warmIO, 'case-equivalent and cache-only hits must not read files');

  // A caller-owned path allocation may be reused immediately after open.
  memory.fill(0x78, wa(pA), wa(pA) + pathA.length);
  assert.strictEqual(e.identity_source(upperA, 0, -1), a, 'identity must own its path bytes');
  assert.strictEqual(e.identity_source(upperB, 0, -1), b);
  assert.deepStrictEqual(widths(a), aWidths);
  assert.deepStrictEqual(widths(b), bWidths);

  // Explicit staged input takes the same identity path without filesystem I/O.
  const stagedPath = text('c:\\font-id\\staged.ttf'), staged = alloc(mono);
  const beforeStagedIO = io;
  const stagedFace = e.identity_source(stagedPath, staged, mono.length);
  assert(stagedFace >= 0);
  memory.fill(0xcc, wa(staged), wa(staged) + mono.length); e.guest_free(staged);
  assert.deepStrictEqual(widths(stagedFace), bWidths, 'staged source bytes are owned after publication');
  assert.strictEqual(io, beforeStagedIO);

  const mutationName = 'c:\\font-id\\callback.ttf', mutationPath = text(mutationName);
  const mutationLookup = text(mutationName);
  vfs.files.set(mutationName, { data: sans.slice(), attrs: 0x20 });
  const openFile = vfs.createFile.bind(vfs);
  let mutated = false;
  vfs.createFile = (...args) => {
    if (args[0].toLowerCase() === mutationName) {
      memory.fill(0x7a, wa(mutationPath), wa(mutationPath) + mutationName.length);
      mutated = true;
    }
    return openFile(...args);
  };
  const mutationFace = e.test_tt_face_open(mutationPath);
  assert(mutated && mutationFace >= 0);
  assert.strictEqual(e.identity_source(mutationLookup, 0, -1), mutationFace,
    'identity must be captured before a host filesystem callback can mutate the caller path');

  const maxName = 'c:\\font-id\\' + 'x'.repeat(244) + '.ttf';
  assert.strictEqual(maxName.length, 259);
  const maxPath = text(maxName);
  vfs.files.set(maxName, { data: mono.slice(), attrs: 0x20 });
  assert(e.test_tt_face_open(maxPath) >= 0, '259 path bytes plus terminator are accepted');
  const unterminated = alloc(new Uint8Array(260).fill(0x61));
  const tooLong = text(maxName + 'x');
  const boundsIO = io;
  assert.strictEqual(e.test_tt_face_open(unterminated), -1);
  assert.strictEqual(e.test_tt_face_open(tooLong), -1);
  assert.strictEqual(io, boundsIO, 'overlong/nonterminated paths fail before I/O');

  const badName = 'c:\\font-id\\failed.ttf', badPath = text(badName);
  vfs.files.set(badName, { data: new Uint8Array(128), attrs: 0x20 });
  for (let i = 0; i < 4; i++) assert.strictEqual(e.test_tt_face_open(badPath), -1);
  assert.strictEqual(e.identity_source(badPath, 0, -1), -1, 'failed parse must not publish identity');
  vfs.files.set(badName, { data: mono.slice(), attrs: 0x20 });
  const recovered = e.test_tt_face_open(badPath);
  assert(recovered >= 0, 'failed path remains retryable');
  assert.deepStrictEqual(widths(recovered), bWidths);
  console.log('PASS compiled TTF full-path collision, case identity, cache-only ownership and failed-parse retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
