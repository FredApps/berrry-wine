#!/usr/bin/env node
// overlay-export.js — expand a --overlay-dir store into an ordinary host tree.
//
//   node tools/overlay-export.js <overlay-dir> --out=DIR [--prefix=c:\dir]
//                                              [--list] [--json]
//
// `test/run.js --overlay-dir=DIR` journals everything the guest writes to C:\
// into a content-addressed store: an index.json of records plus blobs/ named
// by uuid. That is the right shape for replaying the overlay back into the
// next run, and the wrong shape for every other question. An installer that
// has just finished is exactly when the interesting question is a host-side
// one -- what did it actually lay down, is this exe a PE or an NE, does the
// data file look like the media's -- and none of those can be asked of a file
// called 575d5749-4a06-41ba-ad72-ebff160a2bac.bin.
//
// So this walks the records and writes each file at its guest path with the
// drive letter stripped and the separators turned round, which is also the
// layout `--vfs-tree=DIR` reads back. That makes the two halves of a two-stage
// install composable without a copy step in between: run the installer with
// --overlay-dir, export, then run the installed program with --vfs-tree.
//
// --prefix restricts the export to one guest subtree (case-insensitive) and
// makes that subtree the root of the output, so `--prefix=c:\exile2` writes
// exile2.exe at the top of --out rather than three levels down.
//
// Reads the store through lib/overlay-store.js rather than parsing index.json
// here, so a change to the journal format lands in one place. Writes only
// under --out; the overlay itself is opened read-only.

const fs = require('fs');
const path = require('path');
const { nodeDirStore } = require('../lib/overlay-store.js');

function parseArgs(argv) {
  const out = { dir: null, out: null, prefix: null, list: false, json: false };
  for (const arg of argv) {
    if (arg.startsWith('--out=')) out.out = arg.slice(6);
    else if (arg.startsWith('--prefix=')) out.prefix = arg.slice(9);
    else if (arg === '--list') out.list = true;
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`);
    else if (!out.dir) out.dir = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return out;
}

// c:\exile2\monst1.bmp -> exile2/monst1.bmp, and with prefix c:\exile2 ->
// monst1.bmp. A record outside the prefix returns null and is skipped.
function hostRelative(guestPath, prefix) {
  let rest = String(guestPath).replace(/\//g, '\\');
  if (prefix) {
    const want = prefix.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const head = rest.slice(0, want.length).toLowerCase();
    if (head !== want) return null;
    rest = rest.slice(want.length);
  }
  rest = rest.replace(/^[a-z]:/i, '').replace(/^\\+/, '');
  if (!rest) return null;
  // A record naming a parent of the output root would escape it. The journal
  // is written by a guest, so this is a check, not a formality.
  const parts = rest.split('\\').filter(Boolean);
  if (parts.some(part => part === '..')) {
    throw new Error(`overlay record escapes the output root: ${guestPath}`);
  }
  return parts.join(path.sep);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    console.error('usage: overlay-export.js <overlay-dir> --out=DIR ' +
      '[--prefix=c:\\dir] [--list] [--json]');
    process.exit(2);
  }
  if (!args.list && !args.out) {
    console.error('overlay-export.js needs --out=DIR (or --list to only look)');
    process.exit(2);
  }
  if (!fs.existsSync(path.join(args.dir, 'index.json'))) {
    console.error(`${args.dir} has no index.json — is that an --overlay-dir?`);
    process.exit(2);
  }

  const store = nodeDirStore(args.dir);
  const records = await store.list();
  const rows = [];
  let written = 0;
  let bytes = 0;
  let skipped = 0;

  for (const record of records) {
    const rel = hostRelative(record.path, args.prefix);
    if (rel === null) { skipped++; continue; }
    if (record.kind === 'whiteout') { skipped++; continue; }
    rows.push({ guestPath: record.path, rel, kind: record.kind, size: record.size || 0 });
    if (args.list) continue;
    const target = path.join(args.out, rel);
    if (record.kind === 'dir') { fs.mkdirSync(target, { recursive: true }); continue; }
    const data = await store.read(record.path);
    if (!data) {
      console.error(`[overlay-export] MISSING BLOB ${record.path}`);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(data));
    written++;
    bytes += data.length;
  }

  if (args.json) {
    console.log(JSON.stringify({ records: records.length, rows, written, bytes }, null, 2));
    return;
  }
  for (const row of rows) {
    console.log(`${row.kind === 'dir' ? '  dir' : String(row.size).padStart(8)}  ` +
      `${row.guestPath}${args.list ? '' : `  ->  ${row.rel}`}`);
  }
  if (args.list) {
    console.log(`${rows.length} record(s) of ${records.length}` +
      (args.prefix ? ` under ${args.prefix}` : ''));
  } else {
    console.log(`[overlay-export] wrote ${written} file(s), ${bytes} bytes to ${args.out}` +
      (skipped ? ` (${skipped} record(s) outside the prefix or whiteouts)` : ''));
  }
}

main().catch((error) => {
  console.error((error && error.stack) || error);
  process.exit(1);
});
