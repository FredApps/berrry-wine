#!/usr/bin/env node
'use strict';

// tools/web-input-probe.js serves the working tree itself. The page's lazy
// file loader asks for byte ranges and refuses a 200, so the probe's server
// must answer them the way tools/dev-server.js does: without that, Dungeons of
// Dredmor stopped on "couldn't load game data (tweakdb.xml): the server
// answered HTTP 200" in the probe and nowhere else. No browser is started here.

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { startStaticServer } = require('../tools/web-input-probe');

const get = (port, url, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: url, headers }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

(async () => {
  const server = await startStaticServer();
  const { port } = server.address();
  const want = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
  try {
    let r = await get(port, '/index.html');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers['accept-ranges'], 'bytes');
    assert(r.body.equals(want), 'whole file without a Range header');

    r = await get(port, '/index.html', { Range: 'bytes=10-19' });
    assert.strictEqual(r.status, 206);
    assert.strictEqual(r.headers['content-range'], `bytes 10-19/${want.length}`);
    assert(r.body.equals(want.subarray(10, 20)), 'explicit range');

    r = await get(port, '/index.html', { Range: 'bytes=-5' });
    assert.strictEqual(r.status, 206);
    assert(r.body.equals(want.subarray(want.length - 5)), 'suffix range');

    r = await get(port, '/index.html', { Range: `bytes=${want.length - 3}-` });
    assert.strictEqual(r.status, 206);
    assert(r.body.equals(want.subarray(want.length - 3)), 'open-ended range');

    r = await get(port, '/index.html', { Range: `bytes=${want.length + 10}-` });
    assert.strictEqual(r.status, 416, 'range past the end');

    r = await get(port, '/no-such-file.bin');
    assert.strictEqual(r.status, 404);
    r = await get(port, '/../etc/passwd');
    assert.notStrictEqual(r.status, 200, 'no escape from the served root');
  } finally {
    server.close();
  }
  console.log('PASS  web-input-probe static server: 200 whole file, 206 explicit/suffix/open ranges, 416, 404');
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });
