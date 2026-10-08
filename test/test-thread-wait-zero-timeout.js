#!/usr/bin/env node
'use strict';
const assert = require('assert');
function check(ThreadManager) {
  const memory = {buffer: new SharedArrayBuffer(65536)};
  const main = {exports:{get_sync_table:()=>0,get_heap_ptr:()=>0,set_heap_ptr:()=>{}}};
  const tm = new ThreadManager({}, memory, main, ()=>({host:{}}));
  tm._log=()=>{};
  const pending=tm.createThread(0x6100,0,0,4);
  assert.strictEqual(tm.waitSingle(pending,0),0x102,'pending zero-timeout poll must return WAIT_TIMEOUT');
  assert.strictEqual(tm.waitSingle(pending,0xffffffff),0xffff,'pending infinite wait remains blocking');
  const thread=tm._pendingThreads.shift();
  thread.state='active';tm.threads.set(pending,thread);
  assert.strictEqual(tm.waitSingle(pending,0),0x102,'live zero-timeout poll must return WAIT_TIMEOUT');
  assert.strictEqual(tm.waitSingleCooperative(pending,0),0x102,'cooperative zero poll must not pump or yield');
  assert.strictEqual(tm.waitSingle(pending,0xffffffff),0xffff,'live infinite wait remains blocking');
  assert.strictEqual(tm.waitSingle(pending,17),0xffff,'positive timeout remains scheduler-managed');
  thread.state='exited';
  assert.strictEqual(tm.waitSingle(pending,0),0,'exited zero poll is signaled');
  assert.strictEqual(tm.waitSingle(pending,0xffffffff),0,'exited infinite wait is signaled');
  console.log('PASS 8 actual ThreadManager thread-wait timeout contracts');
}
module.exports={check};
if(require.main===module)check(require('../lib/thread-manager').ThreadManager);
