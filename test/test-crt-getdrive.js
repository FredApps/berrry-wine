#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const STACK = 0x00300000;

const extraWat = String.raw`
  (func (export "test_getdrive") (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (call $handle__getdrive
      (i32.const 0) (i32.const 0) (i32.const 0)
      (i32.const 0) (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

(async () => {
  const { exports: e, hostCtx } = await bootRenderHarness({ extraWat, fonts: 'none' });
  e.init_thread(1, 0x00400000, 0, 0, 0, 0, 0);
  e.heap_init(0x00420000);

  assert.strictEqual(e.test_getdrive(), 3, 'the default C: current directory reports drive 3');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 4, '_getdrive is cdecl');

  hostCtx.vfs.dirs.add('d:');
  assert.strictEqual(hostCtx.vfs.setCurrentDirectory('D:\\'), true);
  assert.strictEqual(e.test_getdrive(), 4, 'changing the VFS current drive is visible to MSVCRT');

  hostCtx.vfs.dirs.add('z:\\games');
  assert.strictEqual(hostCtx.vfs.setCurrentDirectory('Z:\\games'), true);
  assert.strictEqual(e.test_getdrive(), 26, 'drive-letter mapping spans through Z:');
  assert.strictEqual(e.get_esp() >>> 0, STACK + 4, 'repeated calls retain cdecl cleanup');

  console.log('PASS  _getdrive follows the browser process current directory');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
