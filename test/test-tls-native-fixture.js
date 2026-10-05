#!/usr/bin/env node
'use strict';

// Fixture integrity only. This is deliberately not an emulator conformance
// test: the current runtime does not yet implement these native observations.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fixture = path.join(__dirname, 'fixtures/win98-tls-lifetime/serial.txt');

function parseNativeTls(text) {
  const lines = text.trim().split(/\r?\n/);
  assert.strictEqual(lines.shift(), 'TLS_LIFETIME_BEGIN');
  assert.strictEqual(lines.pop(), 'TLS_LIFETIME_DONE', 'native probe must finish');
  const allocations = [], rows = new Map();
  for (const line of lines) {
    const match = /^TLS label=([a-z0-9-]+) result=(\d+) error=(\d+)$/.exec(line);
    assert(match, `unexpected native output: ${line}`);
    const row = { result: Number(match[2]), error: Number(match[3]) };
    for (const value of Object.values(row)) assert(Number.isInteger(value) && value <= 0xffffffff);
    if (match[1] === 'allocate') allocations.push(row);
    else {
      assert(!rows.has(match[1]), `duplicate observation ${match[1]}`);
      rows.set(match[1], row);
    }
  }
  assert.strictEqual(allocations.length, rows.get('capacity')?.result);
  assert.strictEqual(new Set(allocations.map(row => row.result)).size, allocations.length);
  assert.strictEqual(rows.get('exhausted')?.result, 0xffffffff);
  return { allocations, rows };
}

function checkFixture(text) {
  const { allocations, rows } = parseNativeTls(text);
  assert.strictEqual(rows.get('version').result & 0xffff, 0x0a04, 'native OS reports version 4.10');
  assert.deepStrictEqual(allocations, Array.from({ length: 80 }, (_, result) => ({ result, error: 4660 })));
  const expected = {
    exhausted: [0xffffffff, 259], capacity: [80, 0], chosen: [40, 0],
    'initial-main': [0, 0], 'set-main-status': [1, 4660],
    'set-main': [0x11223344, 0], 'set-worker': [0x55667788, 0],
    free: [1, 4660], 'freed-main': [0, 0], 'freed-worker': [0, 0],
    'free-again': [0, 87], 'reuse-main': [40, 4660],
    'reused-main': [0, 0], 'reused-worker': [0, 0],
    'free-for-worker': [1, 4660], 'reuse-by-worker': [40, 4660],
    'worker-reused-main': [0, 0], 'worker-reused-worker': [0, 0],
    'set-index-64': [1, 4660], 'get-index-64': [0xabcdef01, 0],
    'set-index-79': [1, 4660], 'get-index-79': [0x12345678, 0],
    'set-index-80': [0, 87], 'get-index-80': [0, 87],
    'get-index-81': [0, 87], 'invalid-get-max': [0, 87],
    'free-index-64': [1, 4660], 'freed-index-64': [0, 0],
    'free-index-80': [0, 87], 'invalid-free-max': [0, 87],
  };
  assert.strictEqual(rows.size, Object.keys(expected).length + 1);
  for (const [label, [result, error]] of Object.entries(expected)) {
    assert.deepStrictEqual(rows.get(label), { result, error }, label);
  }
}

if (require.main === module) {
  const text = fs.readFileSync(fixture, 'utf8');
  checkFixture(text);
  assert.throws(() => checkFixture(text.replace('TLS_LIFETIME_DONE', '')));
  assert.throws(() => checkFixture(text.replace('label=freed-worker result=0', 'label=freed-worker result=1')));
  assert.throws(() => checkFixture(text.replace('TLS label=allocate result=79 error=4660\n', '')));
  assert.throws(() => checkFixture(text.replace('TLS_LIFETIME_DONE', 'TLS label=free result=1 error=4660\nTLS_LIFETIME_DONE')));
  console.log('PASS native Win98 TLS fixture integrity and four negative controls (not emulator conformance)');
}

module.exports = { parseNativeTls, fixture };
