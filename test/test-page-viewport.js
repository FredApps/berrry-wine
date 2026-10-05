#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPageViewport } = require('../lib/page-viewport');
const { hasPageScript } = require('./browser-runtime-scripts');

const ROOT = path.join(__dirname, '..');
const indexSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

class ClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.values.has(name) : !!force;
    if (on) this.values.add(name); else this.values.delete(name);
    return on;
  }
  toString() { return [...this.values].join(' '); }
}

function makeStyle() {
  const values = new Map();
  return {
    cssText: '',
    display: '',
    setProperty(name, value) { values.set(name, value); },
    removeProperty(name) { values.delete(name); },
    getPropertyValue(name) { return values.get(name) || ''; },
  };
}

function makeElement(id = '') {
  const attributes = new Map();
  const element = {
    id,
    children: [],
    style: makeStyle(),
    title: '',
    textContent: '',
    appendChild(child) { this.children.push(child); child.parentNode = this; },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getBoundingClientRect() { return { height: this._rectHeight || 0 }; },
  };
  element.classList = new ClassList(element);
  Object.defineProperty(element, 'className', {
    get() { return element.classList.toString(); },
  });
  return element;
}

function makeEnvironment(options = {}) {
  const elements = new Map();
  const body = makeElement('body');
  const documentElement = makeElement('html');
  documentElement.scrollHeight = 1256;
  const target = makeElement('screen-wrap');
  const hint = makeElement('page-fullscreen-hint');
  const chip = makeElement('page-fullscreen-exit');
  const theme = makeElement('theme-color');
  theme.setAttribute('content', '#008080');
  elements.set(target.id, target);
  elements.set(hint.id, hint);
  elements.set(chip.id, chip);

  const documentListeners = new Map();
  const document = {
    body,
    documentElement,
    fullscreenElement: null,
    webkitFullscreenElement: null,
    createElement() {
      const node = makeElement();
      node._rectHeight = options.largeViewportHeight === undefined
        ? 710 : options.largeViewportHeight;
      return node;
    },
    getElementById(id) { return elements.get(id) || null; },
    querySelector(selector) {
      return selector === 'meta[name="theme-color"]' ? theme : null;
    },
    addEventListener(name, fn) { documentListeners.set(name, fn); },
  };

  const windowListeners = new Map();
  const viewportListeners = new Map();
  const scrolls = [];
  const timers = [];
  const intervals = [];
  const pageWindow = {
    document,
    innerWidth: options.innerWidth || 390,
    innerHeight: options.innerHeight || 628,
    scrollY: 0,
    location: { search: options.search || '' },
    navigator: {
      userAgent: options.userAgent === undefined
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X)' : options.userAgent,
      platform: options.platform || 'iPhone',
      maxTouchPoints: options.maxTouchPoints === undefined ? 5 : options.maxTouchPoints,
      standalone: !!options.standalone,
    },
    matchMedia(query) {
      return { matches: query === '(display-mode: standalone)' && !!options.standalone };
    },
    visualViewport: {
      addEventListener(name, fn) { viewportListeners.set(name, fn); },
    },
    addEventListener(name, fn) { windowListeners.set(name, fn); },
    scrollTo(x, y) { scrolls.push([x, y]); this.scrollY = y; },
    setTimeout(fn, ms) { timers.push([fn, ms]); return timers.length; },
    setInterval(fn, ms) { intervals.push([fn, ms]); return intervals.length; },
  };

  return {
    body,
    chip,
    document,
    documentElement,
    documentListeners,
    elements,
    hint,
    intervals,
    pageWindow,
    scrolls,
    target,
    theme,
    timers,
    viewportListeners,
    windowListeners,
  };
}

(async () => {
  const env = makeEnvironment();
  const resizes = [];
  const stops = [];
  const exclusiveCalls = [];
  const renderer = {
    _requestedBrowserFullscreen: false,
    _fullscreenDeclined: false,
    _exclusiveFullscreen: false,
    _setExclusiveFullscreen(value) {
      exclusiveCalls.push(value);
      this._exclusiveFullscreen = value;
    },
  };
  let singleApp = true;
  const viewport = createPageViewport({
    window: env.pageWindow,
    document: env.document,
    getRenderer: () => renderer,
    resizeCanvas: () => resizes.push('resize'),
    stopAllApps: () => stops.push('stop'),
    singleApp: () => singleApp,
    getKeyboardController: () => null,
  });

  assert.strictEqual(viewport.browserChromeIsRemovableByScroll(), true);
  viewport.install();
  viewport.install();
  assert(env.windowListeners.has('resize') && env.windowListeners.has('scroll'));
  assert(env.viewportListeners.has('resize'));
  assert(env.documentListeners.has('fullscreenchange') &&
    env.documentListeners.has('webkitfullscreenchange'));

  viewport.enterPageFullscreenIfNoApi();
  assert(env.body.classList.contains('page-fullscreen'));
  assert(env.body.classList.contains('scroll-collapse'));
  assert.strictEqual(env.theme.getAttribute('content'), '#000000');
  assert.strictEqual(renderer._requestedBrowserFullscreen, true);
  assert.strictEqual(renderer._fullscreenDeclined, false);
  assert.deepStrictEqual(env.scrolls.pop(), [0, 0]);
  assert.strictEqual(resizes.length, 1);
  assert.strictEqual(env.timers.length, 1);
  assert.strictEqual(env.timers[0][1], 4000);

  // The absolute 100lvh test recognizes the toolbar collapse. Once acquired,
  // that height is pinned so a later reverse swipe cannot shrink the guest.
  env.pageWindow.innerHeight = 705;
  viewport.scrollCollapseSample();
  assert(env.body.classList.contains('bars-collapsed'));
  assert.strictEqual(env.documentElement.style.getPropertyValue('--pinned-vh'), '705px');
  assert.strictEqual(resizes.length, 2);
  viewport.scrollCollapseSample();
  assert.strictEqual(resizes.length, 2, 'an unchanged collapsed viewport should not resize twice');

  // Rotation invalidates the old height but can still recognize an already
  // collapsed landscape viewport from lvh and resize on the class transition.
  env.pageWindow.innerWidth = 844;
  viewport.scrollCollapseSample();
  assert(env.body.classList.contains('bars-collapsed'));
  assert.strictEqual(resizes.length, 3);

  assert.strictEqual(viewport.exitPageFullscreenFromPinch(), true);
  assert(!env.body.classList.contains('page-fullscreen'));
  assert(!env.body.classList.contains('scroll-collapse'));
  assert.strictEqual(renderer._fullscreenDeclined, true);
  assert.strictEqual(env.theme.getAttribute('content'), '#008080');

  // Renderer-driven release has no event and must not turn a transient guest
  // display-mode drop into permanent denial for its later re-entry.
  renderer._fullscreenDeclined = false;
  renderer._exclusiveFullscreen = true;
  env.body.classList.add('page-fullscreen');
  viewport.exitPageFullscreen();
  assert.strictEqual(renderer._fullscreenDeclined, false);
  assert.deepStrictEqual(exclusiveCalls, [false]);

  // The visible chip means close-app in single-app mode, and only there.
  env.body.classList.add('app-running');
  viewport.syncFullscreenChipLabel();
  assert.strictEqual(env.chip.title, 'Close app');
  let prevented = 0;
  viewport.closeFullscreenChip({
    preventDefault() { prevented++; },
    stopPropagation() { prevented++; },
  });
  assert.deepStrictEqual(stops, ['stop']);
  assert.strictEqual(prevented, 2);

  singleApp = false;
  viewport.syncFullscreenChipLabel();
  assert.strictEqual(env.chip.title, 'Leave full screen');

  // A real browser Fullscreen API remains gesture-gated and gets the exact
  // screen-wrap receiver, while API-less Safari uses the page fallback above.
  let requestThis = null;
  env.target.requestFullscreen = function () {
    requestThis = this;
    return Promise.resolve();
  };
  const beforeApprovalResize = resizes.length;
  await viewport.approveBrowserFullscreen({ preventDefault() {}, stopPropagation() {} });
  assert.strictEqual(requestThis, env.target);
  assert.strictEqual(resizes.length, beforeApprovalResize + 1);

  // Windowed phone games arm the same API-less landscape fallback even though
  // they never make a DirectDraw exclusive-mode transition.
  delete env.target.requestFullscreen;
  singleApp = true;
  env.body.classList.add('app-running');
  env.body.classList.remove('exclusive-fullscreen', 'page-fullscreen');
  env.pageWindow.innerWidth = 844;
  env.pageWindow.innerHeight = 390;
  renderer._fullscreenDeclined = false;
  viewport.syncWindowedPageFullscreen();
  assert(env.body.classList.contains('windowed-phone'));
  assert(env.body.classList.contains('page-fullscreen'));

  const standalone = makeEnvironment({ standalone: true });
  const installedViewport = createPageViewport({
    window: standalone.pageWindow,
    document: standalone.document,
  });
  assert.strictEqual(installedViewport.browserChromeIsRemovableByScroll(), false);
  installedViewport.enterPageFullscreen();
  assert(!standalone.body.classList.contains('scroll-collapse'),
    'home-screen apps have no Safari bars and need no overflow spacer');
  assert.strictEqual(standalone.hint.style.display, 'none');

  const diagnostics = makeEnvironment({ search: '?scroll-debug' });
  createPageViewport({
    window: diagnostics.pageWindow,
    document: diagnostics.document,
  }).install();
  assert.strictEqual(diagnostics.intervals.length, 1);
  diagnostics.intervals[0][0]();
  const box = diagnostics.body.children[0];
  assert(box && /h1256 v628 y0 max628/.test(box.textContent),
    'scroll-debug should keep the live document/viewport/scroll diagnosis');

  assert(hasPageScript('lib/page-viewport.js'),
    'the browser runtime graph should load the viewport controller');
  for (const name of [
    'approveBrowserFullscreen', 'enterPageFullscreenIfNoApi',
    'exitPageFullscreenFromPinch', 'exitPageFullscreen',
    'closeFullscreenChip', 'scrollCollapseSample',
    'syncFullscreenChipLabel', 'syncFullscreenThemeColor',
  ]) {
    assert(indexSource.includes(`window.${name} =`),
      `index.html should preserve the browser-global ${name} API`);
  }
  assert(!indexSource.includes('function largeViewportHeight()'),
    'iOS viewport implementation should not regress into the page template');

  console.log('PASS  page viewport fullscreen, iOS collapse, cleanup, globals and diagnostics');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
