#!/usr/bin/env node

'use strict';

const assert = require('assert');
const apiTable = require('../src/api_table.json');
const { bootRenderHarness } = require('./render-helper');

const extraWat = String.raw`
  (func (export "test_create_memory_metafile")
        (param $wide i32) (param $stack i32) (result i64)
    (i32.store offset=16 (global.get $reg_base) (local.get $stack))
    (if (local.get $wide)
      (then
        (call $handle_CreateMetaFileW
          (i32.const 0) (i32.const 0) (i32.const 0)
          (i32.const 0) (i32.const 0) (i32.const 0)))
      (else
        (call $handle_CreateMetaFileA
          (i32.const 0) (i32.const 0) (i32.const 0)
          (i32.const 0) (i32.const 0) (i32.const 0))))
    (i64.or
      (i64.extend_i32_u (i32.load offset=0 (global.get $reg_base)))
      (i64.shl (i64.extend_i32_u (i32.load offset=16 (global.get $reg_base))) (i64.const 32))))
`;

(async () => {
  for (const name of ['CreateMetaFileA', 'CreateMetaFileW']) {
    const api = apiTable.find(entry => entry.name === name);
    assert(api, `${name} is exported`);
    assert.strictEqual(api.nargs, 1, `${name} accepts one file-name pointer`);
    assert.strictEqual(api.convention, 'stdcall', `${name} uses stdcall`);
  }

  const { exports: wat } = await bootRenderHarness({ extraWat, fonts: 'none' });
  const stack = 0x074ff000;
  const recordingDcs = [];
  for (const [wide, suffix] of [[0, 'A'], [1, 'W']]) {
    const packed = wat.test_create_memory_metafile(wide, stack);
    const recording = Number(packed & 0xffffffffn) >>> 0;
    const resultingEsp = Number(packed >> 32n) >>> 0;
    assert(recording, `CreateMetaFile${suffix}(NULL) creates a memory recording DC`);
    assert.strictEqual(resultingEsp, stack + 8,
      `CreateMetaFile${suffix} pops its argument and return address`);
    recordingDcs.push(recording);
  }
  assert.notStrictEqual(recordingDcs[0], recordingDcs[1],
    'A and W calls create independent recording DCs');

  for (const recording of recordingDcs) {
    const metafile = wat.test_call_CloseMetaFile(recording) >>> 0;
    assert(metafile, 'CloseMetaFile serializes the memory recording');
    assert.strictEqual(wat.test_call_DeleteMetaFile(metafile), 1,
      'DeleteMetaFile releases the serialized memory metafile');
    assert.strictEqual(wat.test_call_DeleteMetaFile(metafile), 0,
      'the serialized metafile handle is dead after deletion');
  }

  console.log('PASS  CreateMetaFileA/W share documented memory-metafile behavior');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
