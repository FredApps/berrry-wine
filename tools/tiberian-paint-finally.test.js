'use strict';
const fs = require('node:fs'), assert = require('node:assert/strict');
const dir = process.argv[2]; if (!dir) throw Error('prepared directory required');
const source = fs.readFileSync(dir + '/browser.js', 'utf8');
const anchor = 'finally{await pause(6000);receipt.workerArm', start = source.indexOf(anchor);
assert(start >= 0); assert.equal(source.indexOf(anchor, start + 1), -1);
const end = source.indexOf("\n }\n else if(c.action==='key')", start); assert(end > start);
const body = source.slice(start + 'finally{'.length, end).trim().slice(0, -1);
const run = new Function('pause', 'receipt', 'workerArm', 'page', 'save', 'seq', 'return (async()=>{' + body + '})()');
(async () => {
  for (const failAt of [1, 2, 'both']) {
    const receipt = {}, saved = []; let calls = 0;
    const page = {evaluate: async () => { calls++; if (calls === failAt || failAt === 'both') throw Error('guest trap / unavailable owning Worker'); return [{closed: true}]; }};
    await run(async () => {}, receipt, [{armed: true}], page, (name, value) => saved.push({name, value}), 4);
    assert.equal(calls, 2, 'pointer cleanup still attempted after owning close failure');
    assert.equal(saved.length, 1); assert.equal(saved[0].name, 'input-4.json'); assert.equal(saved[0].value, receipt);
    if (failAt !== 2) assert.match(receipt.workerCloseError, /guest trap/);
    if (failAt !== 1) assert.match(receipt.pointerCloseError, /guest trap/);
  }
  console.log('PASS actual generated browser finally preserves receipt after owning Worker and pointer close failures');
})().catch(e => { console.error(e); process.exitCode = 1; });
