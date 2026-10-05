#!/usr/bin/env node
'use strict';

// App-specific pointer corrections belong to the app registry. The shared
// renderer only understands the declarative shape and keeps one policy per
// process, so launching a second app cannot change the first app's input.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { APPS } = require('../lib/apps');
const { installInputHandlers } = require('../lib/renderer-input');

class RendererProbe {}
installInputHandlers(RendererProbe);

const winampHooks = APPS.winamp.inputHooks;
assert(winampHooks && Array.isArray(winampHooks.pointerSnap),
  'Winamp owns a declarative pointer-snap policy');
assert.strictEqual(APPS.winamp_mod.inputHooks, winampHooks,
  'both Winamp media fixtures share the same measured input policy');

const renderer = new RendererProbe();
renderer.setInputHooks(1001, winampHooks);

const equalizer = {
  title: 'Winamp Equalizer', processId: 1001,
  x: 100, y: 50, w: 550, h: 232,
};
assert.deepStrictEqual(renderer._applyPointerInputHooks(equalizer, 122, 82, 0),
  { x: 152, y: 98, snapped: true },
  'a click in the scaled ON artwork lands on its measured native centre');
assert.deepStrictEqual(renderer._applyPointerInputHooks(equalizer, 300, 150, 0),
  { x: 300, y: 150, snapped: false },
  'points outside configured hit rectangles remain exact');
assert.deepStrictEqual(renderer._applyPointerInputHooks(equalizer, 122, 82, 2),
  { x: 122, y: 82, snapped: false },
  'an unlisted mouse button is not corrected');
assert.deepStrictEqual(renderer._applyPointerInputHooks(
  { ...equalizer, processId: 1002 }, 122, 82, 0),
  { x: 122, y: 82, snapped: false },
  'another process cannot inherit Winamp input behavior');

const genericHooks = {
  pointerSnap: [{
    windowTitle: 'Fixture', nativeSize: [10, 10], buttons: [7],
    targets: [{ hit: [1, 2, 5, 6], point: [3, 4] }],
  }],
};
renderer.setInputHooks('fixture-owner', genericHooks);
assert.deepStrictEqual(renderer._applyPointerInputHooks({
  title: 'Fixture', wasm: 'fixture-owner', x: 4, y: 8, w: 20, h: 30,
}, 8, 17, 7), { x: 10, y: 20, snapped: true },
'the interpreter handles arbitrary declarative titles, sizes, buttons and targets');

renderer.setInputHooks(1001, null);
assert.deepStrictEqual(renderer._applyPointerInputHooks(equalizer, 122, 82, 0),
  { x: 122, y: 82, snapped: false },
  'process teardown removes its policy');

const root = path.join(__dirname, '..');
const rendererSource = fs.readFileSync(path.join(root, 'lib', 'renderer-input.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(root, 'lib', 'browser-shell.js'), 'utf8');
const cliSource = fs.readFileSync(path.join(root, 'test', 'run.js'), 'utf8');
assert(!rendererSource.includes('Winamp Equalizer') && !rendererSource.includes('_snapWinamp'),
  'the generic renderer contains no Winamp identity or helper');
assert(shellSource.includes('sharedRenderer.setInputHooks(wine.processId, app.inputHooks || null)'),
  'the browser registers app input policy under its process owner');
assert(shellSource.includes('sharedRenderer.setInputHooks(wine.processId, null)'),
  'the browser unregisters process input policy on every stop path');
assert(!shellSource.includes('function autoRunSliceFor'),
  'browser scheduling calls the registry resolver without a redundant wrapper');
assert(cliSource.includes(
  'renderer.setInputHooks(instance, (ASSET_ENTRY && ASSET_ENTRY.inputHooks) || null)'),
  'the CLI keys app input policy by the instance used by renderer windows');
assert(!cliSource.includes('renderer.setInputHooks(1000,'),
  'the CLI does not key hooks by a process id absent from its renderer windows');

console.log('PASS app registry owns process-scoped declarative input hooks');
