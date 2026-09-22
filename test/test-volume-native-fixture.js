#!/usr/bin/env node
'use strict';
// Captured-oracle integrity only; this does not execute emulator APIs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fixture = path.join(__dirname, 'fixtures/win98-volume-buffers/serial.txt');
const capacities = [0, 1, 2, 3, 4, 5, 8, 16, 64];
const sentinel = 0xcccccccc;
function parseNativeVolume(text) {
  const lines = text.trim().split(/\r?\n/);
  const start = /^VOLUME_BUFFERS_BEGIN version=(\d+)$/.exec(lines.shift());
  assert(start && (Number(start[1]) & 0xffff) === 0x0a04, 'native Win98 version 4.10');
  assert.strictEqual(lines.pop(), 'VOLUME_BUFFERS_END', 'probe must finish');
  const rows = [], keys = new Set();
  for (const line of lines) {
    const match = /^VOL drive=(\d+) wide=(\d+) which=(\d+) cap=(\d+) nulls=(\d+) result=(\d+) error=(\d+) serial=(\d+) max=(\d+) flags=(\d+) label=([0-9a-f]{64}) fs=([0-9a-f]{64})$/.exec(line);
    assert(match, `unexpected observation: ${line}`);
    const row = {};
    ['drive','wide','which','cap','nulls','result','error','serial','max','flags'].forEach((key, i) => {
      row[key] = Number(match[i + 1]);
      assert(Number.isInteger(row[key]) && row[key] <= 0xffffffff);
    });
    row.label = match[11]; row.fs = match[12];
    const key = [row.drive,row.wide,row.which,row.cap,row.nulls].join(':');
    assert(!keys.has(key), `duplicate ${key}`); keys.add(key); rows.push(row);
  }
  const expected = new Set();
  for (const drive of [0,1]) for (const wide of [0,1]) {
    for (const which of [0,1]) {
      for (const cap of capacities) expected.add([drive,wide,which,cap,0].join(':'));
      expected.add([drive,wide,which,0,which ? 2 : 1].join(':'));
    }
    expected.add([drive,wide,0,0,3].join(':'));
  }
  assert.deepStrictEqual([...keys].sort(), [...expected].sort(), 'complete 84-case matrix');
  return rows;
}
function checkFixture(text) {
  const rows = parseNativeVolume(text);
  const untouched = 'cc'.repeat(32);
  const output = value => {const b = Buffer.alloc(32, 0xcc); b.write(value + '\0', 'ascii'); return b.toString('hex');};
  for (const row of rows) {
    if (row.wide) {
      assert.deepStrictEqual([row.result,row.error,row.serial,row.max,row.flags,row.label,row.fs],
        [0,120,sentinel,sentinel,sentinel,untouched,untouched]);
      continue;
    }
    const label = row.drive ? 'REFERENCE' : '', filesystem = row.drive ? 'CDFS' : 'FAT';
    const labelCap = row.which === 0 ? row.cap : 64, fsCap = row.which === 1 ? row.cap : 64;
    const hasLabel = !(row.nulls & 1), hasFs = !(row.nulls & 2);
    const badFs = hasFs && fsCap <= filesystem.length;
    const badLabel = hasLabel && labelCap <= label.length;
    assert.strictEqual(row.result, badFs || badLabel ? 0 : 1);
    assert.strictEqual(row.error, badFs || badLabel ? 111 : !row.drive && hasLabel ? 2 : 4660);
    assert.strictEqual(row.max, row.drive ? 221 : 255);
    assert.strictEqual(row.flags, row.drive ? 16384 : 16390);
    assert.notStrictEqual(row.serial, sentinel);
    assert.strictEqual(row.fs, hasFs && !badFs ? output(filesystem) : untouched);
    assert.strictEqual(row.label, hasLabel && !badFs && !badLabel ? output(label) : untouched);
  }
  for (const drive of [0,1]) assert.strictEqual(new Set(rows.filter(r => r.drive === drive && !r.wide).map(r => r.serial)).size, 1);
  return rows;
}
if (require.main === module) {
  const text = fs.readFileSync(fixture, 'utf8');
  const first = checkFixture(text);
  const repeat = checkFixture(fs.readFileSync(path.join(path.dirname(fixture), 'repeat-serial.txt'), 'utf8'));
  assert.deepStrictEqual(first.map(({serial,...row}) => row), repeat.map(({serial,...row}) => row));
  assert.deepStrictEqual(first.filter(r => !r.drive).map(r => r.serial), repeat.filter(r => !r.drive).map(r => r.serial));
  assert.throws(() => checkFixture(text.replace('VOLUME_BUFFERS_END', '')));
  assert.throws(() => checkFixture(text.replace(/VOL[^\n]+\n/, '')));
  assert.throws(() => checkFixture(text.replace('VOLUME_BUFFERS_END', text.split('\n')[1] + '\nVOLUME_BUFFERS_END')));
  assert.throws(() => checkFixture(text.replace('error=111', 'error=0')));
  assert.throws(() => checkFixture(text.replace('label=cc', 'label=00')));
  console.log('PASS 84 native Win98 volume-buffer observations and five negative controls (fixture integrity only)');
}
module.exports = { fixture, parseNativeVolume, checkFixture };
