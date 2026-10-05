#!/usr/bin/env node
'use strict';
// Exercise the shipped page's actual ordering, without a DOM or GPU. A manual
// browser fixture can accidentally hide a missing dependency by injecting it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/"(lib\/(?:gpu-backend|d3d[^"/]+)\.js)"/g)].map(m => m[1]);
assert(scripts.includes('lib/d3d-command-stream.js'), 'page must load neutral queue');
assert(scripts.includes('lib/d3d-geometry-batches.js'), 'page must load geometry packing');
assert(scripts.indexOf('lib/d3d-geometry-batches.js') < scripts.indexOf('lib/d3d9-software-backend.js'),
  'geometry packing must exist when software factory evaluates');
assert(scripts.indexOf('lib/d3d-command-stream.js') < scripts.indexOf('lib/d3d9-host.js'),
  'queue must exist when bridge factory evaluates');
const context = vm.createContext({ console, performance });
for (const file of scripts) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename:file });
vm.runInContext(`
  const bridge = new D3D9Host.Bridge({});
  let finishes = 0;
  const entry = { device: { gpu: {
    gl: { isContextLost: () => false }, finish() { finishes++; }
  } } };
  entry.queue = new D3DCommandStream.CommandQueue({ deviceId:7,
    consumer: { execute: command => bridge._execute(entry, command) } });
  bridge.devices.set(7, entry);
  if (bridge.call(0x30006, 0, 7) !== 1 || finishes !== 1)
    throw new Error('shipped bridge cannot execute its queue dependency');
`, context);
console.log('PASS shipped browser D3D dependency order and queued EVENT');
