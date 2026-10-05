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
function makeZip(files, padTo, { locator = false } = {}) {
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
  // A zip64 EOCD locator (signature only; the probe must refuse on sight).
  const loc = Buffer.alloc(locator ? 20 : 0); if (locator) loc.writeUInt32LE(0x07064b50, 0);
  return Buffer.concat([body, cd, loc, eocd]);
}
const ZIP = makeZip([{ name: 'd8', size: 54831144, stored: 10 }, { name: 'icudtl.dat', size: 10822000, stored: 10 }], 4000);
// The same archive with the EOCD claiming 5 entries (only 2 exist), in both
// the this-disk and total fields so it stays a single-disk archive.
const BADCOUNT = Buffer.from(ZIP); BADCOUNT.writeUInt16LE(5, BADCOUNT.length - 22 + 8); BADCOUNT.writeUInt16LE(5, BADCOUNT.length - 22 + 10);
// ...and with the central directory offset pointing before the fetched tail.
const BADOFF = Buffer.from(ZIP); BADOFF.writeUInt32LE(10, BADOFF.length - 22 + 16);
// zip64 / multi-disk: an entry whose uncompressed size is the 0xffffffff
// sentinel, an EOCD naming disk 1, and an archive carrying a zip64 locator.
const CD_OFF = ZIP.readUInt32LE(ZIP.length - 22 + 16);
const Z64ENT = Buffer.from(ZIP); Z64ENT.writeUInt32LE(0xffffffff, CD_OFF + 24);
const MULTIDISK = Buffer.from(ZIP); MULTIDISK.writeUInt16LE(1, MULTIDISK.length - 22 + 4);
const Z64LOC = makeZip([{ name: 'd8', size: 54831144, stored: 10 }, { name: 'icudtl.dat', size: 10822000, stored: 10 }], 4000, { locator: true });
const VARIANTS = { 'badcount.zip': BADCOUNT, 'badoff.zip': BADOFF, 'zip64-entry.zip': Z64ENT, 'multidisk.zip': MULTIDISK, 'zip64-locator.zip': Z64LOC };

let sentBytes = {};
// The endless-redirect-body server's record: bytes it wrote and whether the
// client closed the connection on it.
const redir = { written: 0, closed: false };
const server = http.createServer((req, res) => {
  const mode = req.url.slice(1);
  const z = VARIANTS[mode] || ZIP;
  if (mode === 'loop') { res.writeHead(302, { Location: '/loop' }); return res.end(); }
  if (mode === 'bigredirect' && req.method === 'GET') {
    // 302 to the good archive, followed by an ENDLESS body: a client that
    // drains it never stops reading; one that destroys it closes the socket.
    res.writeHead(302, { Location: '/ok.zip' });
    const chunk = Buffer.alloc(64 * 1024, 0x41);
    res.on('close', () => { redir.closed = true; });
    const pump = () => { while (!redir.closed) { redir.written += chunk.length; if (!res.write(chunk)) return res.once('drain', pump); } };
    return pump();
  }
  if (mode === 'bigredirect') { res.writeHead(302, { Location: '/ok.zip' }); return res.end(); }
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
  await check('redirect with an endless body: followed without reading it, connection closed, writes bounded', async () => {
    const r = await run('bigredirect');
    assert.strictEqual(r.error, undefined, r.error || r.thrown); assert.strictEqual(r.unpackedBytes, 54831144 + 10822000);
    const tw = Date.now(); while (!redir.closed && Date.now() - tw < 2000) await new Promise((x) => setTimeout(x, 20));
    assert.ok(redir.closed, `redirect connection still open after the probe (server wrote ${redir.written} B)`);
    const after = redir.written; await new Promise((x) => setTimeout(x, 200));
    assert.strictEqual(redir.written, after, 'server still writing the redirect body');
    assert.ok(redir.written < 8 * 1024 * 1024, `server wrote ${redir.written} B of redirect body`);
  });
  await check('zip64 sentinel 0xffffffff as an entry size: refused, never summed', async () => {
    const r = await run('zip64-entry.zip');
    assert.strictEqual(r.unpackedBytes, undefined); assert.match(r.error || '', /^zip64 sentinel in entry 0: refused$/);
  });
  await check('EOCD names disk 1: multi-disk refused', async () => {
    const r = await run('multidisk.zip');
    assert.strictEqual(r.unpackedBytes, undefined); assert.match(r.error || '', /^multi-disk archive/);
  });
  await check('zip64 EOCD locator before the EOCD: refused', async () => {
    const r = await run('zip64-locator.zip');
    assert.strictEqual(r.unpackedBytes, undefined); assert.match(r.error || '', /^zip64 archive \(zip64 EOCD locator present\): refused$/);
  });
  server.close();
  server.closeAllConnections && server.closeAllConnections();
  console.log(`${n - failed}/${n} passed`);
  process.exit(failed ? 1 : 0);
})();
