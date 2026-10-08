'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { checkSize, MAX_BYTES } = require('./check-claude-size');

test('repository entry point stays within the byte limit', () => {
  assert.ok(checkSize() <= MAX_BYTES);
});

test('gate accepts the exact boundary and rejects one UTF-8 byte over it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-size-'));
  const fixture = path.join(dir, 'CLAUDE.md');
  try {
    fs.writeFileSync(fixture, 'é'.repeat(MAX_BYTES / 2));
    assert.equal(checkSize(fixture), MAX_BYTES);
    fs.appendFileSync(fixture, 'x');
    const result = spawnSync(process.execPath, [path.join(__dirname, 'check-claude-size.js'), fixture], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /32769 bytes.*add details to docs\//);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
