'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {inspect, localize} = require('./check-run-evidence');

test('external files, shared names and symlinks become verified local evidence without deleting sources', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-evidence-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const dir = path.join(root, 'scratch/runs/one');
  fs.mkdirSync(dir, {recursive: true});
  fs.mkdirSync(path.join(root, 'scratch/work'));
  fs.writeFileSync(path.join(root, 'scratch/work/image.png'), 'outside');
  fs.writeFileSync(path.join(dir, 'image.png'), 'inside');
  fs.symlinkSync('../../work/image.png', path.join(dir, 'linked.png'));
  const original = {screenshot: 'image.png', screenshots: ['../../work/image.png', 'linked.png'],
    artifacts: {log: 'scratch/work/image.png', logSha256: 'not-a-path'}, command: '/old/work/actual-command'};
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(original));
  assert.equal(inspect(root).errors.length, 3);
  const report = localize(root);
  assert.equal(report.changes.length, 3);
  assert.deepEqual(inspect(root).errors, []);
  assert.equal(fs.readFileSync(path.join(root, 'scratch/work/image.png'), 'utf8'), 'outside');
  assert.ok(fs.lstatSync(path.join(dir, 'linked.png')).isSymbolicLink());
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'result.json'))).command, original.command);
  assert.equal(localize(root).changes.length, 0);
});

test('missing escaping paths still fail; absolute and sibling references fail', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-evidence-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const dir = path.join(root, 'scratch/runs/one');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'local.txt'), 'ok');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({artifacts: ['../two/no.log', path.join(dir, 'local.txt'), 'missing.txt']}));
  assert.equal(inspect(root).errors.length, 2);
  assert.equal(localize(root).missing.length, 1);
  assert.equal(inspect(root).errors.length, 1);
  assert.equal(inspect(root).missing.length, 1);
  fs.symlinkSync('../../gone', path.join(dir, 'escape'));
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({artifacts: ['escape/missing.log']}));
  assert.equal(inspect(root).errors.length, 1);
});
