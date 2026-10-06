#!/usr/bin/env node
'use strict';

// How does each registry game read the mouse, and what does the page give it?
//
//   node tools/mouse-model-census.js [--apps=a,b] [--desktop] [--json] [--all]
//
// The page has two mouse protocols. ABSOLUTE (the default) moves the guest's
// Win32 cursor to the pointer's position. RELATIVE (`relativeMouse: true` in
// lib/apps.js) takes Pointer Lock on the first click and feeds movementX/Y
// deltas, which is what a game that captures the mouse needs: one that reads
// DirectInput mouse counts, or one that recentres the cursor with SetCursorPos
// every frame and reads the distance from the centre (Quake II, Unreal,
// Anachronox). Fed absolute positions, a recentring game pins its cursor in a
// corner; a DirectInput game stops turning when the host pointer hits the
// edge of the page. On a phone the same flag selects the virtual trackpad
// (`mobileTouch` overrides it).
//
// This reads every PE module an app mounts (gfx-app-census.js's set) for the
// static evidence of each model, prints what the app is configured to get
// today, and a suggested default. STATIC REACH IS NOT USE: a DirectInput import
// may only read the keyboard (Blood II's EnumDevices route names no mouse GUID
// at all), and SetCursorPos may be a one-off warp rather than a recentring
// loop. The suggestion column says how strong the evidence is; the runtime
// signals that settle it are in docs/mouse-model-audit.md.

const fs = require('fs');
const { APPS, DESKTOP_APPS } = require('../lib/apps.js');
const { appModules, hasGuid } = require('./gfx-app-census.js');

// GUID_SysMouse {6F1D2B60-D5A0-11CF-BFC7-444553540000} as four LE dwords.
const GUID_SYSMOUSE = [0x6F1D2B60, 0x11CFD5A0, 0x4544C7BF, 0x00005453];
const NAMES = {
  dinput: ['DirectInputCreateA', 'DirectInputCreateW', 'DirectInputCreateEx', 'DirectInput8Create', 'DirectInputCreate'],
  setCursorPos: ['SetCursorPos'],
  clipCursor: ['ClipCursor'],
  getCursorPos: ['GetCursorPos'],
  showCursor: ['ShowCursor'],
  setCapture: ['SetCapture'],
  rawInput: ['RegisterRawInputDevices', 'GetRawInputData'],
};

function scan(app) {
  const ev = { modules: 0, sysMouse: false };
  for (const k of Object.keys(NAMES)) ev[k] = false;
  for (const abs of appModules(app)) {
    let buf;
    try { buf = fs.readFileSync(abs); } catch { continue; }
    if (buf.length < 64 || buf.readUInt16LE(0) !== 0x5a4d) continue;
    ev.modules++;
    for (const [k, names] of Object.entries(NAMES)) {
      if (!ev[k] && names.some(n => buf.indexOf(n, 0, 'latin1') >= 0)) ev[k] = true;
    }
    if (!ev.sysMouse && hasGuid(buf, GUID_SYSMOUSE)) ev.sysMouse = true;
  }
  return ev;
}

function current(app) {
  const parts = [app.relativeMouse === true ? 'relative' : 'absolute'];
  if (app.mobileTouch) parts.push(`touch=${app.mobileTouch}`);
  if (app.hideHostCursor) parts.push('hideCursor');
  return parts.join(' ');
}

// Evidence -> model, strongest first.
function model(ev) {
  if (ev.sysMouse) return { model: 'DI-mouse', why: 'GUID_SysMouse', suggest: 'relative' };
  if (ev.rawInput) return { model: 'raw-input', why: 'RegisterRawInputDevices', suggest: 'relative' };
  if (ev.setCursorPos && ev.clipCursor) return { model: 'recentre?', why: 'SetCursorPos+ClipCursor', suggest: 'relative?' };
  if (ev.dinput && ev.setCursorPos) return { model: 'DI/recentre?', why: 'DirectInput+SetCursorPos', suggest: 'relative?' };
  if (ev.setCursorPos) return { model: 'warp/recentre?', why: 'SetCursorPos', suggest: 'runtime' };
  if (ev.dinput) return { model: 'DI (kbd?)', why: 'DirectInput, no mouse GUID', suggest: 'runtime' };
  if (ev.getCursorPos || ev.showCursor) return { model: 'absolute', why: ev.getCursorPos ? 'GetCursorPos' : 'ShowCursor', suggest: 'absolute' };
  return { model: 'absolute', why: 'window messages', suggest: 'absolute' };
}

function main(argv) {
  const flag = n => argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1];
  const only = flag('apps')?.split(',');
  let ids = Object.keys(APPS);
  if (argv.includes('--desktop')) ids = ids.filter(id => DESKTOP_APPS.includes(id));
  if (only) ids = ids.filter(id => only.includes(id));
  const rows = [];
  for (const id of ids) {
    const app = APPS[id];
    const ev = scan(app);
    if (!ev.modules) continue;
    const m = model(ev);
    const cur = current(app);
    const mismatch = (m.suggest.startsWith('relative') && app.relativeMouse !== true) ||
      (m.suggest === 'absolute' && app.relativeMouse === true);
    rows.push({ id, ...m, current: cur, mismatch, evidence: ev });
  }
  const show = argv.includes('--all') ? rows : rows.filter(r => r.model !== 'absolute' || r.current !== 'absolute');
  if (argv.includes('--json')) { console.log(JSON.stringify(rows, null, 1)); return 0; }
  const W = [26, 15, 26, 30, 10];
  const line = cells => cells.map((c, i) => String(c).padEnd(W[i]).slice(0, W[i])).join(' | ');
  console.log(line(['game', 'mouse model', 'static evidence', 'page today', 'suggest']));
  console.log(W.map(w => '-'.repeat(w)).join('-+-'));
  for (const r of show.sort((a, b) => (b.mismatch - a.mismatch) || a.model.localeCompare(b.model) || a.id.localeCompare(b.id))) {
    console.log(line([r.id + (r.mismatch ? ' *' : ''), r.model, r.why, r.current, r.suggest]));
  }
  const by = {};
  for (const r of rows) by[r.model] = (by[r.model] || 0) + 1;
  console.log(`\n${rows.length} apps scanned (${show.length} shown; --all for the plain-absolute rest).`);
  console.log('by model: ' + Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', '));
  console.log(`* = configured default disagrees with the static suggestion (${rows.filter(r => r.mismatch).length} apps)`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { scan, model };
