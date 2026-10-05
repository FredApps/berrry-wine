#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  PRESENTATION_CRT_KEY,
  PRESENTATION_DEDITHER_KEY,
  PRESENTATION_SCALE_KEY,
  RUNTIME_LOG_KEY,
  createPageSettings,
  normalize2dScalingMode,
  normalizeCrtEffects,
  normalizeDeditherMode,
} = require('../lib/page-settings');
const { hasPageScript } = require('./browser-runtime-scripts');

const ROOT = path.join(__dirname, '..');
const indexSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert.strictEqual(normalize2dScalingMode('scale2x'), 'scale-auto');
assert.strictEqual(normalize2dScalingMode('scale3x'), 'scale-auto');
assert.strictEqual(normalize2dScalingMode('sharp-hq'), 'sharp-hq');
assert.strictEqual(normalize2dScalingMode('bogus'), 'nearest');
assert.strictEqual(normalizeDeditherMode('checkerboard'), 'mdapt');
assert.strictEqual(normalizeDeditherMode('ordered2'), 'mdapt');
assert.strictEqual(normalizeDeditherMode('bogus'), 'off');
assert.deepStrictEqual(normalizeCrtEffects({ scanlines: 1, mask: 0, glow: 'yes' }), {
  scanlines: true,
  mask: false,
  glow: true,
});

const values = new Map([
  [RUNTIME_LOG_KEY, '1'],
  [PRESENTATION_SCALE_KEY, 'scale2x'],
  [PRESENTATION_DEDITHER_KEY, 'checkerboard'],
  [PRESENTATION_CRT_KEY, JSON.stringify({ scanlines: true, mask: false, glow: true })],
]);
const writes = [];
const storage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) {
    values.set(key, value);
    writes.push([key, value]);
  },
};
const elements = new Map([
  ['runtime-log-toggle', { checked: true }],
  ['presentation-scale-select', { value: 'nearest' }],
  ['presentation-dedither-select', { value: 'off' }],
  ['crt-scanlines-toggle', { checked: false }],
  ['crt-mask-toggle', { checked: false }],
  ['crt-glow-toggle', { checked: false }],
]);
const document = { getElementById: id => elements.get(id) || null };
const pageWindow = { location: { search: '?debug&no-log' } };
const calls = [];
const renderer = {
  setPresentationScaleMode(value) { calls.push(['scale', value]); },
  setPresentationDeditherMode(value) { calls.push(['dedither', value]); },
  setPresentationEffects(value) { calls.push(['crt', value]); },
};
const settings = createPageSettings({
  window: pageWindow,
  document,
  storage,
  getRenderer: () => renderer,
});

assert.strictEqual(pageWindow.WINE_RUNTIME_LOGGING, false,
  '?no-log should override the saved preference for this session');
assert.strictEqual(elements.get('runtime-log-toggle').checked, false);
assert.strictEqual(values.get(RUNTIME_LOG_KEY), '1',
  'the session-only no-log override must not rewrite the preference');
assert.strictEqual(pageWindow.WINE_2D_SCALE_MODE, 'scale-auto');
assert.strictEqual(elements.get('presentation-scale-select').value, 'scale-auto');
assert.strictEqual(pageWindow.WINE_DEDITHER_MODE, 'mdapt');
assert.strictEqual(elements.get('presentation-dedither-select').value, 'mdapt');
assert.deepStrictEqual(pageWindow.WINE_CRT_EFFECTS,
  { scanlines: true, mask: false, glow: true });
assert.strictEqual(elements.get('crt-scanlines-toggle').checked, true);
assert.strictEqual(elements.get('crt-mask-toggle').checked, false);
assert.strictEqual(elements.get('crt-glow-toggle').checked, true);

assert.strictEqual(settings.setRuntimeLogging(true), true);
assert.strictEqual(pageWindow.WINE_RUNTIME_LOGGING, true);
assert.deepStrictEqual(writes.pop(), [RUNTIME_LOG_KEY, '1']);

assert.strictEqual(settings.apply2dScalingMode('unknown'), 'nearest');
assert.strictEqual(pageWindow.WINE_2D_SCALE_MODE, 'nearest');
assert.deepStrictEqual(calls.pop(), ['scale', 'nearest']);
assert.deepStrictEqual(writes.pop(), [PRESENTATION_SCALE_KEY, 'nearest']);

assert.strictEqual(settings.applyDeditherMode('jinc2'), 'jinc2');
assert.strictEqual(pageWindow.WINE_DEDITHER_MODE, 'jinc2');
assert.deepStrictEqual(calls.pop(), ['dedither', 'jinc2']);
assert.deepStrictEqual(writes.pop(), [PRESENTATION_DEDITHER_KEY, 'jinc2']);

elements.get('crt-scanlines-toggle').checked = false;
elements.get('crt-mask-toggle').checked = true;
elements.get('crt-glow-toggle').checked = false;
assert.deepStrictEqual(settings.applyCrtEffects(),
  { scanlines: false, mask: true, glow: false });
assert.deepStrictEqual(pageWindow.WINE_CRT_EFFECTS,
  { scanlines: false, mask: true, glow: false });
assert.deepStrictEqual(calls.pop(), ['crt',
  { scanlines: false, mask: true, glow: false }]);
assert.deepStrictEqual(writes.pop(), [PRESENTATION_CRT_KEY,
  JSON.stringify({ scanlines: false, mask: true, glow: false })]);

assert.doesNotThrow(() => createPageSettings({
  window: {},
  document: { getElementById: () => null },
  storage: {
    getItem() { throw new Error('storage denied'); },
    setItem() { throw new Error('storage denied'); },
  },
  getRenderer: () => null,
}));

assert(hasPageScript('lib/page-settings.js'),
  'the browser runtime graph should load the settings controller');
assert(indexSource.includes('window.setRuntimeLogging = pageSettingsController.setRuntimeLogging'));
assert(indexSource.includes('window.apply2dScalingMode = pageSettingsController.apply2dScalingMode'));
assert(indexSource.includes('window.applyDeditherMode = pageSettingsController.applyDeditherMode'));
assert(indexSource.includes('window.applyCrtEffects = pageSettingsController.applyCrtEffects'));
assert(!indexSource.includes("const PRESENTATION_SCALE_KEY = 'wine-assembly:2d-scale'"),
  'preference implementation should not regress into the page template');

console.log('PASS  page settings normalize, restore, persist, and apply through one controller');
