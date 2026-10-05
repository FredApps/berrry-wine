#!/usr/bin/env node
// The auxiliary COM wrapper pool must be able to hold one alternate view for
// every DX object that can be live at once.
//
// WHY THIS IS A GATE AND NOT A TUNING KNOB
// $dx_get_wrapper_for_vtbl_locked does not degrade gracefully when the pool is
// full. Its miss path writes the requested vtable into the PRIMARY wrapper and
// returns the primary pointer, so QueryInterface hands the caller back the very
// pointer it passed in, now reporting a different interface. The guest keeps
// using its original pointer -- it has no way to know -- and the next method it
// calls is read from whatever vtable happens to be there now.
//
// Measured: Diablo II's Direct3D renderer QueryInterfaces all 5434 of its
// surfaces for IID_IDirect3DTexture2. Past the old 2015-entry pool, each
// surface came back carrying the 6-slot IDirect3DTexture2 vtable, and D2's next
// IDirectDrawSurface::Lock -- vtable slot 25 -- read 0x64 bytes into a 24-byte
// vtable, landed in the next heap block's generated thunks, and dispatched
// IFont_get_Charset. That handler's stdcall epilogue is sized for a different
// method, so the return left EIP at 0 and the main thread was dead from there
// on, with every later batch retiring nothing.
//
// None of that is visible as a failure anywhere: no trap, no unimplemented API,
// no bad return code -- just a wrong interface and, thousands of instructions
// later, a jump to zero. So the sizing relation is asserted here instead.

'use strict';

const assert = require('assert');
const { collect } = require('../tools/wat-globals.js');

const globals = collect();

function value(name) {
  const g = globals.get(name);
  assert(g, `$${name} not found among the constant globals in src/`);
  return g.value >>> 0;
}

const auxMax = value('COM_WRAPPERS_AUX_MAX');
const dxMax = value('DX_MAX');
const auxSize = value('COM_WRAPPERS_AUX_SIZE');

assert(
  auxMax >= dxMax,
  `$COM_WRAPPERS_AUX_MAX (${auxMax}) must be at least $DX_MAX (${dxMax}): every ` +
  'live DX object may be QueryInterface\'d for one alternate vtable, and the ' +
  'exhaustion path rewrites the primary wrapper\'s vtbl in place rather than ' +
  'failing the call.');

// Each entry is [vtbl, slot] = 8 bytes, plus the documented 4-byte tail pad.
const needed = auxMax * 8 + 4;
assert(
  auxSize >= needed,
  `$COM_WRAPPERS_AUX region is ${auxSize} bytes but ${auxMax} entries need ` +
  `${needed} (8 bytes each plus the 4-byte tail pad)`);

console.log(
  `com aux wrapper pool ok: ${auxMax} entries >= $DX_MAX ${dxMax}, ` +
  `region ${auxSize} bytes >= ${needed}`);
