#!/usr/bin/env node
'use strict';
// Oracle integrity, not an emulator conformance test.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const dir = path.join(__dirname, 'fixtures/win98-clipper-interfaces');
function verify(text) {
  const lines = text.trim().split(/\r?\n/);
  assert.strictEqual(lines.shift(), 'CLIPPER_INTERFACES_BEGIN version=c0000a04');
  assert.strictEqual(lines.pop(), 'CLIPPER_INTERFACES_END');
  assert.strictEqual(lines.shift(), 'TYPELIB hr=00000000');
  assert.strictEqual(lines.shift(), 'TYPE name=DirectDrawClipper iid=9f76fdca:11d18e92:c0000888:02c6c24f kind=00000003 flags=00000000 vtable=0000002c funcs=00000008');
  const methods = [
    ['InternalSetObject', 1], ['InternalGetObject', 1], ['GetClipListSize', 1],
    ['GetClipList', 1], ['SetClipList', 2], ['GetHWnd', 1], ['SetHWnd', 1],
    ['IsClipListChanged', 1],
  ];
  const hex = n => n.toString(16).padStart(8, '0');
  methods.forEach(([name, args], i) => assert.strictEqual(lines.shift(),
    `METHOD name=${name} offset=${hex((i + 3) * 4)} params=${hex(args)}`));
  assert.strictEqual(lines.shift(), 'TAIL return=00000019 param=0000001a flags=0000000a pointee=00000016');
  assert.deepStrictEqual(lines, [
    'CREATE hr=00000000',
    'QI name=IUnknown hr=00000000 null=00000000 same=00000001 release=00000001',
    'QI name=native hr=00000000 null=00000000 same=00000001 release=00000001',
    'QI name=forged-tail hr=80004002 null=00000001 same=00000000',
    'QI name=VB hr=80004002 null=00000001 same=00000000',
    'FINAL release=00000000',
    'VBFACTORY hr=00000000',
    'VBROOT hr=00000000',
    'VBDRAW hr=80004005',
  ]);
}
const first = fs.readFileSync(path.join(dir, 'serial.txt'), 'utf8');
const repeat = fs.readFileSync(path.join(dir, 'repeat-serial.txt'), 'utf8');
verify(first); verify(repeat);
assert.strictEqual(first, repeat, 'fresh VM runs agree exactly');
const captures = ['capture.json', 'repeat-capture.json'].map(file =>
  JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceHash = hash(path.join(root, 'tools/v86-reference/probes/clipper-interfaces.c'));
for (const capture of captures) {
  assert.strictEqual(capture.probeSourceSha256, sourceHash, 'oracle source has not drifted');
  assert.deepStrictEqual(capture.payload.map(p => p.name), ['CLIPREF.EXE', 'DX7VB.DLL']);
  for (const payload of capture.payload) {
    assert.match(payload.sha256, /^[0-9a-f]{64}$/);
    // Executables are not distributed with the fixture; validate if locally present.
    const local = path.join(root, payload.source);
    if (fs.existsSync(local)) assert.strictEqual(hash(local), payload.sha256);
  }
}
assert.deepStrictEqual(captures[0].payload, captures[1].payload);
for (const corrupted of [
  first.replace('CLIPPER_INTERFACES_END', ''),
  first.replace('vtable=0000002c', 'vtable=00000028'),
  first.replace('release=00000001', 'release=00000000'),
  first.replace('hr=80004002', 'hr=00000000'),
  first.replace('VBDRAW hr=80004005', 'VBDRAW hr=00000000'),
  first.replace('pointee=00000016', 'pointee=0000000b'),
]) assert.throws(() => verify(corrupted));
console.log('PASS native clipper fixture: repeated IID/refcount/ABI observations; six negative controls');
