'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
// Execute the actual CLI callback and its guard; no copied fast-path logic.
const source = fs.readFileSync('test/run.js', 'utf8');
const body = source.slice(source.indexOf('  const fastQuietApi ='), source.indexOf('  h.log_i32 = val =>'));
function context(overrides = {}) {
  const c = { h: {}, hasFlag: () => true, QUIET_API: true, TRACE_API: false,
    TRACE_API_COUNTS: false, TRACE_CRITICAL: false, TRACE_INPUT_DISPATCH: false,
    ESP_DELTA: false, breakApis: [], apiCount: 0, pendingComApiId: 123,
    memory: { get buffer() { throw new Error('name read'); } }, ...overrides };
  vm.createContext(c); vm.runInContext(body, c); return c;
}
const fast = context(); fast.h.log(0, 10);
assert.strictEqual(fast.apiCount, 1); assert.strictEqual(fast.pendingComApiId, -1);
for (const flag of ['TRACE_API','TRACE_API_COUNTS','TRACE_CRITICAL','TRACE_INPUT_DISPATCH','ESP_DELTA']) {
  const c = context({ [flag]: true }); assert.throws(() => c.h.log(0,10), /name read/, flag);
}
for (const opts of [{ QUIET_API: false }, { breakApis: ['PeekMessageA'] }, { hasFlag: () => false }])
  assert.throws(() => context(opts).h.log(0,10), /name read/);
const b = Buffer.from('PeekMessageA\0'), logs = [];
const slow = context({ hasFlag: () => false, QUIET_API: false,
  memory: { buffer: b.buffer }, apiCounts: null, logs });
slow.h.log(b.byteOffset, b.length);
assert.strictEqual(slow.apiCount, 1); assert.deepStrictEqual(logs, ['[API] PeekMessageA']);
console.log('PASS quiet API totals, COM marker reset, all diagnostic guards, ordinary logging');
