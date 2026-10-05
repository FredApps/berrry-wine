'use strict';
// Exact compressed (Content-Length) and uncompressed (sum over the zip's
// central directory) sizes of a remote .zip WITHOUT downloading it: one HEAD
// request, then a Range request for the last 128 KiB, parsed for the
// end-of-central-directory record and every central-directory entry in it.
//   node zip-sizes.js <url> [<url> ...]
const https = require('https');
function req(url, method, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = https.request(url, { method, headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return resolve(req(new URL(res.headers.location, url).toString(), method, headers));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.setTimeout(30000, () => r.destroy(new Error('timeout')));
    r.end();
  });
}
(async () => {
  for (const url of process.argv.slice(2)) {
    const head = await req(url, 'HEAD');
    const size = Number(head.headers['content-length']);
    if (head.status !== 200 || !size) { console.log(JSON.stringify({ url, status: head.status, error: 'no size' })); continue; }
    const tailLen = Math.min(size, 128 * 1024);
    const tail = (await req(url, 'GET', { Range: `bytes=${size - tailLen}-${size - 1}` })).body;
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) { console.log(JSON.stringify({ url, size, error: 'no EOCD in tail (zip64 or long comment)' })); continue; }
    const entries = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    const cdStart = cdOff - (size - tailLen);
    if (cdStart < 0) { console.log(JSON.stringify({ url, size, entries, error: `central directory (${cdSize} B) not inside the fetched tail` })); continue; }
    let p = cdStart, unpacked = 0, files = 0, biggest = [];
    for (let i = 0; i < entries; i++) {
      if (tail.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad CD entry at ${p}`);
      const usz = tail.readUInt32LE(p + 24), nlen = tail.readUInt16LE(p + 28), elen = tail.readUInt16LE(p + 30), clen = tail.readUInt16LE(p + 32);
      const name = tail.toString('utf8', p + 46, p + 46 + nlen);
      unpacked += usz; files++; biggest.push([usz, name]);
      p += 46 + nlen + elen + clen;
    }
    biggest.sort((a, b) => b[0] - a[0]);
    console.log(JSON.stringify({ url, compressedBytes: size, unpackedBytes: unpacked, files,
      largest: biggest.slice(0, 5).map(([s, n]) => `${n} ${s}`), lastModified: head.headers['last-modified'] || null }));
  }
})().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
