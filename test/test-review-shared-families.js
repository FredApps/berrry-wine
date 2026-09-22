#!/usr/bin/env node
'use strict';

// Pass-5's named exact-twin families must keep their shared call paths.
// This is a structural regression, not a substitute for their API tests.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WAT_FILES } = require('../lib/wat-manifest');
const { parseWat } = require('../tools/struct-offset-census');

function walk(node, visit) {
  if (!Array.isArray(node)) return;
  visit(node);
  for (const child of node) walk(child, visit);
}
const functions = new Map();
for (const file of WAT_FILES) {
  for (const form of parseWat(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'))) {
    walk(form, node => {
      // Exports also contain (func $name), which is a reference, not a body.
      if (node[0] === 'func' && node.length > 2 &&
          typeof node[1] === 'string' && node[1].startsWith('$')) {
        assert(!functions.has(node[1]), `duplicate definition: ${node[1]}`);
        functions.set(node[1], node);
      }
    });
  }
}

function checkEdge(defs, caller, callee) {
  const body = defs.get(caller);
  assert(body, `missing caller ${caller}`);
  assert(defs.has(callee), `missing shared implementation ${callee}`);
  let calls = 0;
  walk(body, node => {
    if ((node[0] === 'call' || node[0] === 'return_call') && node[1] === callee) calls++;
    assert.notStrictEqual(node[0], 'loop', `${caller}: adapter has grown its own loop`);
  });
  assert.strictEqual(calls, 1, `${caller} must call ${callee} exactly once`);
}

const edges = [
  ...['A', 'W'].map(s => [`PlaySound${s}`, 'sound_play_dispatch']),
  ...['A', 'W'].map(s => [`ImageList_LoadImage${s}`, 'image_list_load_image']),
  ['mixerGetControlDetailsA', 'mixer_get_control_details_entry'],
  ['mixerGetControlDetailsW', 'handle_mixerGetControlDetailsA'],
  ['_mbsnbcmp', 'crt_compare_bytes'], ['memcmp', 'crt_compare_bytes'],
  ['GetLocalTime', 'host_wall_clock'], ['GetSystemTime', 'host_wall_clock'],
  ['_hread', 'handle__lread'], ['mmioRead', 'handle__hread'],
  ...['', '2', '3'].flatMap(v => ['Light', 'Viewport'].map(kind =>
    [`IDirect3D${v}_Create${kind}`, 'd3dim_create_child'])),
  ['IDirect3DDevice_AddViewport', 'handle_IDirect3DDevice2_AddViewport'],
  ['IDirect3DDevice2_AddViewport', 'handle_IDirect3DDevice3_AddViewport'],
  ['IDirect3DDevice7_ComputeSphereVisibility', 'handle_IDirect3DDevice3_ComputeSphereVisibility'],
];
for (const [caller, callee] of edges) checkEdge(functions, `$handle_${caller}`, `$${callee}`);

// Negative controls: comments cannot satisfy the check, and neither can a
// nonexistent target, two calls, or a private implementation loop.
const fixture = text => new Map(parseWat(text).map(node => [node[1], node]));
for (const body of [
  ';; (call $core)\n',
  '(call $other)',
  '(call $core) (call $core)',
  '(call $core) (loop $private (br $private))',
]) {
  assert.throws(() => checkEdge(fixture(`(func $adapter ${body}) (func $core)`),
    '$adapter', '$core'), assert.AssertionError);
}
assert.throws(() => checkEdge(fixture('(func $adapter (call $core))'),
  '$adapter', '$core'), /missing shared implementation/);
console.log(`PASS nine review families: ${edges.length} shared edges and five negative controls`);
