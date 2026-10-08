#!/usr/bin/env node
'use strict';

// A UE1 renderer is listed from its <Name>Drv.int and loaded from
// C:\System\<Name>Drv.dll inside the guest. The CLI quietly finds an unmounted
// DLL on the host disk beside the exe; the page cannot, so a renderer whose
// .int is mounted without its .dll fails only in the browser. Deus Ex on
// GlideDrv did exactly that: "Assertion failed: RenDev [WinViewport.cpp:345]"
// and back to the desktop, while the same registry entry played its intro on
// the CLI. Every registry app that mounts a *Drv.int must mount the DLL too.

const assert = require('assert');
const path = require('path');
const { APPS } = require('../lib/apps');

const base = p => String(p || '').split(/[\\/]/).pop().toLowerCase();

let checked = 0;
for (const [id, app] of Object.entries(APPS)) {
  const mounted = new Set();
  for (const dll of app.dlls || []) mounted.add(base(typeof dll === 'string' ? dll : dll && dll.url));
  for (const file of app.files || []) {
    if (typeof file === 'string') { mounted.add(base(file)); continue; }
    if (!file) continue;
    for (const p of [file.vfsPath, ...(file.vfsPaths || []), file.url]) if (p) mounted.add(base(p));
  }
  const drivers = [...mounted].filter(n => /drv\.int$/.test(n) && n !== 'windrv.int');
  for (const int of drivers) {
    const dll = int.replace(/\.int$/, '.dll');
    assert(mounted.has(dll), `${id}: ${int} is mounted but ${dll} is not -- the renderer fails in the page`);
    checked++;
  }
}
assert(checked >= 6, `expected Deus Ex's renderer drivers to be checked, saw ${checked}`);
console.log(`PASS  UE1 renderer drivers: ${checked} mounted *Drv.int files all have their DLL mounted`);
