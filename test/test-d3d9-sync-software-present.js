#!/usr/bin/env node
'use strict';
// The in-thread D3D9 software device -- what a page that is not cross-origin
// isolated gets, because the render Worker cannot be handed shared memory
// there -- finishes each frame before Present returns. A Present issued from
// inside a synchronous SendMessage must therefore publish that frame, not go
// down the Worker's detach path, which treats the frame as a promise: Pawn 3
// presents its first frame from the WM_SIZE that SetWindowPos sends, and on
// ?d3d9-renderer=software without isolation that threw "completed.then is not
// a function" and left the client area grey.
const assert = require('assert');
const path = require('path');
const {OPCODES: OP} = require('../lib/d3d-command-stream');

// A software backend that finishes each command as it is handed over.
const presented = [];
const softwarePath = path.join(__dirname, '../lib/d3d9-software-backend.js');
require.cache[softwarePath] = {id: softwarePath, filename: softwarePath, loaded: true, exports: {
  Device: class {
    execute(command) {
      if (command.opcode !== OP.PRESENT) return {value: 1, complete: true};
      presented.push(command);
      return {value: {pixels: new Uint8Array(16).fill(presented.length)}, complete: true};
    }
  },
}};
const {Bridge} = require('../lib/d3d9-host');

const memory = new ArrayBuffer(65536), v = new DataView(memory);
const desc = 64, program = 1024, vertices = 30000, target = 32000;
const set = (p, n) => v.setUint32(p, n, true);
[7, program, target, 2, 2, 1, 4, 1, vertices, 16].forEach((n, i) => set(desc + i * 4, n));
set(program + 12, 0x42); v.setFloat32(program + 1696, 1, true);
set(program + 21784, 0x80000000);
set(desc + 44, 1);  // Clear: target only, no rects

let depth = 0;
const bridge = new Bridge({backend: 'software', getMemory: () => memory, guestToWasm: p => p,
  getExports: () => ({get_sync_msg_depth: () => depth})});
assert.strictEqual(bridge.asyncSoftware, false, 'no worker factory: the device runs in-thread');
assert.strictEqual(bridge.call(0x30003, desc, 0), 1, 'Clear creates the device and completes at once');
const dest = () => Array.from(new Uint8Array(memory, target, 16));

// Top level: the frame is published before Present returns.
assert.strictEqual(bridge.call(0x30002, desc, 0), 0, 'top-level Present');
assert.deepStrictEqual(dest(), new Array(16).fill(1), 'top-level frame published');

// Inside a synchronous SendMessage: still published, still no token to park on.
depth = 1;
const nested = bridge.call(0x30002, desc, 0);
assert.strictEqual(nested, 0, `nested Present returns 0, not an error or a token (lastError ${bridge.lastError})`);
assert.deepStrictEqual(dest(), new Array(16).fill(2), 'nested frame published at once');
assert.strictEqual(presented.length, 2);
console.log('PASS d3d9 in-thread software Present, top level and inside SendMessage');
