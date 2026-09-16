// Census of UNIT-STRIDE BYTE FILL self-loops across a pile of PEs.
//
//   node tools/find-byte-fills.js <pe> [<pe>...] [--from=list.txt]
//                                 [--size=1] [--detail] [--json]
//
// tl;dr: for every file, run find-loops.js's body extraction and match-loops.js's
// real predicate, then keep only the hits that came back
// `FILL_RUN size=<N> stride=+-1` -- a loop that stores one N-byte constant
// through a pointer that advances by one element per iteration and nothing else.
// That is the exact shape a `memory.fill` lowering can discharge, and it is a
// strictly narrower question than match-loops.js's FILL_RUN column, which also
// counts strided fills (`add eax,0x14`) that no bulk store can serve.
//
// The point of the tool is the GENERALITY question, not the match rate: a fold
// that only ever fires in one binary is a one-app fold (RLE_RUN was one), so the
// number that matters is how many DISTINCT binaries carry the shape at all.
// Files are de-duplicated by content hash, because test/binaries reaches the
// same DLLs through several symlinked directories.
//
// Says nothing about how hot any of these loops are -- pair with --handler-hist.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { findLoops } = require(path.join(__dirname, 'find-loops.js'));
const { match } = require(path.join(__dirname, 'match-loops.js'));

const args = process.argv.slice(2);
const opt = (n, d) => {
  const a = args.find(x => x.startsWith('--' + n + '='));
  return a ? a.slice(n.length + 3) : d;
};
const has = n => args.some(a => a === '--' + n || a.startsWith('--' + n + '='));

let files = args.filter(a => !a.startsWith('--'));
const fromList = opt('from', null);
if (fromList) {
  files = files.concat(
    fs.readFileSync(fromList, 'utf8').split('\n').map(s => s.trim()).filter(Boolean));
}
if (!files.length) {
  console.error('usage: find-byte-fills.js <pe> [<pe>...] [--from=list.txt] '
    + '[--size=N] [--detail] [--json]');
  process.exit(1);
}

const WANT_SIZE = parseInt(opt('size', '1'), 10);
const MAXB = parseInt(opt('max-body', '24'), 10);
const DETAIL = has('detail');
const JSON_OUT = has('json');

const seen = new Set();
const rows = [];
let skippedDup = 0, skippedBad = 0;

for (const f of files) {
  let hash;
  try {
    hash = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  } catch (e) { skippedBad++; continue; }
  if (seen.has(hash)) { skippedDup++; continue; }
  seen.add(hash);

  let loops;
  try { loops = findLoops(f, { maxBody: MAXB }); }
  catch (e) { skippedBad++; continue; }
  if (!loops || !loops.length) continue;

  const hits = [];
  let anyFill = 0;
  for (const L of loops) {
    let m;
    try { m = match(L.body); } catch (e) { continue; }
    if (!m || m.pattern !== 'FILL_RUN') continue;
    anyFill++;
    if (m.size !== WANT_SIZE) continue;
    if (Math.abs(m.stride) !== 1) continue;
    hits.push({ va: L.va, stride: m.stride, body: L.body });
  }
  if (!hits.length) continue;
  rows.push({ file: f, fills: anyFill, unit: hits.length, hits });
}

rows.sort((a, b) => b.unit - a.unit);

if (JSON_OUT) {
  console.log(JSON.stringify({
    wantSize: WANT_SIZE,
    distinctBinaries: seen.size,
    binariesWithShape: rows.length,
    totalSites: rows.reduce((n, r) => n + r.unit, 0),
    rows: rows.map(r => ({
      file: r.file, fills: r.fills, unit: r.unit,
      vas: r.hits.map(h => '0x' + h.va.toString(16)),
    })),
  }, null, 1));
} else {
  console.log(`unit-stride ${WANT_SIZE}-byte FILL_RUN census`);
  console.log(`${seen.size} distinct binaries scanned `
    + `(${skippedDup} duplicate paths, ${skippedBad} unreadable/not-PE)`);
  console.log(`${rows.length} carry the shape, `
    + `${rows.reduce((n, r) => n + r.unit, 0)} sites total\n`);
  console.log('sites  allFill  file');
  console.log('----------------------------------------------------------');
  for (const r of rows) {
    console.log(String(r.unit).padStart(5), String(r.fills).padStart(8), ' ' + r.file);
    if (DETAIL) {
      for (const h of r.hits) {
        console.log(`        0x${h.va.toString(16)}  stride=${h.stride}`);
        for (const i of h.body) console.log('          ' + i);
      }
    }
  }
}
