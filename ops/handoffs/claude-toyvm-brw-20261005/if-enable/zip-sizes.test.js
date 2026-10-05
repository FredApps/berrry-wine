#!/usr/bin/env node
'use strict';
// Local-stub tests for zip-sizes.js: a node http server on 127.0.0.1 (no
// external network, no guest) serving a constructed zip under several
// misbehaviours. Each must give an exact result or a refusal -- never a
// partial number and never an unbounded download.
//   node zip-sizes.test.js
const assert = require('assert');
const http = require('http');
const { probe } = require('./zip-sizes');

// A structurally valid zip (stored entries; only the central directory and
// EOCD matter to the probe), padded so the archive is larger than the tail.
function makeZip(files, padTo) {
  const locals = [], cds = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(name.length, 26);
    const data = Buffer.alloc(f.stored || 0);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(f.size, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(off, 42);
    locals.push(lh, name, data); cds.push(cd, name);
    off += 30 + name.length + data.length;
  }
  let body = Buffer.concat(locals);
  if (padTo && body.length < padTo) body = Buffer.concat([body, Buffer.alloc(padTo - body.length)]);
  const cd = Buffer.concat(cds);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cd, eocd]);
}
const ZIP = makeZip([{ name: 'd8', size: 54831144, stored: 10 }, { name: 'icudtl.dat', size: 10822000, stored: 10 }], 4000);
// The same archive with the EOCD claiming 5 entries (only 2 exist).
const BADCOUNT = Buffer.from(ZIP); BADCOUNT.writeUInt16LE(5, BADCOUNT.length - 22 + 10);
// ...and with the central directory offset pointing before the fetched tail.
const BADOFF = Buffer.from(ZIP); BADOFF.writeUInt32LE(10, BADOFF.length - 22 + 16);

let sentBytes = {};
const server = http.createServer((req, res) => {
  const mode = req.url.slice(1);
  const z = mode === 'badcount.zip' ? BADCOUNT : mode === 'badoff.zip' ? BADOFF : ZIP;
  if (mode === 'loop') { res.writeHead(302, { Location: '/loop' }); return res.end(); }
  if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Length': z.length }); return res.end(); }
  const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
  const s = Number(m[1]), e = Number(m[2]);
  const send = (status, headers, body) => { sentBytes[mode] = body.length; res.writeHead(status, headers); res.end(body); };
  if (mode === 'ignore-range.zip') return send(200, { 'Content-Length': z.length }, z);
  if (mode === 'wrong-range.zip') return send(206, { 'Content-Range': `bytes ${s + 1}-${e}/${z.length}` }, z.subarray(s + 1, e + 1));
  if (mode === 'short.zip') return send(206, { 'Content-Range': `bytes ${s}-${e}/${z.length}` }, z.subarray(s, e));
  if (mode === 'overlong.zip') return send(206, { 'Content-Range': `bytes ${s}-${e}/${z.length}` }, z.subarray(s - 500, e + 1));
  return send(206, { 'Content-Range': `bytes ${s}-${e}/${z.length}` }, z.subarray(s, e + 1));
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const TAIL = 400;   // the archive is ~4.2 KB, so a 200 would be ~10x the cap
  let n = 0, failed = 0;
  const check = async (name, fn) => { n++; try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };
  const run = async (mode, opts = {}) => { try { return await probe(base + mode, { tail: TAIL, ...opts }); } catch (e) { return { thrown: String(e.message || e) }; } };

  await check('honoured 206: exact compressed and unpacked sizes', async () => {
    const r = await run('ok.zip');
    assert.strictEqual(r.error, undefined, r.error); assert.strictEqual(r.compressedBytes, ZIP.length);
    assert.strictEqual(r.unpackedBytes, 54831144 + 10822000); assert.strictEqual(r.files, 2);
  });
  await check('server ignores Range (200 + whole archive): refused at the tail cap, not downloaded', async () => {
    const r = await run('ignore-range.zip');
    assert.match(r.thrown || '', /passed its 400-byte cap \(status 200\)/);
  });
  await check('206 with a Content-Range other than the one asked: refused', async () => {
    const r = await run('wrong-range.zip');
    assert.match(r.error || '', /^Content-Range "bytes \d+-\d+\/\d+" is not/);
  });
  await check('206 body shorter than the range: refused', async () => {
    assert.match((await run('short.zip')).error || '', /^range body 399 bytes, want 400$/);
  });
  await check('206 body longer than the range: aborted at the cap', async () => {
    assert.match((await run('overlong.zip')).thrown || '', /passed its 400-byte cap \(status 206\)/);
  });
  await check('redirect loop: refused after maxRedirects', async () => {
    assert.match((await run('loop', { maxRedirects: 3 })).thrown || '', /too many redirects/);
  });
  await check('EOCD claims more entries than exist: bounds refusal, no out-of-range read', async () => {
    assert.match((await run('badcount.zip')).error || '', /runs past the central directory|bad central-directory signature/);
  });
  await check('central directory offset outside the fetched tail: refused', async () => {
    assert.match((await run('badoff.zip')).error || '', /not wholly inside the fetched tail/);
  });
  server.close();
  console.log(`${n - failed}/${n} passed`);
  process.exit(failed ? 1 : 0);
})();
