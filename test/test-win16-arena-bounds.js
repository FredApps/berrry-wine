#!/usr/bin/env node
'use strict';

// The Win16 selector arena is addressed through the direct g2w window (an NE
// task runs with image_base 0), one 64KB slot per selector index from
// WIN16_ARENA through the hidden handle page at WIN16_SEG_MAX. Every byte of
// it must be guest memory. The region allocator packs the window tables into
// the gap just past GUEST_BASE, so an arena that runs past GUEST_BASE's end
// hands the guest selectors whose bytes are CLIENT_RECT and OWNER_TABLE: with
// WIN16_SEG_MAX at 959, Civilization II's City View DIB section got selector
// 944, and its pixels became every window's owner and client rectangle.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const RegionMap = require('../lib/region-map.generated.js');

const header = fs.readFileSync(path.join(__dirname, '..', 'src', '01-header.wat'), 'utf8');
const constant = name => {
  const match = header.match(new RegExp(`\\(global \\$${name}\\s+i32 \\(i32\\.const (0x[0-9A-Fa-f]+|\\d+)\\)\\)`));
  assert(match, `${name} is an immutable i32 constant in src/01-header.wat`);
  return Number(match[1]);
};

const arena = constant('WIN16_ARENA');
const segMax = constant('WIN16_SEG_MAX');
const guest = RegionMap.REGIONS.GUEST_BASE;
const start = RegionMap.g2w(arena, 0);
const end = RegionMap.g2w(arena + segMax * 0x10000, 0) + 0x10000;

assert.strictEqual(start, guest.base + arena, 'the arena is reached through the direct window');
assert(end <= guest.end,
  `the arena through its hidden page (slot ${segMax}) ends at 0x${end.toString(16)}, ` +
  `past GUEST_BASE's end 0x${guest.end.toString(16)}`);

const overlapping = Object.values(RegionMap.REGIONS).filter(region =>
  region.name !== 'GUEST_BASE' && region.within !== 'GUEST_BASE' &&
  region.size > 0 && region.base < end && region.end > start);
assert.deepStrictEqual(overlapping.map(region => region.name), [],
  'no emulator region shares bytes with a Win16 selector');

console.log(`PASS  Win16 arena 0x${start.toString(16)}-0x${end.toString(16)} ` +
  `(${segMax} slots) stays inside GUEST_BASE`);
