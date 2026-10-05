'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
// Execute the actual CLI guard and callback; no copied logic.
//
// --quiet-api no longer fast-paths inside h.log: the guard (apiLogOff) tells
// every WASM instance to skip the per-call log/log_i32/log_api_exit host
// calls altogether (09b-dispatch $api_log_on), and the total comes back from
// the instance's own $api_calls. --quiet-api-fast is an alias. What h.log
// still receives are the non-API log lines, which it decodes as before.
const source = fs.readFileSync('test/run.js', 'utf8');
const body = source.slice(source.indexOf('  // --- Override logging ---'), source.indexOf('  h.log_i32 = val =>'));
assert(body.includes('apiLogOff ='), 'run.js guard not found between the markers');
function context(overrides = {}) {
  const c = { h: {}, hasFlag: () => true, QUIET_API: true, TRACE_API: false,
    TRACE_API_COUNTS: false, TRACE_CRITICAL: false, TRACE_INPUT_DISPATCH: false,
    ESP_DELTA: false, ESP_AUDIT: false, breakApis: [], apiCount: 0, pendingComApiId: -1,
    apiLogOff: undefined, memory: { get buffer() { throw new Error('name read'); } }, ...overrides };
  vm.createContext(c); vm.runInContext(body, c); return c;
}
assert.strictEqual(context().apiLogOff, true, 'quiet run with no API consumer turns the WAT log off');
for (const flag of ['TRACE_API', 'TRACE_API_COUNTS', 'TRACE_CRITICAL', 'TRACE_INPUT_DISPATCH', 'ESP_DELTA', 'ESP_AUDIT'])
  assert.strictEqual(context({ [flag]: true }).apiLogOff, false, flag);
assert.strictEqual(context({ QUIET_API: false }).apiLogOff, false, 'not quiet');
assert.strictEqual(context({ breakApis: ['PeekMessageA'] }).apiLogOff, false, '--break-api');
const b = Buffer.from('PeekMessageA\0'), logs = [];
const slow = context({ hasFlag: () => false, QUIET_API: false,
  memory: { buffer: b.buffer }, apiCounts: null, logs });
slow.h.log(b.byteOffset, b.length);
assert.strictEqual(slow.apiCount, 1); assert.deepStrictEqual(logs, ['[API] PeekMessageA']);
console.log('PASS quiet API guard, every diagnostic keeps the log on, ordinary logging');
