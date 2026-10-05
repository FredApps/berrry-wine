#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { RUNTIME_LOG_KEY, createPageSettings } = require('../lib/page-settings');
const { hasPageScript } = require('./browser-runtime-scripts');

const ROOT = path.join(__dirname, '..');
const hostSource = fs.readFileSync(path.join(ROOT, 'host.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const consoleLines = [];
const logNodes = [];
const logElement = {
  childNodes: logNodes,
  appendChild(node) { logNodes.push(node); },
  removeChild(node) { logNodes.splice(logNodes.indexOf(node), 1); },
  scrollHeight: 12,
  scrollTop: 0,
};
const runtimeLogToggle = { checked: true };
const preferences = new Map();
const context = {
  console: { log: message => consoleLines.push(message) },
  window: { location: { search: '' } },
  document: {
    getElementById: id => id === 'log' ? logElement :
      (id === 'runtime-log-toggle' ? runtimeLogToggle : null),
    createTextNode: text => ({ text }),
  },
};
const settings = createPageSettings({
  window: context.window,
  document: context.document,
  storage: {
    getItem: key => preferences.has(key) ? preferences.get(key) : null,
    setItem: (key, value) => preferences.set(key, value),
  },
  getRenderer: () => null,
});
vm.runInNewContext(hostSource + '\n;globalThis.WineAssembly = WineAssembly;', context);

const wine = new context.WineAssembly();
wine.logToUI('enabled');
assert.deepStrictEqual(consoleLines, ['enabled'], 'enabled runtime logging reaches the console');
assert.strictEqual(logNodes.length, 1, 'enabled runtime logging reaches the debug log pane');
assert.strictEqual(logNodes[0].text, 'enabled\n', 'the debug log preserves line boundaries');

settings.setRuntimeLogging(false);
wine.logToUI('disabled');
assert.deepStrictEqual(consoleLines, ['enabled'], 'disabled runtime logging skips the console immediately');
assert.strictEqual(logNodes.length, 1, 'disabled runtime logging skips DOM writes immediately');
assert.strictEqual(runtimeLogToggle.checked, false);
assert.strictEqual(preferences.get(RUNTIME_LOG_KEY), '0');

settings.setRuntimeLogging(true);
wine.logToUI('restored');
assert.deepStrictEqual(consoleLines, ['enabled', 'restored'], 'runtime logging can be restored without relaunching');
assert.strictEqual(logNodes.length, 2, 'restored runtime logging resumes DOM writes');
assert.strictEqual(runtimeLogToggle.checked, true);
assert.strictEqual(preferences.get(RUNTIME_LOG_KEY), '1');

assert(indexSource.includes('id="runtime-log-toggle"'), 'the debug toolbar exposes the runtime log checkbox');
assert(indexSource.includes('onchange="setRuntimeLogging(this.checked)"'), 'the checkbox updates logging immediately');
assert(hasPageScript('lib/page-settings.js'), 'the page loads the runtime preference controller');
assert(hasPageScript('host.js'), 'the browser graph centrally versions host.js');
assert(indexSource.includes("window.WINE_SOURCE_VERSION = String(window.WINE_BUILD || 'dev')") &&
  hostSource.includes("static SOURCE_VERSION = String(globalThis.WINE_SOURCE_VERSION || 'dev')"),
  'the page and browser host consume the same build-info cache identity');

console.log('PASS  runtime logging checkbox gates console and DOM output immediately');
