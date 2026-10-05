#!/usr/bin/env node
'use strict';

// Read a Windows Installer package (.msi) on the host, with no emulator in the
// loop: the ground truth for "what does the database actually say" when the
// guest's msi.dll does something unexpected with it.
//
//   node tools/msi-tables.js <file.msi>                       list tables + row counts
//   node tools/msi-tables.js <file.msi> --table=ControlEvent  dump every row
//   node tools/msi-tables.js <file.msi> --table=ControlEvent --where=Dialog_=Welcome_Dialog,Control_=Next
//   node tools/msi-tables.js <file.msi> --streams             every CFB stream, decoded name + size
//   node tools/msi-tables.js <file.msi> --summary             SummaryInformation properties
//
// Layout (Wine's dlls/msi is the public description of it): an MSI is an OLE
// compound file whose stream names are packed 2-chars-per-UTF-16-unit into
// 0x3800..0x47FF, with 0x4840 marking a table stream. `!_StringPool` +
// `!_StringData` hold the interned strings (id 0 is NULL), `!_Columns` holds
// every table's schema, and each table stream is column-major with ints
// stored XOR 0x8000 / 0x80000000 and strings as pool ids.

const fs = require('fs');

function readCfb(file) {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (v.getUint32(0, true) !== 0xe011cfd0) throw new Error('not a compound file');
  const ss = 1 << v.getUint16(30, true), mss = 1 << v.getUint16(32, true);
  const miniCutoff = v.getUint32(56, true);
  const sec = id => file.subarray(512 + id * ss, 512 + (id + 1) * ss);
  const u32s = b => { const d = new DataView(b.buffer, b.byteOffset, b.length); const r = []; for (let i = 0; i + 4 <= b.length; i += 4) r.push(d.getUint32(i, true)); return r; };
  const difat = [];
  for (let i = 0; i < 109; i++) difat.push(v.getUint32(76 + i * 4, true));
  for (let dx = v.getUint32(68, true), n = v.getUint32(72, true); n-- > 0 && dx < 0xfffffffa;) {
    const w = u32s(sec(dx)); difat.push(...w.slice(0, -1)); dx = w[w.length - 1];
  }
  const fat = [];
  for (let i = 0; i < v.getUint32(44, true); i++) fat.push(...u32s(sec(difat[i])));
  const chain = (first, table, unit, src) => {
    const parts = []; const seen = new Set();
    for (let id = first; id < 0xfffffffa; id = table[id]) {
      if (seen.has(id)) throw new Error(`sector chain loops at ${id}`);
      seen.add(id); parts.push(src(id));
    }
    const out = new Uint8Array(parts.length * unit);
    parts.forEach((p, i) => out.set(p, i * unit));
    return out;
  };
  const dir = chain(v.getUint32(48, true), fat, ss, sec);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const d = new DataView(dir.buffer, dir.byteOffset + o, 128);
    const nb = d.getUint16(64, true);
    const units = [];
    for (let i = 0; i + 2 < nb; i += 2) units.push(d.getUint16(i, true));
    entries.push({ units, type: d.getUint8(66), start: d.getUint32(116, true), size: d.getUint32(120, true) });
  }
  const root = entries[0];
  const mini = chain(root.start, fat, ss, sec);
  const minifat = u32s(chain(v.getUint32(60, true), fat, ss, sec));
  const read = e => (e.size < miniCutoff
    ? chain(e.start, minifat, mss, id => mini.subarray(id * mss, (id + 1) * mss))
    : chain(e.start, fat, ss, sec)).subarray(0, e.size);
  return entries.filter(e => e.type === 2).map(e => ({ units: e.units, size: e.size, read: () => read(e) }));
}

const MIME = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._';
function decodeStreamName(units) {
  let out = '';
  for (const ch of units) {
    if (ch === 0x4840) out += '!';
    else if (ch >= 0x4800 && ch < 0x4840) out += MIME[ch - 0x4800];
    else if (ch >= 0x3800 && ch < 0x4800) out += MIME[(ch - 0x3800) & 0x3f] + MIME[((ch - 0x3800) >> 6) & 0x3f];
    else out += String.fromCharCode(ch);
  }
  return out;
}

function loadStrings(pool, data) {
  const p = new DataView(pool.buffer, pool.byteOffset, pool.length);
  const header = pool.length >= 4 ? p.getUint32(0, true) : 0;
  const longRefs = (header & 0x80000000) !== 0;
  const strings = [null];
  let off = 0;
  for (let i = 4; i + 4 <= pool.length;) {
    let len = p.getUint16(i, true);
    const refs = p.getUint16(i + 2, true);
    if (len === 0 && refs === 0) { strings.push(''); i += 4; continue; }
    if (len === 0) { len = (p.getUint16(i + 6, true) << 16) + p.getUint16(i + 4, true); i += 8; }
    else i += 4;
    strings.push(Buffer.from(data.subarray(off, off + len)).toString('latin1'));
    off += len;
  }
  return { strings, refSize: longRefs ? 3 : 2 };
}

const MSITYPE_VALID = 0x0100, MSITYPE_STRING = 0x0800;
function colWidth(type, refSize) {
  if ((type & MSITYPE_STRING) || !(type & MSITYPE_VALID)) return refSize;  // string / stream ref
  return (type & 0xff) <= 2 ? 2 : 4;
}

function readTable(bytes, cols, str) {
  const widths = cols.map(c => colWidth(c.type, str.refSize));
  const rowSize = widths.reduce((a, b) => a + b, 0);
  const n = rowSize ? Math.floor(bytes.length / rowSize) : 0;
  const rows = Array.from({ length: n }, () => ({}));
  let off = 0;
  cols.forEach((c, ci) => {
    const w = widths[ci];
    for (let r = 0; r < n; r++, off += w) {
      let raw = 0;
      for (let b = 0; b < w; b++) raw |= bytes[off + b] << (8 * b);
      raw >>>= 0;
      let val;
      if ((c.type & MSITYPE_STRING) || !(c.type & MSITYPE_VALID)) {
        val = raw === 0 ? null : (str.strings[raw] ?? `<bad string id ${raw}>`);
        if (!(c.type & MSITYPE_VALID) && raw) val = `<stream ${val}>`;
      } else if (raw === 0) val = null;
      else val = w === 2 ? (raw ^ 0x8000) << 16 >> 16 : (raw ^ 0x80000000) | 0;
      rows[r][c.name] = val;
    }
  });
  return rows;
}

function openMsi(path) {
  const streams = readCfb(new Uint8Array(fs.readFileSync(path)));
  const byName = new Map(streams.map(s => [decodeStreamName(s.units), s]));
  const get = name => { const s = byName.get(name); return s ? s.read() : new Uint8Array(0); };
  const str = loadStrings(get('!_StringPool'), get('!_StringData'));
  const colSchema = [
    { name: 'Table', type: MSITYPE_VALID | MSITYPE_STRING | 64 },
    { name: 'Number', type: MSITYPE_VALID | 2 },
    { name: 'Name', type: MSITYPE_VALID | MSITYPE_STRING | 64 },
    { name: 'Type', type: MSITYPE_VALID | 2 },
  ];
  const tables = new Map();
  for (const row of readTable(get('!_Columns'), colSchema, str)) {
    if (!tables.has(row.Table)) tables.set(row.Table, []);
    tables.get(row.Table).push({ name: row.Name, number: row.Number, type: row.Type & 0xffff });
  }
  for (const cols of tables.values()) cols.sort((a, b) => a.number - b.number);
  return {
    streams: [...byName.entries()].map(([name, s]) => ({ name, size: s.size })),
    tables,
    rows: name => { const cols = tables.get(name); if (!cols) throw new Error(`no table ${name}`); return readTable(get('!' + name), cols, str); },
    stream: get,
  };
}

function summaryInfo(bytes) {
  if (bytes.length < 48) return {};
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const secOff = d.getUint32(44, true);
  const count = d.getUint32(secOff + 4, true);
  const names = { 1: 'Codepage', 2: 'Title', 3: 'Subject', 4: 'Author', 5: 'Keywords', 6: 'Comments', 7: 'Template', 8: 'LastAuthor', 9: 'RevisionNumber', 14: 'PageCount', 15: 'WordCount', 18: 'AppName', 19: 'Security' };
  const out = {};
  for (let i = 0; i < count; i++) {
    const id = d.getUint32(secOff + 8 + i * 8, true);
    const at = secOff + d.getUint32(secOff + 12 + i * 8, true);
    const type = d.getUint32(at, true);
    let val;
    if (type === 30) { const n = d.getUint32(at + 4, true); val = Buffer.from(bytes.subarray(at + 8, at + 8 + n)).toString('latin1').replace(/\0+$/, ''); }
    else if (type === 2) val = d.getInt16(at + 4, true);
    else if (type === 3) val = d.getInt32(at + 4, true);
    else val = `<type ${type}>`;
    out[names[id] || `pid${id}`] = val;
  }
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  const opt = k => { const a = args.find(x => x === `--${k}` || x.startsWith(`--${k}=`)); return a === undefined ? undefined : (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true); };
  if (!file) { console.error('usage: node tools/msi-tables.js <file.msi> [--table=NAME [--where=Col=Val,...]] [--streams] [--summary]'); process.exit(2); }
  const msi = openMsi(file);
  if (opt('streams')) for (const s of msi.streams) console.log(`${String(s.size).padStart(9)}  ${s.name}`);
  else if (opt('summary')) {
    const si = msi.streams.find(s => s.name.endsWith('SummaryInformation') && !s.name.includes('Document'));
    console.log(si ? summaryInfo(msi.stream(si.name)) : 'no SummaryInformation stream');
  } else if (opt('table')) {
    let rows = msi.rows(opt('table'));
    const where = opt('where');
    if (typeof where === 'string') for (const clause of where.split(',')) {
      const [k, ...rest] = clause.split('='); const want = rest.join('=');
      rows = rows.filter(r => String(r[k]) === want);
    }
    const cols = msi.tables.get(opt('table')).map(c => c.name);
    console.log(cols.join('\t'));
    for (const r of rows) console.log(cols.map(c => r[c] === null ? '' : String(r[c])).join('\t'));
    console.error(`${rows.length} row(s)`);
  } else {
    for (const [name, cols] of [...msi.tables.entries()].sort()) {
      let n = '?'; try { n = msi.rows(name).length; } catch { /* schema-only */ }
      console.log(`${String(n).padStart(6)}  ${name} (${cols.map(c => c.name).join(', ')})`);
    }
  }
}

module.exports = { readCfb, decodeStreamName, openMsi, summaryInfo };
