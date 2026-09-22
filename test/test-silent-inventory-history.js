#!/usr/bin/env node
'use strict';

// Pass-5 carried cleanup: history belongs in docs, not executable gate code.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const gate = fs.readFileSync(path.join(root, 'tools/check-silent-stubs.js'), 'utf8');
const history = fs.readFileSync(path.join(root, 'docs/silent-handler-inventory.md'), 'utf8');

function assertHistoryOutsideGate(source) {
  assert.doesNotMatch(source, /^\s*\/\/\s*\d{4}-\d{2}-\d{2}\b/m,
    'append dated inventory explanations to docs/silent-handler-inventory.md');
}
assertHistoryOutsideGate(gate);
assert.throws(() => assertHistoryOutsideGate(`${gate}\n// 2026-09-22: inventory change\n`),
  assert.AssertionError, 'the historical regression must be rejected');
assert.match(gate, /docs\/silent-handler-inventory\.md/);
assert.match(gate, /const EXPECTED_COUNT = \d+;/);
assert.match(gate, /const EXPECTED_SHA256 = '[a-f0-9]{64}';/);
assert.match(history, /2026-08-31: 506 -> 505/);
assert.match(history, /2026-09-20: 266 -> 266, text only/);
console.log('PASS silent-handler history stays in docs; executable pin stays in the gate');
