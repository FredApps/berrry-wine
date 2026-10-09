'use strict';
// Pure-JS observer contract, no emulator/guest execution.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { expression } = require('./worker-command-trace');

let eip = 0x401000, reads = 0;
const sent = [], result = Promise.resolve(17);
const post = function (...args) {
  assert.equal(this, context.self);
  sent.push(args);
  return 42;
};
const original = function (event) {
  assert.equal(this, context.self);
  eip++;
  if (event.data.t === 'throw') throw Error('original error');
  if (event.data.t === 'slice') {
    eip = 0x74ffd8c;
    context.self.postMessage(event.data.reply, event.data.transfer);
  }
  return result;
};
const context = {
  self: { onmessage: original, postMessage: post },
  performance: { timeOrigin: 1000, now: () => 3 },
  instance: { exports: {
    get_eip: () => eip, get_esp: () => 0x74ffc08, get_yield_reason: () => 0,
    guest_read8: addr => { reads++; return addr & 255; },
  } },
  threadSendFrames: [],
};
vm.createContext(context);
vm.runInContext(expression(8), context);
const transfer = [], reply = { t: 'sliceDone', seq: 7, trapped: 'unreachable' };
assert.equal(context.self.onmessage({ data: { t: 'slice', seq: 7, reply, transfer } }), result);
assert.equal(sent[0][0], reply);
assert.equal(sent[0][1], transfer);
const trace = context.self.__wineCommandTrace;
const frozen = JSON.stringify(trace.read().firstTrap);
assert.equal(trace.read().firstTrap.events[0].eip, 0x401000);
assert.equal(trace.read().firstTrap.events[1].phase, 'trapped-reply');
assert.equal(trace.read().firstTrap.memory.eip, 0x74ffd8c);
assert.equal(trace.read().firstTrap.memory.stack.length, 256);
assert.equal(reads, 384);
for (let i = 0; i < 4000; i++) context.self.onmessage({ data: { t: 'callExport', seq: i } });
assert.equal(trace.read().events.length, 8);
assert.ok(trace.read().overwritten > 7900);
context.self.postMessage({ trapped: 'later failure' });
assert.equal(JSON.stringify(trace.read().firstTrap), frozen);
assert.equal(reads, 384, 'later polling/failures must not recapture memory');
assert.throws(() => context.self.onmessage({ data: { t: 'throw' } }), /original error/);
assert.equal(trace.read().events.at(-1).phase, 'sync-return');
assert.equal(trace.read().observerErrors, 0);
trace.stop();
assert.equal(context.self.onmessage, original);
assert.equal(context.self.postMessage, post);
assert.throws(() => expression(1), /capacity/);
assert.throws(() => vm.runInNewContext(expression(), { self: {} }), /initialized/);
console.log('PASS: first trapped reply survives 4000 later commands; forwarding, bounded memory and uninstall preserved (pure JS only)');
