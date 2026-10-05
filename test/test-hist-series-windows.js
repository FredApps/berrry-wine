#!/usr/bin/env node
'use strict';

// tools/ctl-hist-series.js writes a SERIES (one window per ndjson line) and
// tools/hot-loop-census.js exists to read several windows, but the census was
// written for one probe JSON per file, so the two tools did not connect.
// hist-blocks.readWindows() is the join. Two properties matter:
//
//   1. A series file yields one window PER LINE, not one window.
//   2. Which block form a window carries is decided by the BLOCKS, not by how
//      many lines the file has. The probe emits raw runtime hex; the series
//      tool has already resolved its own to `Storm.dll+0x150338a0`. Running
//      pre-attributed labels through parseInt(.,16) gives NaN for every block,
//      which collapses a whole window into one `?+0x0` region at a plausible
//      share -- a wrong answer that looks exactly like a right one. A
//      one-window series is a real case, so line count cannot be the test.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readWindows, isAttributed, parseAttributedBlocks } = require('../tools/hist-blocks.js');

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-series-'));
const win = (i, blocks) => JSON.stringify({
  i, elapsed: i * 60, ops: 1000 * i, blockHits: 100 * i, distinct: 7, blocks,
});

// ---- shape detection -------------------------------------------------------
check(isAttributed([['Storm.dll+0x150338a0', 5]]), 'module+0xVA labels are attributed');
check(isAttributed([['exe+0x401000', 5]]), 'exe+0xVA counts as attributed');
check(!isAttributed([['f2a0f0', 5]]), 'bare runtime hex is NOT attributed');
check(!isAttributed([]), 'an empty block list is not attributed');

const parsed = parseAttributedBlocks([['ijl15.dll+0x60027c00', 9]]);
check(parsed[0].mod === 'ijl15.dll' && parsed[0].va === 0x60027c00 && parsed[0].hits === 9,
  'an attributed label parses into module and original VA');

// ---- a series yields one window per line ------------------------------------
const seriesFile = path.join(dir, 'series.ndjson');
fs.writeFileSync(seriesFile, [
  win(1, [['Game.dll+0x6f4a4220', 50], ['Storm.dll+0x15033ce0', 30]]),
  win(2, [['ijl15.dll+0x60027c00', 90]]),
  win(3, [['Game.dll+0x6f4a4220', 10]]),
].join('\n') + '\n');

const windows = readWindows(seriesFile, 0x400000);
check(windows.length === 3, `a 3-line series is 3 windows, got ${windows.length}`);
check(windows[1].blocks[0].mod === 'ijl15.dll', 'series blocks keep their module');
check(windows[1].blocks[0].va === 0x60027c00, 'series blocks keep their original VA');
check(windows[0].label === 't+60s' && windows[2].label === 't+180s',
  'each window is labelled by its elapsed time');
check(windows[1].ops === 2000 && windows[1].blockHits === 200,
  'per-window totals survive the read');

// ---- ONE window is still read as attributed --------------------------------
// The regression this guards: with a single line, the old code fell through to
// readHist + attributeBlocks and produced one `?+0x0` region.
const oneFile = path.join(dir, 'one.json');
fs.writeFileSync(oneFile, win(1, [['Game.dll+0x6f4a4220', 50], ['Storm.dll+0x15033ce0', 30]]));
const one = readWindows(oneFile, 0x400000);
check(one.length === 1, 'a one-window file is one window');
check(one[0].blocks.every(b => b.mod !== '?' && Number.isFinite(b.va)),
  'a one-window series is attributed by shape, not collapsed into ?+0x0');
check(one[0].blocks[0].mod === 'Game.dll', 'the single window keeps its module');

// ---- a raw probe JSON still works -------------------------------------------
const probeFile = path.join(dir, 'probe.json');
fs.writeFileSync(probeFile, JSON.stringify({
  ops: 5, blockHits: 5, distinct: 1, blocks: [['400100', 5]], mods: {},
}));
const probe = readWindows(probeFile, 0x400000);
check(probe.length === 1, 'a raw probe JSON is one window');
check(Number.isFinite(probe[0].blocks[0].va), 'raw hex blocks still attribute');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`PASS test-hist-series-windows.js (${checks} checks)`);
