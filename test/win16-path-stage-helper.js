'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const VfsSeed = require('../lib/vfs-seed');

function stageReceiver(exports, memory, vfs, modules = null) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8');
  const method = source.match(/  _stageWin16Module\(name, id\) \{[\s\S]*?\n  \}/);
  if (!method) throw new Error('actual host stage method missing');
  const receiver = vm.runInNewContext(`({${method[0]}})`, { Uint8Array, VfsSeed });
  return Object.assign(receiver, { instance: { exports }, memory, _helpCtx: { vfs }, _win16Modules: modules });
}

function resourceDll(marker = 0xA7) {
  const dataOffset = 0x800, dataSize = 0x21000;
  const bytes = new Uint8Array(dataOffset + dataSize);
  const dv = new DataView(bytes.buffer);
  const w = (p, n) => dv.setUint16(p, n, true);
  w(0, 0x5A4D); dv.setUint32(0x3C, 0x40, true);
  const ne = 0x40, st = ne + 0x40, rt = ne + 0x50;
  w(ne, 0x454E); w(ne + 0x0C, 0x8001); w(ne + 0x0E, 2);
  w(ne + 0x1C, 2); w(ne + 0x22, 0x40); w(ne + 0x24, 0x50);
  w(ne + 0x26, 0x68); w(ne + 0x32, 4);
  w(st, 0x10); w(st + 2, 0x10); w(st + 6, 0x100);
  w(st + 8, 0); w(st + 10, 0); w(st + 12, 1); w(st + 14, 0x80);
  bytes.fill(0x90, 0x100, 0x110);
  w(rt, 4); w(rt + 2, 0x8002); w(rt + 4, 1);
  w(rt + 10, dataOffset >>> 4); w(rt + 12, dataSize >>> 4);
  w(rt + 16, 0x80A4);
  for (let i = 0; i < dataSize; i++) bytes[dataOffset + i] = (marker + i * 37) & 255;
  return { bytes, dataOffset, dataSize, data: bytes.subarray(dataOffset) };
}
module.exports = { stageReceiver, resourceDll };
