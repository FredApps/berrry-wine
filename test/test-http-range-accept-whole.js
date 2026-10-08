#!/usr/bin/env node
'use strict';

// HttpRangeProvider acceptWhole: a sized streamed file mounts with no HEAD
// (lib/app-files.js puts the size on every streamed entry; host.js builds the
// provider directly for anything up to one release part). A host that honours
// Range answers 206 and only the range moves; a host that ignores it answers
// 200 with the whole file, which acceptWhole keeps and serves every later
// read from -- the bytes an eager load would have fetched, once. Without the
// option a 200 stays an error, and a 200 of the wrong length is one too.

const assert = require('assert');
const { HttpRangeProvider } = require('../lib/byte-provider');

const body = Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff);
function stubFetch({ honourRange, length = body.length }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push(init.method || 'GET');
    const range = init.headers && init.headers.Range;
    if (honourRange && range) {
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range);
      const part = body.slice(Number(a), Number(b) + 1);
      return { status: 206, ok: true, headers: { get: () => null }, arrayBuffer: async () => part.buffer };
    }
    const whole = body.slice(0, length);
    return { status: 200, ok: true, headers: { get: () => null }, arrayBuffer: async () => whole.buffer };
  };
  return { fetch, calls };
}

(async () => {
  // Range honoured: one ranged GET per read, never a HEAD.
  let s = stubFetch({ honourRange: true });
  let p = new HttpRangeProvider('u', body.length, { fetch: s.fetch, acceptWhole: true });
  assert.deepStrictEqual([...await p.readRange(10, 4)], [10, 11, 12, 13]);
  assert.deepStrictEqual(s.calls, ['GET'], 'no HEAD for a sized provider');
  assert.strictEqual(p.readRangeSync(10, 4), null, 'nothing resident after a ranged read');

  // Range ignored: the first read takes the whole body, later reads (async
  // and sync) come from it with no further request.
  s = stubFetch({ honourRange: false });
  p = new HttpRangeProvider('u', body.length, { fetch: s.fetch, acceptWhole: true });
  assert.deepStrictEqual([...await p.readRange(500, 3)], [500 & 0xff, 501 & 0xff, 502 & 0xff]);
  assert.deepStrictEqual([...await p.readRange(0, 2)], [0, 1]);
  assert.deepStrictEqual([...p.readRangeSync(998, 5)], [998 & 0xff, 999 & 0xff], 'sync reads clamp to the size');
  assert.deepStrictEqual(s.calls, ['GET'], 'the whole file is fetched once');

  // A 200 whose body is not the whole file is an error, not a mis-slice.
  s = stubFetch({ honourRange: false, length: 999 });
  p = new HttpRangeProvider('u', body.length, { fetch: s.fetch, acceptWhole: true });
  await assert.rejects(p.readRange(0, 4), /answered 200 with 999 bytes/);

  // Without acceptWhole a 200 stays the loud error it always was.
  s = stubFetch({ honourRange: false });
  p = new HttpRangeProvider('u', body.length, { fetch: s.fetch });
  await assert.rejects(p.readRange(0, 4), /answered 200, expected 206/);

  console.log('PASS HttpRangeProvider acceptWhole: no HEAD, 206 ranges, a Range-less 200 kept once, wrong length rejected');
})().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
