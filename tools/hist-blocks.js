// Shared block attribution for browser handler-histogram JSON.
//
// A page probe can read the hot-block counters but cannot say which DLL block
// 0x00a983a5 is in -- `wine.moduleBases` gives the load bases and the PE's own
// preferred base, and turning one into `jgl.dll+0x100153a5` is this file.
// tools/browser-handler-hist.js and tools/hot-loop-census.js both need it, so
// it lives here rather than being written twice and drifting.

'use strict';

// `wine.moduleBases` stores each DLL under both its bare name and its .dll
// name; one entry per distinct base, or every row is printed twice.
function moduleList(hist, exeBase) {
  const mods = [];
  const seen = new Set();
  for (const [name, pair] of Object.entries(hist.mods || {})) {
    const [base, origBase] = pair;
    if (!base || seen.has(base)) continue;
    seen.add(base);
    mods.push({ name: name.includes('.') ? name : name + '.dll', base, origBase });
  }
  mods.push({ name: 'exe', base: exeBase, origBase: exeBase });
  mods.sort((a, b) => a.base - b.base);
  return mods;
}

// Highest base at or below the address wins, which is why the list is sorted.
function makeAttributor(hist, exeBase) {
  const mods = moduleList(hist, exeBase);
  return (addr) => {
    let hit = null;
    for (const m of mods) { if (addr >= m.base) hit = m; else break; }
    if (!hit) return { name: '?', va: addr };
    return { name: hit.name, va: (addr - hit.base + hit.origBase) >>> 0 };
  };
}

// [{ addr, hits, mod, va }] for every block the probe returned.
function attributeBlocks(hist, exeBase) {
  const attribute = makeAttributor(hist, exeBase);
  return (hist.blocks || []).map(([hex, hits]) => {
    const addr = parseInt(hex, 16) >>> 0;
    const a = attribute(addr);
    return { addr, hits, mod: a.name, va: a.va };
  });
}

// profile-web-frames.js prints the probe's JSON as one `report-eval: {...}`
// line inside its own log, so the natural thing to do -- redirect the whole
// run to a file -- produces something that is not JSON. Accept both, rather
// than making every caller remember to filter the log first.
function readHist(file) {
  const text = require('fs').readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    const line = text.split('\n').find(l => l.startsWith('report-eval: '));
    if (!line) {
      throw new Error(`${file} is neither probe JSON nor a profile-web-frames ` +
        `log carrying a "report-eval:" line (${err.message})`);
    }
    return JSON.parse(line.slice('report-eval: '.length));
  }
}

// Handler names come from the `(elem ...)` list in src/02-thread-table.wat, so
// they cannot drift from a renumber. Lived in browser-handler-hist.js until
// tools/ctl-hist-series.js needed the same mapping; this file is the one that
// exists so block/handler attribution is not written twice.
function handlerNames() {
  const fs = require('fs');
  const path = require('path');
  const names = [];
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', '02-thread-table.wat'), 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const m = line.match(/^\s*(\$[^\s()]+).*;;\s*(\d+)(?::\s*(.*))?$/);
    if (!m) continue;
    const id = parseInt(m[2], 10);
    if (!Number.isFinite(id)) continue;
    names[id] = m[3] ? `${m[1]}: ${m[3].trim()}` : m[1];
  }
  return names;
}

// A tools/ctl-hist-series.js .ndjson holds ONE WINDOW PER LINE, and its blocks
// arrive already attributed as `Storm.dll+0x150338a0` -- the original VA, not a
// runtime address, because the series tool resolved them against the run log at
// collection time. hot-loop-census.js was written for one probe JSON per file,
// so without this the two tools that exist for the same question do not
// connect: the series is what produces several windows, and the census is what
// reads several windows. Returning an ARRAY from one file is the whole fix.
function parseAttributedBlocks(blocks) {
  return (blocks || []).map(([label, hits]) => {
    const m = /^(.*)\+(0x[0-9a-fA-F]+)$/.exec(label);
    if (!m) {
      const addr = parseInt(label, 16) >>> 0;
      return { addr, hits, mod: 'exe', va: addr };
    }
    const va = parseInt(m[2], 16) >>> 0;
    return { addr: va, hits, mod: m[1], va };
  });
}

// Which of the two block forms this window carries. The probe emits raw
// runtime addresses as hex (`"f2a0f0"`); ctl-hist-series has already resolved
// its own to `Storm.dll+0x150338a0`. Deciding this on the BLOCKS and not on
// how many lines the file has matters: a one-window series is a real case, and
// running pre-attributed labels through parseInt(.,16) yields NaN for every
// block, which collapses the whole window into a single `?+0x0` region sitting
// at a plausible-looking share. That is a wrong answer that looks like a right
// one, so it is decided by shape here and never guessed.
function isAttributed(blocks) {
  return Array.isArray(blocks) && blocks.length > 0
    && typeof blocks[0][0] === 'string' && /\+0x[0-9a-fA-F]+$/.test(blocks[0][0]);
}

function windowFrom(hist, label, exeBase) {
  return {
    label,
    blocks: isAttributed(hist.blocks)
      ? parseAttributedBlocks(hist.blocks)
      : attributeBlocks(hist, exeBase),
    ops: hist.ops || 0,
    blockHits: hist.blockHits || 0,
    distinct: hist.distinct || 0,
    hist,
  };
}

// Every window in a file, whatever the file is: a single probe JSON, a
// profile-web-frames log carrying one, or an .ndjson series carrying many.
function readWindows(file, exeBase) {
  const text = require('fs').readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.trim().startsWith('{'));
  if (lines.length > 1) {
    const out = [];
    for (const line of lines) {
      let w;
      try { w = JSON.parse(line); } catch (_) { continue; }
      if (!w || !Array.isArray(w.blocks)) continue;
      out.push(windowFrom(w, w.label || `t+${w.elapsed}s`, exeBase));
    }
    if (out.length > 1) return out;
  }
  const hist = readHist(file);
  return [windowFrom(hist, hist.label || (hist.elapsed != null
    ? `t+${hist.elapsed}s` : file), exeBase)];
}

module.exports = {
  moduleList, makeAttributor, attributeBlocks, readHist, handlerNames,
  parseAttributedBlocks, readWindows, isAttributed,
};
