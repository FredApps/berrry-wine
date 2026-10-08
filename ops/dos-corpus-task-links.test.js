'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildDosCorpus } = require('./dos-corpus');

test('DOS task links require a real candidate ID or explicit catalog task link', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dos-task-links-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'test/toyvm-dos-corpus'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test/toyvm-dos-corpus/manifest.json'), JSON.stringify({
    titles: [{ id: 'uncatalogued', candidateId: null }, { id: 'catalogued', candidateId: 'real-title' }],
  }));
  const result = await buildDosCorpus({ root,
    candidates: [{ id: 'real-title', taskIds: ['explicit-task'] }],
    tasks: [
      { id: 'null-task', candidateIds: [null] },
      { id: 'other-task', candidateIds: ['other-title'] },
      { id: 'matched-task', candidateIds: ['real-title'] },
      { id: 'explicit-task', candidateIds: [] },
    ],
  });
  assert.deepEqual(result.rows[0].tasks, [], 'null is not a candidate identity');
  assert.deepEqual(result.rows[1].tasks.map(x => x.id), ['matched-task', 'explicit-task']);
});
