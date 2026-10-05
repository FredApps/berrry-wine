'use strict';
// Exact compressed (Content-Length) and uncompressed (sum over the zip's
// central directory) sizes of a remote .zip WITHOUT downloading it: one HEAD
// request, then a Range request for the last `tail` bytes (default 128 KiB),
// parsed for the end-of-central-directory record and every central-directory
// entry in it.
//
// BOUNDED BY CONSTRUCTION (root review, 2026-10-05):
//  - every response body is capped: a body that grows past its cap aborts the
//    request (HEAD bodies are capped at 0, the tail at exactly the requested
//    length), so a server that ignores Range cannot stream an archive to us;
//  - the tail GET must answer 206 with a Content-Range of exactly
//    `bytes <start>-<end>/<size>` for the range asked, and a body of exactly
//    that many bytes; a 200, a different range or a different total refuses;
//  - redirects are followed at most `maxRedirects` (default 5) times;
//  - parsing is bounds-checked: the EOCD and every central-directory field are
//    read only inside the fetched tail, the directory must lie wholly inside
//    it, and an entry count or name length that would run past it refuses.
// Anything else is a refusal with a reason, never a partial number.
//
//   node zip-sizes.js <url> [<url> ...]
//   require('./zip-sizes').probe(url, { tail, maxRedirects }) -> result object

const http = require('http');
const https = require('https');

function request(url, method, headers, cap, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : url.startsWith('http:') ? http : null;
    if (!mod) return reject(new Error(`unsupported URL scheme: ${url}`));
    const r = mod.request(url, { method, headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error(`too many redirects at ${url}`));
        return resolve(request(new URL(res.headers.location, url).toString(), method, headers, cap, redirectsLeft - 1));
      }
      const chunks = [];
      let got = 0;
      res.on('data', (c) => {
        got += c.length;
        if (got > cap) { res.destroy(); r.destroy(); return reject(new Error(`response body passed its ${cap}-byte cap (status ${res.statusCode})`)); }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), url }));
      res.on('error', reject);
    });
    r.on('error', reject);
    r.setTimeout(30000, () => r.destroy(new Error('timeout')));
    r.end();
  });
}

async function probe(url, { tail = 128 * 1024, maxRedirects = 5 } = {}) {
  const head = await request(url, 'HEAD', {}, 0, maxRedirects);
  const size = Number(head.headers['content-length']);
  if (head.status !== 200 || !Number.isSafeInteger(size) || size <= 0) return { url, status: head.status, error: 'HEAD gave no usable Content-Length' };
  const tailLen = Math.min(size, tail);
  const start = size - tailLen, end = size - 1;
  const get = await request(url, 'GET', { Range: `bytes=${start}-${end}` }, tailLen, maxRedirects);
  if (get.status !== 206) return { url, compressedBytes: size, error: `range not honoured: status ${get.status} (want 206)` };
  const cr = String(get.headers['content-range'] || '');
  if (cr !== `bytes ${start}-${end}/${size}`) return { url, compressedBytes: size, error: `Content-Range "${cr}" is not "bytes ${start}-${end}/${size}"` };
  const buf = get.body;
  if (buf.length !== tailLen) return { url, compressedBytes: size, error: `range body ${buf.length} bytes, want ${tailLen}` };
  // EOCD: 22 bytes minimum, searched only where a whole record fits.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return { url, compressedBytes: size, error: 'no end-of-central-directory record in the fetched tail (zip64 or long comment)' };
  const entries = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  const cdStart = cdOff - start;
  if (cdStart < 0 || cdStart + cdSize > eocd) return { url, compressedBytes: size, entries, error: `central directory (${cdSize} B at ${cdOff}) not wholly inside the fetched tail` };
  let p = cdStart, unpacked = 0, files = 0;
  const biggest = [];
  for (let i = 0; i < entries; i++) {
    if (p + 46 > cdStart + cdSize) return { url, compressedBytes: size, error: `entry ${i} header runs past the central directory` };
    if (buf.readUInt32LE(p) !== 0x02014b50) return { url, compressedBytes: size, error: `bad central-directory signature at entry ${i}` };
    const usz = buf.readUInt32LE(p + 24), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const next = p + 46 + nlen + elen + clen;
    if (next > cdStart + cdSize) return { url, compressedBytes: size, error: `entry ${i} name/extra/comment runs past the central directory` };
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    unpacked += usz; files++; biggest.push([usz, name]);
    p = next;
  }
  biggest.sort((a, b) => b[0] - a[0]);
  return { url: get.url, compressedBytes: size, unpackedBytes: unpacked, files,
    largest: biggest.slice(0, 5).map(([s, n]) => `${n} ${s}`), lastModified: head.headers['last-modified'] || null };
}

module.exports = { probe };

if (require.main === module) {
  (async () => {
    let bad = 0;
    for (const url of process.argv.slice(2)) {
      let r;
      try { r = await probe(url); } catch (e) { r = { url, error: String(e.message || e) }; }
      if (r.error) bad++;
      console.log(JSON.stringify(r));
    }
    process.exit(bad ? 1 : 0);
  })();
}
