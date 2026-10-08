#!/usr/bin/env node
'use strict';

// List or extract an InstallShield 5/6 cabinet set (data1.hdr + dataN.cab).
//
//   node tools/is-cab.js <dir-or-data1.hdr> [--list] [--extract=OUT] [--json]
//
// An InstallShield 6 setup runs its engine (ikernel.exe) as an out-of-process
// COM server, which the emulator does not provide, so "run the installer in the
// emulator" stops at "Setup failed to launch installation engine". This reads
// the cabinets directly instead: the header's file table, then each file's
// data from its volume, inflating the 16-bit-length-prefixed raw-deflate chunks
// InstallShield writes and following a file across volumes when it is split.
// Every extracted file is checked against the MD5 its descriptor records, so a
// layout mistake cannot pass as a good extraction.
//
// Layout follows unshield (libunshield): common header at 0, cab descriptor at
// header.cab_descriptor_offset, version-6 file descriptors of 0x57 bytes,
// volume headers at 0x14 in each dataN.cab.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FILE_SPLIT = 1, FILE_OBFUSCATED = 2, FILE_COMPRESSED = 4, FILE_INVALID = 8;

function u32(b, o) { return b.readUInt32LE(o); }
function u64(b, o) { return b.readUInt32LE(o) + b.readUInt32LE(o + 4) * 0x100000000; }
function cstr(b, o) { const e = b.indexOf(0, o); return b.toString('latin1', o, e < 0 ? b.length : e); }

function majorVersion(version) {
  if ((version >>> 24) === 1) return (version >>> 12) & 0xf;
  if ((version >>> 24) === 2 || (version >>> 24) === 4) {
    const v = (version & 0xffff);
    return v ? Math.floor(v / 100) : 0;
  }
  return 0;
}

function openSet(input) {
  const stat = fs.statSync(input);
  const dir = stat.isDirectory() ? input : path.dirname(input);
  const names = fs.readdirSync(dir);
  const find = re => names.find(n => re.test(n));
  const hdrName = stat.isDirectory() ? find(/^data1\.hdr$/i) : path.basename(input);
  if (!hdrName) throw new Error(`no data1.hdr in ${dir}`);
  const prefix = hdrName.replace(/1\.hdr$/i, '');
  const volume = n => {
    const name = find(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${n}\\.cab$`, 'i'));
    return name ? path.join(dir, name) : null;
  };
  return { dir, hdr: fs.readFileSync(path.join(dir, hdrName)), volume };
}

function readTable(set) {
  const h = set.hdr;
  if (u32(h, 0) !== 0x28635349) throw new Error('not an InstallShield cabinet header (ISc()');
  const version = u32(h, 4);
  const major = majorVersion(version);
  if (major < 5) throw new Error(`InstallShield cabinet version ${major} is not supported (0x${version.toString(16)})`);
  const cd = u32(h, 0x0c);
  const fileTable = cd + u32(h, cd + 0x0c);
  const dirCount = u32(h, cd + 0x1c);
  const fileCount = u32(h, cd + 0x28);
  const fileTable2 = u32(h, cd + 0x2c);
  const dirs = [];
  for (let i = 0; i < dirCount; i++) dirs.push(cstr(h, fileTable + u32(h, fileTable + i * 4)));
  const files = [];
  for (let i = 0; i < fileCount; i++) {
    let p, fd;
    if (major <= 5) {
      p = fileTable + u32(h, fileTable + (dirCount + i) * 4);
      fd = {
        name_offset: u32(h, p), directory_index: u32(h, p + 4), flags: h.readUInt16LE(p + 8),
        expanded_size: u32(h, p + 0x0a), compressed_size: u32(h, p + 0x0e),
        data_offset: u32(h, p + 0x22), md5: h.subarray(p + 0x26, p + 0x36), volume: 0,
      };
    } else {
      p = fileTable + fileTable2 + i * 0x57;
      fd = {
        flags: h.readUInt16LE(p), expanded_size: u64(h, p + 2), compressed_size: u64(h, p + 10),
        data_offset: u64(h, p + 18), md5: h.subarray(p + 26, p + 42),
        name_offset: u32(h, p + 58), directory_index: h.readUInt16LE(p + 62),
        link_previous: u32(h, p + 76), link_next: u32(h, p + 80), link_flags: h[p + 84],
        volume: h.readUInt16LE(p + 85),
      };
    }
    fd.index = i;
    fd.name = cstr(h, fileTable + fd.name_offset);
    fd.dir = dirs[fd.directory_index] || '';
    files.push(fd);
  }
  return { version, major, dirs, files };
}

// Volume header at 0x14 of each dataN.cab (version 6 layout).
function volumeHeader(buf) {
  return {
    data_offset: u32(buf, 0x14), first_file_index: u32(buf, 0x1c), last_file_index: u32(buf, 0x20),
    first_file_offset: u64(buf, 0x24), first_file_size_compressed: u64(buf, 0x34),
    last_file_offset: u64(buf, 0x3c), last_file_size_compressed: u64(buf, 0x4c),
  };
}

function readCompressed(set, fd, cache) {
  const vol = n => {
    if (!cache.has(n)) {
      const file = set.volume(n);
      cache.set(n, file ? fs.readFileSync(file) : null);
    }
    return cache.get(n);
  };
  let n = fd.volume || 1;
  let buf = vol(n);
  if (!buf) throw new Error(`volume ${n} missing for ${fd.name}`);
  const parts = [];
  let need = fd.compressed_size;
  let pos = fd.data_offset;
  while (need > 0) {
    const vh = volumeHeader(buf);
    let avail = buf.length - pos;
    // The volume header records how much of a split last file this volume holds.
    if (fd.index === vh.last_file_index && vh.last_file_size_compressed && pos === vh.last_file_offset)
      avail = Math.min(avail, vh.last_file_size_compressed);
    const take = Math.min(need, avail);
    if (take <= 0) throw new Error(`no data for ${fd.name} in volume ${n} at 0x${pos.toString(16)}`);
    parts.push(buf.subarray(pos, pos + take));
    need -= take;
    if (need > 0) {
      n++;
      buf = vol(n);
      if (!buf) throw new Error(`${fd.name} continues into missing volume ${n}`);
      const next = volumeHeader(buf);
      pos = next.first_file_offset || next.data_offset;
    }
  }
  return Buffer.concat(parts);
}

function inflateChunks(data, expected) {
  const out = [];
  let size = 0, p = 0;
  while (p + 2 <= data.length && size < expected) {
    const len = data.readUInt16LE(p);
    p += 2;
    const chunk = data.subarray(p, p + len);
    p += len;
    const raw = zlib.inflateRawSync(chunk, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    out.push(raw);
    size += raw.length;
  }
  return Buffer.concat(out).subarray(0, expected);
}

// The setup's own Disk1 files (Setup.exe, setup.inx, a DirectX redistributable,
// a launcher...) are listed uncompressed but live loose beside data1.hdr, not
// in a volume; the descriptor's MD5 names the copy that is meant.
function diskFile(set, fd) {
  if (fd.flags & FILE_COMPRESSED) return null;
  const p = path.join(set.dir, fd.name);
  if (!fs.existsSync(p)) return null;
  const data = fs.readFileSync(p);
  return crypto.createHash('md5').update(data).digest().equals(fd.md5) ? data : null;
}

function extractFile(set, fd, cache) {
  if (fd.flags & FILE_OBFUSCATED) throw new Error(`${fd.name}: obfuscated files are not supported`);
  const loose = diskFile(set, fd);
  if (loose) return { out: loose, ok: true, source: 'disk1' };
  const data = readCompressed(set, fd, cache);
  const out = fd.flags & FILE_COMPRESSED ? inflateChunks(data, fd.expanded_size) : data;
  const md5 = crypto.createHash('md5').update(out).digest();
  return { out, ok: md5.equals(fd.md5), source: 'cab' };
}

function main() {
  const args = process.argv.slice(2);
  const input = args.find(a => !a.startsWith('--'));
  if (!input) {
    console.error('usage: node tools/is-cab.js <dir-or-data1.hdr> [--list] [--extract=OUT] [--json]');
    process.exit(2);
  }
  const outArg = args.find(a => a.startsWith('--extract='));
  const set = openSet(input);
  const table = readTable(set);
  // Zero-length entries (layout.bin, data1.hdr, data1.cab) are the installer's
  // own bookkeeping, recorded without contents.
  const live = table.files.filter(f => !(f.flags & FILE_INVALID) && f.name && f.expanded_size > 0);
  if (args.includes('--json')) {
    console.log(JSON.stringify({ version: table.version, major: table.major, files: live.map(f => ({
      index: f.index, dir: f.dir, name: f.name, flags: f.flags, size: f.expanded_size,
      compressed: f.compressed_size, volume: f.volume, offset: f.data_offset })) }, null, 1));
  } else if (!outArg || args.includes('--list')) {
    console.log(`InstallShield ${table.major} (0x${table.version.toString(16)}): ${live.length} files, ${table.dirs.length} directories`);
    for (const f of live) {
      console.log(`${String(f.index).padStart(4)} v${f.volume} ${String(f.expanded_size).padStart(10)} ` +
        `${(f.flags & FILE_SPLIT) ? 'S' : ' '}${(f.flags & FILE_COMPRESSED) ? 'C' : ' '} ${f.dir ? f.dir + '\\' : ''}${f.name}`);
    }
  }
  if (outArg) {
    const outDir = outArg.slice('--extract='.length);
    const cache = new Map();
    let good = 0, bad = 0;
    for (const f of live) {
      const rel = (f.dir ? f.dir.split(/[\\/]/) : []).filter(Boolean).concat(f.name);
      const dest = path.join(outDir, ...rel);
      try {
        const { out, ok } = extractFile(set, f, cache);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, out);
        if (ok) good++; else { bad++; console.error(`MD5 MISMATCH ${rel.join('/')}`); }
      } catch (e) {
        bad++;
        console.error(`FAILED ${rel.join('/')}: ${e.message}`);
      }
    }
    console.log(`extracted ${good} files verified by MD5, ${bad} failed -> ${outDir}`);
    if (bad) process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { openSet, readTable, extractFile };
