#!/usr/bin/env node
// The on-screen touch controls overlay (lib/touch-controls.js) is the only way
// a phone can press a key, so what is checked here is the key pairing itself:
// a press produces exactly one keydown and its release exactly one keyup, two
// fingers hold two keys independently, a thumb sliding across the dpad swaps
// which arrow is held without ever leaving both down, and teardown puts every
// held key up and unhooks every listener.
//
// It runs against a minimal fake DOM rather than a headless browser because
// the property under test is bookkeeping, not layout: which vk is down after
// which sequence of TouchEvents.

'use strict';

const assert = require('assert');

// --- minimal DOM ------------------------------------------------------------

let liveListeners = 0;

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    style: {},
    className: '',
    _classes: new Set(),
    _handlers: new Map(),
    classList: {
      add: (n) => el._classes.add(n),
      remove: (n) => el._classes.delete(n),
      contains: (n) => el._classes.has(n),
    },
    attributes: {},
    setAttribute(name, value) { el.attributes[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attributes, name)
        ? el.attributes[name] : null;
    },
    innerHTML: '',
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener(type, fn) {
      if (!el._handlers.has(type)) el._handlers.set(type, []);
      el._handlers.get(type).push(fn);
      liveListeners++;
    },
    removeEventListener(type, fn) {
      const list = el._handlers.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) { list.splice(i, 1); liveListeners--; }
    },
    // The dpad reads its own centre out of layout, so a rect is mandatory.
    getBoundingClientRect: () => el._rect || { left: 0, top: 0, width: 0, height: 0 },
    dispatch(type, event) {
      for (const fn of (el._handlers.get(type) || []).slice()) fn(event);
    },
    get firstChild() { return el.children[0] || null; },
  };
  return el;
}

const body = makeEl('body');
const head = makeEl('head');
const wrap = makeEl('div');

global.document = {
  head,
  body,
  createElement: (tag) => makeEl(tag),
  getElementById: (id) => (id === 'screen-wrap' ? wrap : null),
  addEventListener: (...args) => body.addEventListener(...args),
  removeEventListener: (...args) => body.removeEventListener(...args),
};
global.window = Object.assign(makeEl('window'), { innerHeight: 844 });
global.location = { search: '' };

const touchEvent = (changed, active = changed) => ({
  changedTouches: changed,
  touches: active,
  preventDefault() {},
  stopPropagation() {},
});
const touch = (identifier, clientX, clientY) => ({ identifier, clientX, clientY });

// --- the module under test --------------------------------------------------

const TouchControls = require('../lib/touch-controls');

const keys = [];
const renderer = {
  handleKeyDown: (vk) => keys.push(['down', vk]),
  handleKeyUp: (vk) => keys.push(['up', vk]),
};

const LAYOUT = {
  dpad: { pos: 'bl' },
  buttons: [
    { vk: 0x5A, label: 'Z', pos: 'bl' },      // left flipper
    { vk: 0xBF, label: '/', pos: 'br' },      // right flipper
    { vk: 0x71, label: 'F2', pos: 'tr', hold: false },
  ],
};

TouchControls.install({ document: global.document, renderer });
assert.ok(TouchControls.installed, 'overlay installs against the fake document');
assert.strictEqual(wrap.children.length, 1, 'overlay mounts inside #screen-wrap');
assert.strictEqual(TouchControls.el.style.pointerEvents, undefined,
  'the container takes its pointer-events from the stylesheet, not an inline override');

TouchControls.setLayout(LAYOUT);

// Collect the widgets by walking what was built, the way a finger finds them.
const flat = [];
(function walk(node) {
  for (const child of node.children) { flat.push(child); walk(child); }
})(TouchControls.el);
const buttons = flat.filter(el => el.className === 'tc-btn');
const dpad = flat.find(el => el.className === 'tc-dpad');
assert.strictEqual(buttons.length, 3, 'three buttons rendered');
assert.ok(dpad, 'dpad rendered');
// By label, not by document order: the corners are built in whatever order
// the first widget for each asks for one, and the view/keyboard chips claim
// bottom-right before any app button is added.
const byLabel = label => {
  const el = buttons.find(b => b.textContent === label);
  assert.ok(el, `button "${label}" rendered`);
  return el;
};
const btnZ = byLabel('Z');
const btnSlash = byLabel('/');
const btnF2 = byLabel('F2');
dpad._rect = { left: 100, top: 300, width: 132, height: 132 };

// 1. One press, one matching release.
keys.length = 0;
btnZ.dispatch('touchstart', touchEvent([touch(1, 0, 0)]));
assert.deepStrictEqual(keys, [['down', 0x5A]], 'touchstart presses the button vk once');
assert.ok(btnZ.classList.contains('tc-down'), 'a held button shows its pressed state');
btnZ.dispatch('touchend', touchEvent([touch(1, 0, 0)]));
assert.deepStrictEqual(keys, [['down', 0x5A], ['up', 0x5A]],
  'touchend releases the same vk exactly once');
assert.ok(!btnZ.classList.contains('tc-down'), 'the pressed state clears on release');

// 2. Two fingers hold two flippers; releasing one leaves the other down.
keys.length = 0;
btnZ.dispatch('touchstart', touchEvent([touch(10, 0, 0)]));
btnSlash.dispatch('touchstart', touchEvent([touch(11, 0, 0)]));
assert.deepStrictEqual(keys, [['down', 0x5A], ['down', 0xBF]],
  'simultaneous touches hold both flipper keys');
btnZ.dispatch('touchend', touchEvent([touch(10, 0, 0)]));
assert.deepStrictEqual(keys.slice(2), [['up', 0x5A]],
  'releasing one finger must not release the other flipper');
assert.ok(btnSlash.classList.contains('tc-down'), 'the still-held flipper stays down');
btnSlash.dispatch('touchcancel', touchEvent([touch(11, 0, 0)]));
assert.deepStrictEqual(keys.slice(3), [['up', 0xBF]],
  'touchcancel releases the key too — iOS cancels touches on its own');

// 3. hold:false is a tap: down and up inside touchstart.
keys.length = 0;
btnF2.dispatch('touchstart', touchEvent([touch(20, 0, 0)]));
assert.deepStrictEqual(keys, [['down', 0x71], ['up', 0x71]],
  'a hold:false button fires a complete keystroke on press');
btnF2.dispatch('touchend', touchEvent([touch(20, 0, 0)]));
assert.deepStrictEqual(keys.length, 2, 'releasing a hold:false button emits nothing further');

// 4. The dpad swaps the held arrow as the thumb moves. Centre is (166, 366).
const VK_LEFT = 0x25, VK_UP = 0x26, VK_RIGHT = 0x27, VK_DOWN = 0x28;
keys.length = 0;
dpad.dispatch('touchstart', touchEvent([touch(30, 166 + 50, 366)]));
assert.deepStrictEqual(keys, [['down', VK_RIGHT]], 'thumb right of centre holds RIGHT');
dpad.dispatch('touchmove', touchEvent([touch(30, 166, 366 - 50)]));
assert.deepStrictEqual(keys.slice(1), [['up', VK_RIGHT], ['down', VK_UP]],
  'sliding to the top of the pad releases RIGHT and holds UP');
dpad.dispatch('touchmove', touchEvent([touch(30, 166 - 50, 366 - 50)]));
assert.deepStrictEqual(keys.slice(3), [['down', VK_LEFT]],
  'a diagonal adds the second arrow and keeps the first');
dpad.dispatch('touchmove', touchEvent([touch(30, 166 + 2, 366 + 2)]));
assert.deepStrictEqual(keys.slice(4).sort(), [['up', VK_LEFT], ['up', VK_UP]].sort(),
  'inside the dead zone the pad holds nothing');
dpad.dispatch('touchmove', touchEvent([touch(30, 166, 366 + 50)]));
dpad.dispatch('touchend', touchEvent([touch(30, 166, 366 + 50)]));
assert.deepStrictEqual(keys.slice(6), [['down', VK_DOWN], ['up', VK_DOWN]],
  'lifting the thumb releases the direction it was holding');

// A touch that started on the dpad but whose identifier is unknown to it must
// be ignored rather than releasing somebody else's key.
keys.length = 0;
dpad.dispatch('touchend', touchEvent([touch(999, 0, 0)]));
assert.deepStrictEqual(keys, [], 'an unknown touch identifier changes nothing');

// 5. Teardown: every held key goes up and every listener comes off.
keys.length = 0;
btnZ.dispatch('touchstart', touchEvent([touch(40, 0, 0)]));
dpad.dispatch('touchstart', touchEvent([touch(41, 166 + 60, 366)]));
assert.deepStrictEqual(keys, [['down', 0x5A], ['down', VK_RIGHT]],
  'two widgets holding keys at teardown time');
TouchControls.destroy();
assert.deepStrictEqual(keys.slice(2).map(k => k[0]), ['up', 'up'],
  'destroy releases every key still held');
assert.strictEqual(liveListeners, 0, 'destroy removes every listener it added');
assert.strictEqual(wrap.children.length, 0, 'destroy removes the overlay from the DOM');
assert.strictEqual(TouchControls.installed, false, 'destroy marks the overlay uninstalled');

// 6. sync() picks the newest running app that declares a layout, and takes the
//    overlay down when no such app is left.
TouchControls.install({ document: global.document, renderer });
TouchControls.sync([{ name: 'notepad' }, { name: 'pinball', touchControls: LAYOUT }], renderer);
assert.strictEqual(TouchControls.layout, LAYOUT, 'sync adopts the running app layout');
assert.strictEqual(TouchControls.el.style.display, 'block', 'a layout shows the overlay');
// A running app with no declared layout keeps the bare chrome (the keyboard
// pill) but no game controls, so isVisible() -- which the renderer's inset and
// the cursor policy both read as "the game controls are up" -- goes false.
TouchControls.sync([{ name: 'notepad' }], renderer);
assert.notStrictEqual(TouchControls.layout, LAYOUT, 'sync drops the layout when the app closes');
assert.strictEqual(TouchControls.layout.chrome, true, 'and falls back to the bare chrome');
assert(TouchControls.el.classList.contains('tc-chrome'),
  'bare keyboard chrome gets its edge-placement scope');
const touchStyle = head.children.find(el => el.id === 'touch-controls-style');
assert(touchStyle.textContent.includes(
  'padding-right: 4px;'),
  'landscape bare chrome hugs the already inset Safari viewport edge');
assert.strictEqual(TouchControls.isVisible(), false, 'which is not "game controls up"');
// And with nothing running at all, the overlay goes away entirely.
TouchControls.sync([], renderer);
assert.strictEqual(TouchControls.layout, null, 'no app, no layout');
TouchControls.setLayout({ screenAnchored: true, keyboard: true, viewToggle: false });
assert(body.classList.contains('touch-screen-anchored'),
  'Quake-style controls also scope the page Close button');
TouchControls.setLayout(null);
assert(!body.classList.contains('touch-screen-anchored'),
  'the subtle Close scope leaves with the app');
assert(!TouchControls.el.classList.contains('tc-chrome'),
  'chrome edge-placement scope clears with the app');
assert.strictEqual(TouchControls.el.style.display, 'none', 'no layout hides the overlay');
assert.strictEqual(TouchControls.isVisible(), false, 'a hidden overlay is not visible');
TouchControls.destroy();

// 7. The bottom band the renderer reserves. lib/renderer.js pushes the game up
//    by exactly this much, so 0 when there is nothing there is load-bearing:
//    a nonzero reading with the overlay down would shrink every app on a phone.
TouchControls.install({ document: global.document, renderer });
assert.strictEqual(TouchControls.getOccupiedHeight(), 0,
  'no layout means no reserved band');
assert.strictEqual(TouchControls.getOccupiedFraction(), 0,
  'no layout means no reserved fraction');

TouchControls.setLayout({
  dpad: { pos: 'bl', ways: 4 },
  buttons: [{ vk: 0x71, label: 'New game', pos: 'br' }],
});
assert.strictEqual(TouchControls.isVisible(), true, 'a layout shows the overlay');
const bandEstimated = TouchControls.getOccupiedHeight();
// The fake DOM reports no layout, so this is the estimate path: the 140px pad
// plus the 18px bottom padding, and the 58px button in the other corner loses.
assert.strictEqual(bandEstimated, 158,
  'the band is the tallest bottom-corner stack plus its padding');
assert.ok(Math.abs(TouchControls.getOccupiedFraction() - 158 / 844) < 1e-9,
  'the fraction is the band over the overlay height');

// With real rects it measures instead of estimating, and a top-corner widget
// never contributes: it is not in the way of anything below.
TouchControls.el.getBoundingClientRect = () => ({
  left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844,
});
for (const el of TouchControls._widgets) {
  el.getBoundingClientRect = () => ({
    left: 0, top: 700, right: 140, bottom: 840, width: 140, height: 140,
  });
}
assert.strictEqual(TouchControls.getOccupiedHeight(), 144,
  'with layout available the band is measured from the topmost bottom widget');
TouchControls.setLayout({ buttons: [{ vk: 0x71, label: 'New game', pos: 'tl' }] });
// The app's own button is at the top, but the view/keyboard chips ride in the
// bottom-right stack now, so the band is theirs: a 40px row plus the 18px
// bottom padding. They are only weightless when the layout turns them off.
assert.strictEqual(TouchControls.getOccupiedHeight(), 58,
  'a top-corner button reserves only what the chips below it need');
TouchControls.setLayout({
  viewToggle: false, keyboard: false,
  buttons: [{ vk: 0x71, label: 'New game', pos: 'tl' }],
});
assert.strictEqual(TouchControls.getOccupiedHeight(), 0,
  'with no chips either, a top-corner button reserves nothing at the bottom');
TouchControls.destroy();

// 8. In-place zones: pinball's flippers ARE the bottom of the table.
{
  TouchControls.install({ document: global.document, renderer });
  // The overlay box is the page; the app is presented into part of it.
  TouchControls.el.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844,
  });
  let presented = { x: 0, y: 100, w: 390, h: 500 };
  renderer.getPresentedRectClient = () => presented;

  const ZONES = {
    zones: [
      { vk: 0x5A, title: 'Left flipper', rect: { x: 0, y: 0.14, w: 0.5, h: 0.86 } },
      { vk: 0xBF, title: 'Right flipper', rect: { x: 0.5, y: 0.14, w: 0.36, h: 0.86 } },
      { vk: 0x20, title: 'Plunger', rect: { x: 0.86, y: 0.14, w: 0.14, h: 0.86 } },
    ],
    buttons: [{ vk: 0x58, label: 'Nudge', pos: 'bl' }],
  };
  TouchControls.setLayout(ZONES);
  const zones = TouchControls._zones;
  assert.strictEqual(zones.length, 3, 'three zones rendered');
  const px = (v) => parseFloat(v);
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.01, what + ' (' + a + ' vs ' + b + ')');
  near(px(zones[0].style.left), 0, 'the left flipper starts at the app edge');
  near(px(zones[0].style.top), 170, 'a zone is positioned against the PRESENTED rect, not the page');
  near(px(zones[0].style.width), 195, 'the left flipper is half the table');
  near(px(zones[0].style.height), 430, 'and reaches the bottom of it');
  near(px(zones[2].style.left), 335.4, 'the plunger strip hugs the right edge');

  // Both flippers held at once, tracked by identifier like every other widget.
  keys.length = 0;
  zones[0].dispatch('touchstart', touchEvent([touch(50, 10, 400)]));
  zones[1].dispatch('touchstart', touchEvent([touch(51, 300, 400)]));
  assert.deepStrictEqual(keys, [['down', 0x5A], ['down', 0xBF]],
    'two zones held together hold both flippers');
  assert.ok(zones[0]._classes.has('tc-down'), 'a held zone shows its highlight');
  zones[0].dispatch('touchend', touchEvent([touch(50, 10, 400)]));
  assert.deepStrictEqual(keys.slice(2), [['up', 0x5A]],
    'releasing one flipper leaves the other down');
  zones[1].dispatch('touchcancel', touchEvent([touch(51, 300, 400)]));
  assert.deepStrictEqual(keys.slice(3), [['up', 0xBF]],
    'touchcancel releases a zone key too');
  assert.ok(!zones[1]._classes.has('tc-down'), 'the highlight clears on release');

  // A touch the zone never saw is not its business: the game keeps it.
  keys.length = 0;
  zones[0].dispatch('touchend', touchEvent([touch(999, 0, 0)]));
  assert.deepStrictEqual(keys, [], 'an unknown identifier changes nothing');

  // The zoom moved (the bottom inset appeared, or the guest resized): the
  // zones follow the picture rather than staying where they were drawn.
  presented = { x: 40, y: 0, w: 310, h: 400 };
  TouchControls.layoutZones();
  near(px(zones[0].style.left), 40, 'zones follow the presented rect');
  near(px(zones[0].style.top), 56, 'and follow it vertically after an inset changes the fit');
  near(px(zones[0].style.width), 155, 'and rescale with it');

  TouchControls.destroy();
}

// 9. A command button posts WM_COMMAND instead of a key, for a game whose
//    new-game action is a menu item.
{
  const posted = [];
  const win = {
    hwnd: 0x20001, visible: true, isChild: false, zOrder: 5,
    wasm: { exports: { post_message_q: (...a) => posted.push(a) } },
  };
  const cmdRenderer = {
    handleKeyDown() { assert.fail('a command button must not press a key'); },
    handleKeyUp() {},
    windows: { [win.hwnd]: win },
  };
  TouchControls.install({ document: global.document, renderer: cmdRenderer });
  TouchControls.setLayout({ buttons: [{ command: 40001, label: 'Start', pos: 'tl' }] });
  const btn = TouchControls._widgets.find(el => el.className === 'tc-btn');
  btn.dispatch('touchstart', touchEvent([touch(60, 0, 0)]));
  assert.deepStrictEqual(posted, [[0x20001, 0x0111, 40001, 0]],
    'a command button posts WM_COMMAND to the topmost top-level window');
  btn.dispatch('touchend', touchEvent([touch(60, 0, 0)]));
  assert.strictEqual(posted.length, 1, 'releasing it posts nothing further');
  TouchControls.destroy();
}

// 10. The discrete cross pad. A tile game moves one square per KEYSTROKE, so
//     the control has to produce keystrokes -- the continuous pad holds a key
//     and gives such a game exactly one step however long you lean on it.
{
  TouchControls.install({ document: global.document, renderer });
  TouchControls.setLayout({ dpad: { pos: 'bl', ways: 4, style: 'cross' } });
  const pad = TouchControls._widgets.find(el => el.className === 'tc-cross');
  assert.ok(pad, 'a cross-style dpad renders a cross, not the round pad');
  const arrows = pad.children.slice();
  assert.strictEqual(arrows.length, 4, 'the cross pad has four arrows');
  const right = arrows.find(el => el.className.indexOf('tc-right') >= 0);

  // A tap is one complete keystroke, not a held key.
  keys.length = 0;
  right.dispatch('touchstart', touchEvent([touch(70, 0, 0)]));
  assert.deepStrictEqual(keys, [['down', VK_RIGHT], ['up', VK_RIGHT]],
    'a tap on an arrow is one complete keystroke');
  right.dispatch('touchend', touchEvent([touch(70, 0, 0)]));
  assert.strictEqual(keys.length, 2, 'and lifting the finger adds nothing');

  // A hold auto-repeats the way a physical keyboard does.
  keys.length = 0;
  right.dispatch('touchstart', touchEvent([touch(71, 0, 0)]));
  assert.strictEqual(keys.length, 2, 'the hold starts with its first keystroke');
  const entry = TouchControls._touches.get(71);
  assert.ok(entry && entry.repeatTimer, 'a hold arms the repeat delay');
  // Drive the timers rather than waiting on them: the property under test is
  // that a repeat is armed and that releasing disarms it.
  TouchControls._pulse(VK_RIGHT);
  TouchControls._pulse(VK_RIGHT);
  assert.strictEqual(keys.length, 6, 'each repeat is a further complete keystroke');
  right.dispatch('touchend', touchEvent([touch(71, 0, 0)]));
  assert.ok(!entry.repeatTimer && !entry.repeatInterval,
    'releasing disarms the repeat -- a stuck repeat would walk the board on its own');
  TouchControls.destroy();
}

// Quake II's fixed arrows hold movement while another finger fires or aims.
{
  const app = require('../lib/apps').APPS.quake2_demo;
  assert.strictEqual(app.mobileTouch, 'trackpad');
  const mouse = [];
  TouchControls.install({ document: global.document, renderer: {
    ...renderer, _mouseX: 320, _mouseY: 240,
    handleMouseDown: (x, y, b) => mouse.push(['down', b]),
    handleMouseUp: (x, y, b) => mouse.push(['up', b]),
  } });
  TouchControls.setLayout(app.touchControls);
  const pad = TouchControls._widgets.find(el => el.className === 'tc-cross');
  const up = pad.children.find(el => el._tcDir === 'up');
  const right = pad.children.find(el => el._tcDir === 'right');
  const fire = TouchControls._widgets.find(el => el.textContent === 'Fire');
  keys.length = 0;
  up.dispatch('touchstart', touchEvent([touch(170, 0, 0)]));
  right.dispatch('touchstart', touchEvent([touch(171, 0, 0)]));
  fire.dispatch('touchstart', touchEvent([touch(172, 0, 0)]));
  assert.deepStrictEqual(keys, [['down', 0x26], ['down', 0x44], ['down', 0x0D]]);
  assert.deepStrictEqual(mouse, [], 'aiming and firing need no synthetic mouse click');
  assert(!TouchControls._touches.get(170).repeatTimer, 'movement must stay held between frames');
  up.dispatch('touchcancel', touchEvent([touch(170, 0, 0)]));
  assert.deepStrictEqual(keys.at(-1), ['up', 0x26]);
  assert(TouchControls._held.has(0x44), 'cancelling forward preserves strafe');
  TouchControls.releaseAll();
  assert.deepStrictEqual(keys.slice(-2), [['up', 0x44], ['up', 0x0D]]);
  assert.strictEqual(TouchControls._held.size, 0);
  for (const [label, vk] of [['Esc', 0x1B], ['Fire', 0x0D]]) {
    const button = TouchControls._widgets.find(el => el.textContent === label);
    keys.length = 0;
    button.dispatch('touchstart', touchEvent([touch(173, 0, 0)]));
    button.dispatch('touchend', touchEvent([touch(173, 0, 0)]));
    assert.deepStrictEqual(keys, [['down', vk], ['up', vk]], label + ' sends one menu key');
  }
  for (const event of ['touchend', 'touchcancel', 'blur', 'pagehide', 'visibilitychange']) {
    keys.length = 0;
    fire.dispatch('touchstart', touchEvent([touch(174, 0, 0)]));
    if (event === 'visibilitychange') {
      global.document.hidden = true;
      body.dispatch(event, {});
      global.document.hidden = false;
    } else {
      // No target dispatch: canvas capture may stop it reaching the button.
      global.window.dispatch(event, touchEvent([touch(174, 0, 0)], []));
    }
    assert.deepStrictEqual(keys, [['down', 0x0D], ['up', 0x0D]], event + ' releases Fire');
    assert(!fire.classList.contains('tc-down'));
  }
  TouchControls.destroy();
}

// 11. Swipes on the playing field: over the threshold it is a direction and
//     the guest sees no mouse at all; under it, it is still a tap and the
//     guest gets the click, or the menus stop working.
{
  const mouse = [];
  const swipeRenderer = {
    handleKeyDown: (vk) => keys.push(['down', vk]),
    handleKeyUp: (vk) => keys.push(['up', vk]),
    handleMouseDown: (x, y, b) => mouse.push(['down', Math.round(x), Math.round(y), b]),
    handleMouseUp: (x, y, b) => mouse.push(['up', Math.round(x), Math.round(y), b]),
    canvas: {
      width: 640, height: 480,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 240 }),
    },
    getPresentedRectClient: () => ({ x: 0, y: 0, w: 320, h: 240 }),
  };
  TouchControls.install({ document: global.document, renderer: swipeRenderer });
  TouchControls.el.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 320, bottom: 240, width: 320, height: 240,
  });
  TouchControls.setLayout({ swipes: true });
  const field = TouchControls._widgets.find(el => el.className === 'tc-swipe');
  assert.ok(field, 'the swipe field is rendered');
  assert.strictEqual(field.style.width, '320px',
    'and covers the presented app rectangle');

  keys.length = 0;
  mouse.length = 0;
  field.dispatch('touchstart', touchEvent([touch(80, 100, 100)]));
  field.dispatch('touchmove', touchEvent([touch(80, 100, 145)]));
  assert.deepStrictEqual(keys, [['down', VK_DOWN], ['up', VK_DOWN]],
    'a downward flick is one keystroke in that direction');
  field.dispatch('touchmove', touchEvent([touch(80, 100, 200)]));
  assert.strictEqual(keys.length, 2, 'one flick is one keystroke, however far it runs on');
  field.dispatch('touchend', touchEvent([touch(80, 100, 200)]));
  assert.deepStrictEqual(mouse, [],
    'a consumed swipe must not also click -- that would drag across the board');

  keys.length = 0;
  mouse.length = 0;
  field.dispatch('touchstart', touchEvent([touch(81, 100, 100)]));
  field.dispatch('touchmove', touchEvent([touch(81, 104, 103)]));
  field.dispatch('touchend', touchEvent([touch(81, 104, 103)]));
  assert.deepStrictEqual(keys, [], 'a short move is not a swipe');
  assert.deepStrictEqual(mouse, [['down', 208, 206, 0], ['up', 208, 206, 0]],
    'and reaches the guest as a click in canvas coordinates, so menus still work');

  // The swipe field, not the canvas, owns these touches in Rodent. Its second
  // finger must therefore expose the same Fit/Fill and wheel gestures.
  let mode = 'fit';
  const wheel = [];
  swipeRenderer.viewMode = mode;
  swipeRenderer.setViewMode = next => {
    mode = next;
    swipeRenderer.viewMode = next;
    return true;
  };
  swipeRenderer.handleWheel = (x, y, delta) =>
    wheel.push([Math.round(x), Math.round(y), delta]);
  mouse.length = 0;
  field.dispatch('touchstart', touchEvent([touch(82, 100, 100)], [touch(82, 100, 100)]));
  field.dispatch('touchstart', touchEvent([touch(83, 200, 100)],
    [touch(82, 100, 100), touch(83, 200, 100)]));
  field.dispatch('touchmove', touchEvent([touch(82, 70, 100), touch(83, 230, 100)],
    [touch(82, 70, 100), touch(83, 230, 100)]));
  assert.strictEqual(mode, 'zoom', 'spreading two fingers over a swipe field selects Fill');
  field.dispatch('touchend', touchEvent([touch(82, 70, 100)], [touch(83, 230, 100)]));
  field.dispatch('touchend', touchEvent([touch(83, 230, 100)], []));
  assert.deepStrictEqual(mouse, [], 'a field pinch never leaks a guest click');

  field.dispatch('touchstart', touchEvent([touch(84, 100, 100)], [touch(84, 100, 100)]));
  field.dispatch('touchstart', touchEvent([touch(85, 200, 100)],
    [touch(84, 100, 100), touch(85, 200, 100)]));
  field.dispatch('touchmove', touchEvent([touch(84, 100, 130), touch(85, 200, 130)],
    [touch(84, 100, 130), touch(85, 200, 130)]));
  assert.deepStrictEqual(wheel, [[300, 260, 1]],
    'parallel two-finger travel over a swipe field becomes mouse wheel input');
  field.dispatch('touchend', touchEvent([touch(84, 100, 130), touch(85, 200, 130)], []));
  TouchControls.destroy();
}

// 12. The view-mode toggle. The pinch that switches modes is invisible, so the
//     button is what makes the feature findable at all.
{
  let mode = 'fit';
  const modeRenderer = {
    handleKeyDown() {}, handleKeyUp() {},
    get viewMode() { return mode; },
    setViewMode(next) {
      const want = next === 'zoom' ? 'zoom' : 'fit';
      if (want === mode) return false;
      mode = want;
      return true;
    },
  };
  TouchControls.install({ document: global.document, renderer: modeRenderer });
  TouchControls.setLayout({ buttons: [{ vk: 0x71, label: 'New game', pos: 'tl' }] });
  const toggle = TouchControls._widgets.find(el => el.className === 'tc-mode');
  assert.ok(toggle, 'the overlay carries a view-mode toggle');
  // With no crop naming its two states the pill is the corner-bracket icon
  // every media player draws, so what is asserted is the accessible name --
  // and, as before, that it names what a PRESS does, not the mode you are in.
  assert.strictEqual(toggle.attributes['aria-label'], 'switch to Fill view',
    'the label names what a press does, not the mode you are in');
  assert.ok(/M8 3H3v5/.test(toggle.innerHTML), 'brackets point out: it will fill');
  toggle.dispatch('touchstart', touchEvent([touch(90, 0, 0)]));
  assert.strictEqual(mode, 'zoom', 'a press switches the renderer to zoom');
  assert.strictEqual(toggle.attributes['aria-label'], 'switch to Fit view',
    'and the label flips with it');
  assert.ok(/M3 8h5V3/.test(toggle.innerHTML), 'and the brackets turn inward');
  toggle.dispatch('touchend', touchEvent([touch(90, 0, 0)]));
  toggle.dispatch('touchstart', touchEvent([touch(91, 0, 0)]));
  assert.strictEqual(mode, 'fit', 'and a second press switches back');
  TouchControls.destroy();
}

// 13. Where the toggle goes, and what a guest text field does to the layer.
{
  let caret = null;
  const layoutRenderer = {
    handleKeyDown() {}, handleKeyUp() {},
    viewMode: 'fit',
    setViewMode() { return false; },
    mobileCrop: { x: 0, y: 0, w: 1, h: 1 },
    caretRect: () => caret,
    getPresentedRectClient: () => ({ x: 0, y: 6, w: 390, h: 494 }),
  };
  TouchControls.install({ document: global.document, renderer: layoutRenderer });
  TouchControls.el.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 390, bottom: 664, width: 390, height: 664,
  });
  TouchControls.setLayout({ dpad: { pos: 'bl', style: 'cross' }, swipes: true });
  const toggle = TouchControls._widgets.find(el => el.className === 'tc-mode');
  const keyPill = TouchControls._widgets.find(el => el.className === 'tc-key');
  assert.ok(keyPill, 'the keyboard pill rides along with the view toggle');

  // Utility controls live in a phone-anchored row. An empty row in the game
  // corner reserves their height below game buttons without moving the pills
  // when that corner is centred beside a changing picture.
  const chipRow = TouchControls._rows['br:-1'];
  assert.ok(chipRow, 'the game corner keeps a utility spacer');
  assert.strictEqual(chipRow.style.height, '40px');
  assert.strictEqual(chipRow.style.width, '90px');
  assert.strictEqual(TouchControls._utilityRow.parentNode, TouchControls.el,
    'utility row is attached directly to the phone overlay');
  assert.deepStrictEqual(TouchControls._utilityRow.children, [toggle, keyPill]);
  assert.strictEqual(TouchControls._corners.br.children[0], chipRow,
    'spacer remains below game buttons');

  const noInlinePlacement = () => {
    for (const p of [keyPill, toggle]) {
      for (const prop of ['left', 'top', 'position', 'transform', 'opacity']) {
        assert.strictEqual(p.style[prop] || '', '',
          `the ${prop} of a phone-anchored pill is the stylesheet's business`);
      }
    }
  };

  for (const w of TouchControls._widgets) {
    if (w._tcCorner === 'bl') {
      w.getBoundingClientRect = () => ({ left: 18, right: 186, top: 506, bottom: 646, width: 168, height: 140 });
    }
  }
  TouchControls.layoutZones();
  noInlinePlacement();

  // Neither a narrow opening nor a full-screen picture moves them: there is no
  // placement decision left to get wrong.
  layoutRenderer.getPresentedRectClient = () => ({ x: 0, y: 80, w: 390, h: 420 });
  TouchControls.layoutZones();
  noInlinePlacement();
  layoutRenderer.getPresentedRectClient = () => ({ x: 0, y: 0, w: 390, h: 664 });
  TouchControls.layoutZones();
  noInlinePlacement();

  // Board layouts also keep the pills on the phone. A moving New game button
  // must not drag the rarely-used controls during a Fit/Fill repaint.
  TouchControls.setLayout({
    boardLayout: true,
    dpad: { pos: 'bl', style: 'cross' },
    buttons: [{ vk: 0x71, label: 'New game', pos: 'br' }],
  });
  const boardToggle = TouchControls._widgets.find(el => el.className === 'tc-mode');
  const boardKey = TouchControls._widgets.find(el => el.className === 'tc-key');
  const action = TouchControls._widgets.find(el => el.textContent === 'New game');
  action.getBoundingClientRect = () => ({
    left: 257, right: 372, top: 652, bottom: 710, width: 115, height: 58,
  });
  TouchControls.layoutZones();
  for (const p of [boardToggle, boardKey]) {
    assert.strictEqual(p.parentNode, TouchControls._utilityRow,
      'board utilities stay in the phone-anchored row');
    assert.strictEqual(p.style.position || '', '',
      'board utilities have no position derived from the action button');
  }
  assert.strictEqual(TouchControls._rows['br:-1'].style.height, '40px',
    'board action still reserves a bottom utility row');

  // Swapping layouts recreates the utility row without stale placement.
  TouchControls.setLayout({ dpad: { pos: 'bl', style: 'cross' }, swipes: true });
  TouchControls.layoutZones();
  const backRow = TouchControls._rows['br:-1'];
  const backToggle = TouchControls._widgets.find(el => el.className === 'tc-mode');
  const backKey = TouchControls._widgets.find(el => el.className === 'tc-key');
  assert.strictEqual(backRow.style.height, '40px');
  assert.deepStrictEqual(TouchControls._utilityRow.children, [backToggle, backKey],
    'both pills are back in the utility row, view toggle first');
  for (const p of [backToggle, backKey]) {
    assert.strictEqual(p.style.position || '', '',
      'and the board layout leaves no absolute positioning behind');
  }

  // A caret in the guest means a text field is focused. The swipe field must
  // stop taking touches or the tap that puts the caret in the NEXT field --
  // and the gesture iOS needs to open its keyboard -- never lands.
  const field = TouchControls._widgets.find(el => el.className === 'tc-swipe');
  assert.strictEqual(field.style.pointerEvents, 'auto', 'the field takes touches normally');
  caret = { x: 10, y: 10, w: 1, h: 12 };
  TouchControls.layoutZones();
  assert.strictEqual(field.style.pointerEvents, 'none',
    'a focused guest text field beats every gesture on this layer');
  caret = null;
  TouchControls.layoutZones();
  assert.strictEqual(field.style.pointerEvents, 'auto', 'and it comes back when the caret goes');
  TouchControls.destroy();
}

// 13b. Safari keeps the running page at 100vh while its visible viewport is
// shorter. Bottom controls follow the visible edge, and the reported occupied
// band includes the obscured toolbar so the guest is kept above both.
{
  const viewportHandlers = new Map();
  global.window.visualViewport = {
    height: 700, offsetTop: 0,
    addEventListener(type, fn) { viewportHandlers.set(type, fn); },
    removeEventListener(type, fn) {
      if (viewportHandlers.get(type) === fn) viewportHandlers.delete(type);
    },
  };
  const layoutRenderer = {
    handleKeyDown() {}, handleKeyUp() {}, viewMode: 'fit',
    setViewMode() { return false; }, caretRect: () => null,
    getPresentedRectClient: () => ({ x: 0, y: 80, w: 390, h: 480 }),
  };
  TouchControls.install({ document: global.document, renderer: layoutRenderer });
  TouchControls.el.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844,
  });
  TouchControls.setLayout({ dpad: { pos: 'bl', style: 'cross' }, swipes: true });
  const bottomCorner = TouchControls._corners.bl;
  assert.strictEqual(bottomCorner.style.bottom, '144px',
    'the dpad clears Safari visual-viewport occlusion without resizing the guest');
  assert.ok(TouchControls._utilityRow.style.bottom.includes('144px'),
    'phone utility pills also clear the Safari toolbar');
  assert.ok(viewportHandlers.has('resize') && viewportHandlers.has('scroll'),
    'toolbar movement relayouts controls immediately');
  TouchControls.destroy();
  assert.strictEqual(viewportHandlers.size, 0, 'visual viewport listeners are removed at teardown');
  delete global.window.visualViewport;
}

// 14. The manual keyboard pill: it exists for every app, and a tap on it calls
// the page's focus hand-off from inside the gesture.
{
  const renderer = {
    handleKeyDown() {}, handleKeyUp() {},
    viewMode: 'fit', setViewMode() { return false; },
    caretRect: () => null,
    getPresentedRectClient: () => ({ x: 0, y: 6, w: 390, h: 494 }),
  };

  // An app with NO touchControls entry at all -- Diablo II, StarCraft, every
  // fullscreen game that draws its own text field. It still gets the pill,
  // because a registry edit is not a prerequisite for being able to type.
  TouchControls.install({ document: global.document, renderer });
  TouchControls.sync([{ id: 'diablo2_demo' }], renderer);
  assert.ok(TouchControls.layout, 'a plain app still gets a layout');
  assert.strictEqual(TouchControls.layout.chrome, true, 'the bare chrome one');
  const pill = TouchControls._widgets.find(el => el.className === 'tc-key');
  assert.ok(pill, 'and with it the keyboard pill');
  assert.strictEqual(TouchControls.el.style.display, 'block', 'which is on screen');
  assert.strictEqual(
    TouchControls._widgets.find(el => el.className === 'tc-mode'), undefined,
    'but NOT the fit/fill toggle: no app has authored a crop for it');

  // isVisible() means "the app's game controls are up", and this app has
  // none. Both callers -- the renderer's bottom inset and the cursor-sprite
  // policy -- depend on that distinction, so a pill must not reserve screen
  // space or take Solitaire's cursor away.
  assert.strictEqual(TouchControls.isVisible(), false,
    'chrome alone is not "the game controls are up"');
  assert.strictEqual(TouchControls.isMounted(), true, 'though it IS on screen');
  assert.strictEqual(TouchControls.getOccupiedHeight(), 0, 'and reserves no band');
  assert.strictEqual(TouchControls.getOccupiedFraction(), 0, 'so the game is not pushed up');

  // The tap. The page's hand-off has to be called from inside the touchstart
  // handler -- iOS opens its keyboard from a user gesture and nowhere else.
  let open = false;
  let calls = 0;
  global.window.__wineToggleKeyboard = () => { calls++; open = !open; return open; };
  global.window.__wineKeyboardOpen = () => open;
  pill.dispatch('touchstart', { changedTouches: [{ identifier: 1, clientX: 20, clientY: 20 }] });
  assert.strictEqual(calls, 1, 'the pill calls the page hand-off');
  assert.strictEqual(open, true, 'which opens the keyboard');
  assert.ok(pill.classList.contains('tc-on'), 'and the pill lights up as a latch');

  pill.dispatch('touchend', { changedTouches: [{ identifier: 1 }] });
  pill.dispatch('touchstart', { changedTouches: [{ identifier: 2, clientX: 20, clientY: 20 }] });
  assert.strictEqual(open, false, 'a second tap closes it again');
  assert.ok(!pill.classList.contains('tc-on'), 'and the latch goes out');

  // iOS can close the keyboard from its own affordances; all the page sees is
  // the proxy blurring, and it tells us so through this entry point.
  open = true;
  TouchControls.syncKeyboardToggle();
  assert.ok(pill.classList.contains('tc-on'), 'the pill can be resynced from the page');
  open = false;
  TouchControls.syncKeyboardToggle();
  assert.ok(!pill.classList.contains('tc-on'), 'in both directions');

  // No app running at all: the overlay comes down with it.
  TouchControls.sync([], renderer);
  assert.strictEqual(TouchControls.layout, null, 'no app, no overlay');
  delete global.window.__wineToggleKeyboard;
  delete global.window.__wineKeyboardOpen;
  TouchControls.destroy();
}

// 15. A mouse-backed action button presses at the guest cursor, not at the
// HTML button's page coordinate, and teardown cannot leave it held.
{
  const mouse = [];
  const mouseRenderer = {
    canvas: { width: 640, height: 480,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }) },
    _mouseX: 321, _mouseY: 222,
    handleKeyDown() {}, handleKeyUp() {},
    handleMouseDown: (x, y, button) => mouse.push(['down', x, y, button]),
    handleMouseUp: (x, y, button) => mouse.push(['up', x, y, button]),
  };
  TouchControls.install({ document: global.document, renderer: mouseRenderer });
  TouchControls.setLayout({
    buttons: [{ mouseButton: 0, label: 'Jump', pos: 'br' }],
  });
  const jump = TouchControls._widgets.find(el => el.className === 'tc-btn');
  jump.dispatch('touchstart', touchEvent([touch(80, 600, 440)]));
  jump.dispatch('touchend', touchEvent([touch(80, 600, 440)]));
  assert.deepStrictEqual(mouse, [
    ['down', 321, 222, 0], ['up', 321, 222, 0],
  ], 'mouse action uses the current guest cursor for a paired press');
  jump.dispatch('touchstart', touchEvent([touch(81, 600, 440)]));
  TouchControls.destroy();
  assert.deepStrictEqual(mouse.slice(-2), [
    ['down', 321, 222, 0], ['up', 321, 222, 0],
  ], 'destroy releases a held mouse action');
}

// Keep the release-facing Blobby layout and the verified local keyboard-game
// layouts attached when candidates are repacked or promoted.
{
  const { APPS } = require('../lib/apps');
  const actionApps = [
    'blobby_volley', 'cave_story', 'generally', 'little_fighter_2',
    'icy_tower', 'elasto_mania', 'atomic_bomberman_demo', 'jazz2_demo',
    'quake2_demo', 'gta2_demo', 'halflife_uplink', 'deus_ex_demo', 'abedemo',
  ];
  for (const id of actionApps) {
    assert(APPS[id] && APPS[id].touchControls,
      `${id} should expose phone gameplay controls`);
  }
  for (const id of ['dxball']) {
    assert.strictEqual(APPS[id].mobileTouch, 'direct', 'canvas remains an absolute mouse alongside the joystick');
    assert.strictEqual(APPS[id].touchControls.mouseJoystick.maxSpeed, 900);
    assert.strictEqual(APPS[id].touchControls.mouseJoystick.responseExponent, 3);
    assert.strictEqual(APPS[id].touchControls.boardLayout, true);
    assert(!APPS[id].touchControls.dpad, 'mouse games must not get a keyboard pad');
    assert.strictEqual(APPS[id].touchControls.buttons[0].mouseButton, 0);
  }
  // Blobby is a KEYBOARD game on a phone, not a mouse one. The mouse moves
  // player two only in a LOCAL match -- a network client is driven by player
  // two's configured keys (measured in test-blobby-vlan.js) -- and a
  // mouseJoystick emits no key events at all, so it can never drive a network
  // game. The pad sends only the local player's keys: `touchControls` for
  // player one (solo, and the host seat), `lanClientTouchControls` for player
  // two, swapped at joinVlan; see docs/re-notes/blobby-volley.md.
  assert.strictEqual(APPS.blobby_volley.mobileTouch, 'direct',
    'the canvas stays an absolute mouse, because Blobby navigates its MENUS with one');
  for (const layout of [APPS.blobby_volley.touchControls, APPS.blobby_volley.lanClientTouchControls]) {
    assert(!layout.mouseJoystick, 'a mouse joystick cannot drive a network match');
    assert.strictEqual(layout.boardLayout, true);
  }
  // The pads are only correct because of what settings.dat says once the
  // touch patch has run, so check the two against each other rather than
  // hardcoding the keys twice. The shipped file is easy to replace by
  // accident: `--save-vfs` captures whatever the guest last wrote, and
  // persistFiles lets a player's own copy shadow it.
  {
    const { parse, CONTROL } = require('../tools/blobby-settings');
    const raw = Buffer.from(require('fs').readFileSync(
      'packages/freeware/blobby-volley/settings.dat'));
    for (const p of APPS.blobby_volley.touchPatches) raw.writeUInt32LE(p.uint32, p.offset);
    const dat = parse(raw);
    const layouts = [APPS.blobby_volley.touchControls, APPS.blobby_volley.lanClientTouchControls];
    for (const [i, keys] of [dat.keys1, dat.keys2].entries()) {
      // Each player's pad moves exactly that player -- equality, not
      // coverage: a key belonging to the other player is the "one thumb
      // walks both blobs" bug in a solo match.
      const pad = layouts[i].dpad.vks;
      assert.deepStrictEqual([pad.left, pad.right], [[keys[0]], [keys[1]]],
        `player ${i + 1}'s pad must send player ${i + 1}'s left/right and nothing else`);
      assert(layouts[i].buttons[0].vk.includes(keys[2]),
        `player ${i + 1}'s Jump button must send player ${i + 1}'s jump key`);
    }
    // Player one is the person; player two is the AI, so a solo launch is a
    // game against ADAM. A network match overwrites both CONTROL dwords for
    // its duration (the local player gets the network screen's CONTROL, the
    // remote one 0x32) -- docs/re-notes/blobby-volley.md. Never the mouse:
    // it cannot reach a network client.
    assert.deepStrictEqual(dat.control, [CONTROL.keyboard, CONTROL.computer],
      'shipped settings.dat: player one keyboard, player two computer');
    // The menu keys ride along in both layouts, so none may be a player key.
    const playerKeys = [...dat.keys1, ...dat.keys2];
    for (const vk of [0x26, 0x28, 0x0d]) {
      assert(!playerKeys.includes(vk),
        `menu key 0x${vk.toString(16)} is also a player key, so it moves a blob`);
    }
  }
  assert.deepStrictEqual(APPS.quake2_demo.touchControls.dpad.vks,
    { up: 0x26, down: 0x28, left: 0x41, right: 0x44 },
    'Quake II up/down serve menus and movement, A/D strafe');
  assert.strictEqual(APPS.halflife_uplink.mobileTouch, 'trackpad',
    'Half-Life should combine its WASD pad with deterministic trackpad look');
  assert.strictEqual(APPS.deus_ex_demo.mobileTouch, 'trackpad',
    'Deus Ex should combine its WASD pad with deterministic trackpad look');
}

// Pinball zones follow the table, not the score panel, in Normal view.
{
  const app=require('../lib/apps').APPS.pinball;
  assert.strictEqual(app.touchControls.zones[0].rect.w,app.touchControls.zones[1].rect.w,
    'flipper touch zones are symmetric');
  assert(app.touchControls.zones[2].rect.y >= 0.7 && app.touchControls.zones[2].rect.h <= 0.31,
    'plunger is a lower-right touch region beside the lane');
  // The crop is the table's measured bounding box in the 641x481 scene
  // (x 23..382, y 32..447), so a fraction of it is a fraction of the TABLE.
  const crop=app.mobileCrop;
  assert.strictEqual(crop.x*641,23);
  assert.strictEqual(crop.w*641,360);
  const r={mobileCrop:crop,viewMode:'fit',
    getPresentedRectClient:()=>({x:0,y:0,w:641,h:481})};
  TouchControls.install({document,renderer:r}); TouchControls.setRenderer(r);
  TouchControls.setLayout(app.touchControls);
  TouchControls.el._rect={left:0,top:0,right:641,bottom:481,width:641,height:481};
  TouchControls.layoutZones();
  assert.strictEqual(parseFloat(TouchControls._zones[0].style.left),23);
  assert.strictEqual(parseFloat(TouchControls._zones[0].style.width),180);
  r.viewMode='zoom';r.getPresentedRectClient=()=>({x:0,y:0,w:360,h:416});
  TouchControls.layoutZones();
  assert.strictEqual(parseFloat(TouchControls._zones[0].style.left),0);
  assert.strictEqual(parseFloat(TouchControls._zones[0].style.width),180);

  // The chip's FACE is the fit/fill bracket icon, in both states -- the
  // registry's words for them ("Normal"/"Table") survive only as the
  // accessible name. A 12px word on a 40px pill beside a keyboard glyph is
  // not a control anyone reads.
  TouchControls.syncViewMode();
  assert(!TouchControls._modeEl.textContent,
    'no word on the face of the view chip');
  assert(/<svg/.test(TouchControls._modeEl.innerHTML),'the face is the icon');
  assert.strictEqual(TouchControls._modeEl.getAttribute('aria-label'),
    'switch to Normal view','the app\'s own word is kept as the accessible name');
  r.viewMode='fit';TouchControls.syncViewMode();
  assert.strictEqual(TouchControls._modeEl.getAttribute('aria-label'),
    'switch to Table view');
  assert(!TouchControls._modeEl.textContent);

  r.viewMode='zoom';
  r.getActiveModalWindow=()=>({hwnd:2});TouchControls.layoutZones();
  assert(TouchControls._zones.every(z=>z.style.visibility==='hidden'),'modal hides game hit areas');
  assert.strictEqual(TouchControls._modeEl.style.visibility,'hidden');
  assert.notStrictEqual(TouchControls._keyEl.style.visibility,'hidden','keyboard stays available for dialog text');
  r.getActiveModalWindow=()=>null;TouchControls.layoutZones();
  assert(TouchControls._zones.every(z=>z.style.visibility===''),'game controls return after dismissal');
  TouchControls.destroy();
}

// --- Pinball's phone affordances, per orientation ---------------------------
//
// Four reports from a real iPhone, portrait, single-app mode:
//   1. the flippers and the plunger are invisible in-place zones and nothing
//      says so. Name them UNDER the table, never on it.
//   2. the two big "Nudge" word-pills go, and become arrows in the black
//      triangles the tilted table leaves inside its own top corners -- the one
//      part of the picture that carries nothing.
//   3. the view chip shows an icon, not the word "Normal". (Above.)
//   4. the table was off centre. That was the crop, fixed in lib/apps.js and
//      pinned in test/test-single-app-mode.js.
// ...and a fifth, landscape: one framing, and no black bars top or bottom.
{
  const app=require('../lib/apps').APPS.pinball;
  const nudges=app.touchControls.buttons.filter(b=>/^board-/.test(String(b.pos||'')));
  assert.strictEqual(nudges.length,2,'both nudges are anchored to the picture');
  assert.deepStrictEqual(nudges.map(b=>[b.vk,b.pos,b.icon]),
    // X from the left, '.' from the right: measured bindings, unchanged.
    [[0x58,'board-tl','arrow-left'],[0xBE,'board-tr','arrow-right']]);
  assert(!app.touchControls.buttons.some(b=>b.label==='Nudge'),
    'no word-pill nudges left in the bottom rails');
  const newGame=app.touchControls.buttons.find(b=>b.vk===0x71);
  assert.strictEqual(newGame.pos,'bl',
    'the one action button comes off the picture into the empty rail');
  // ...and it is a CHIP, not a word-pill. 115px of "New game" could not fit
  // the 90px landscape gutter and hung off the bezel 8px from the left
  // flipper. The icon field already beats label in _addButton, so this is one
  // app's button changing shape and not every app's pill becoming a glyph.
  assert.strictEqual(newGame.chip,true);
  assert.strictEqual(newGame.icon,'restart');
  assert.strictEqual(newGame.label,undefined,'no word left to overflow');
  assert.strictEqual(newGame.title,'New game','the name survives for a screen reader');
  assert(!app.touchControls.buttons.some(b=>b.chip&&!b.icon),
    'a chip with no glyph would render as a blank circle');

  // `real` is a renderer already built and primed with a true viewport; pass
  // one wherever the presented rect is not simply the window rect, since the
  // stand-in below can only answer "fractions of the whole window".
  const setup=(hostRect,presented,viewMode,real)=>{
    const r=real||{mobileCrop:app.mobileCrop,viewMode,
      getPresentedRectClient:()=>presented,
      setViewMode(m){ this.viewMode = m==='zoom'?'zoom':'fit'; return true; }};
    TouchControls.install({document,renderer:r}); TouchControls.setRenderer(r);
    TouchControls.setLayout(app.touchControls);
    TouchControls.el._rect=hostRect;
    TouchControls.layoutZones();
    return r;
  };
  const byLabel=(name)=>TouchControls._widgets.find(w=>w.getAttribute('aria-label')===name);
  const caption=(text)=>TouchControls._captions.filter(c=>c.textContent===text);

  // Both nudge circles lie inside the black triangle at their end of the
  // table's top edge, whatever framing is presenting that table. `table` is the
  // crop in client px (x 23..383, y 32..448 of the window, so 360x416 source).
  // The artwork's own edge was measured row by row off a rendered frame: x goes
  // 92 -> 72 on the left and 313 -> 333 on the right between rows 35 and 155,
  // one pixel out per six rows. Anything the layout does has to keep the whole
  // disc on the black side of that line -- at EVERY row it covers, not just at
  // its centre, which is the part a corner-hug placement got wrong.
  const nudgesInBlack=(table,what)=>{
    const kx=table.w/360, ky=table.h/416;
    const near=(a,b,msg)=>assert(Math.abs(a-b)<0.5,`${what} ${msg}: ${a} != ${b}`);
    for (const [name,sx] of [['Nudge left',54.9],['Nudge right',383-31.9]]) {
      const el=byLabel(name);
      const size=parseFloat(el.style.width);
      near(size,40,`${name} matches the other round chips`);
      near(parseFloat(el.style.left)+size/2,table.x+(sx-23)*kx,`${name} centre x`);
      near(parseFloat(el.style.top)+size/2,table.y+(63.9-32)*ky,`${name} centre y`);
      const cx=parseFloat(el.style.left)+size/2, cy=parseFloat(el.style.top)+size/2;
      const r=size/2;
      assert(cy-r>=table.y-0.5,`${what} ${name} is above the table's top edge`);
      const onLeft=name==='Nudge left';
      for (let sy=35;sy<=155;sy++) {
        const edge=onLeft?92-(sy-35)/6:313+(sy-35)/6;
        const py=table.y+(sy-32)*ky;
        const dx=Math.abs(py-cy)<r?Math.sqrt(r*r-(py-cy)*(py-cy)):0;
        const ex=table.x+(edge-23)*kx;
        if (onLeft) assert(cx+dx<=ex+0.5,`${what} ${name} crosses the artwork at row ${sy}`);
        else assert(cx-dx>=ex-0.5,`${what} ${name} crosses the artwork at row ${sy}`);
      }
    }
  };

  // PORTRAIT 375x710. The table spans the full width (the crop is wider than
  // the board area is tall), so the letterbox is all at the foot.
  {
    const presented={x:0,y:3,w:375,h:433};
    setup({left:0,top:0,right:375,bottom:710,width:375,height:710},presented,'zoom');
    const left=byLabel('Nudge left'), right=byLabel('Nudge right');
    // Inside the picture's top corners, which is where the black is. Here the
    // table is 375 wide, so the measured circle could be larger; its 40px
    // visible size matches the other round chips while a 44px hit area remains.
    assert.strictEqual(parseFloat(left.style.width),40,
      'nudge and other round chips have the same visible diameter');
    const cxP=0.0886*375, cyP=presented.y+0.0767*433;
    assert.strictEqual(parseFloat(left.style.left),cxP-20);
    assert.strictEqual(parseFloat(left.style.top),cyP-20);
    assert.strictEqual(parseFloat(right.style.left),375-cxP-20);
    assert.strictEqual(parseFloat(right.style.top),cyP-20);
    // Captions in the letterbox UNDER the table -- below its last row, above
    // the screen's bottom, and horizontally over the zone each one names.
    const tableBottom=presented.y+presented.h;
    for (const cap of TouchControls._captions) {
      assert.strictEqual(cap.hidden,false);
      const top=parseFloat(cap.style.top);
      assert(top>=tableBottom,`caption at ${top} is on the playfield (ends ${tableBottom})`);
      assert(top<710,'on the screen');
      assert.strictEqual(cap.style.transform,'translateX(-50%)');
    }
    assert.strictEqual(caption('Launch').length,1);
    assert.strictEqual(caption('Flipper').length,2,'one under each flipper');
    const xs=caption('Flipper').map(c=>parseFloat(c.style.left));
    assert.deepStrictEqual(xs,[0.24*375,0.62*375]);
    assert(parseFloat(caption('Launch')[0].style.left)>xs[1]+40,
      'the plunger caption clears the right flipper\'s');
    // The chip is offered in portrait: Normal and Table are both worth having.
    assert.strictEqual(TouchControls._modeEl.hidden,false);
    TouchControls.destroy();
  }

  // LANDSCAPE 710x375. The framing here is the WHOLE 641x481 scene -- score
  // panel and all -- fitted to the short edge, which in landscape is the
  // HEIGHT: dst y 0 h 375 on a 375-tall screen, so no black bar above or
  // below, and what is left over goes to the gutters, where a phone held
  // sideways has room to spare. Cropping to the table here would throw the
  // score away to buy width nobody is short of.
  //
  // The scale is set by the trimmed height, not by the window's: the app's
  // fitTrim names 32 dead rows on top and 33 at the foot (every column black,
  // measured off the presented canvas), so the fit is against 416 rows rather
  // than 481. The horizontal trim is not spent on scale at all -- the width is
  // not the scarce axis here, so those columns come back as content and the
  // presented source is 0,32 641x416. Built on the real renderer, because a
  // presented rect that no longer equals the window rect is precisely what
  // this trim introduces and a hand-written one would assume it away.
  {
    const { Win98Renderer } = require('../lib/renderer');
    const rr = new Win98Renderer({ width: 641, height: 757, getContext() { return {}; } });
    rr.singleAppMode = true;
    rr.presentationCanvas = { width: 2130, height: 1125 };
    rr.mobileCrop = app.mobileCrop;
    rr.touchOverlay = { getBoardArea: () => ({ x: 204 / 710, y: 0, w: 302 / 710, h: 1 }) };
    rr.scheduleRepaint = () => {};
    rr.setViewMode('fit');
    const v = rr._computeSingleAppZoom([{ hwnd: 0x10001, x: 0, y: 0, w: 641, h: 481,
      visible: true, className: 'SpaceCadet' }]).viewport;
    assert.strictEqual(v.cropY, 32, 'the dead top rows are not part of the fit');
    assert.strictEqual(v.cropH, 416, 'nor the dead bottom ones');
    assert.strictEqual(v.dstY, 0, 'Fit starts at the top of the output');
    assert.strictEqual(v.dstH, v.outputH, 'and ends at the bottom: no bars in Fit');
    assert.strictEqual(v.dstH / v.cropH > v.outputH / 481, true,
      'and the trim BUYS scale rather than merely moving the picture');
    // cropBase stays the untrimmed window, which is what lets every app-level
    // fraction (the nudges, the zones) survive the trim untouched.
    assert.deepStrictEqual(
      { x: v.cropBase.x, y: v.cropBase.y, w: v.cropBase.w, h: v.cropBase.h },
      { x: 0, y: 0, w: 641, h: 481 });
    // A second top-level window hands the whole thing back. The fractions are
    // of the union rect, and with a dialog in it that rect is no longer the
    // one they were measured against -- and a dialog is the one moment the
    // user needs to see every row the app drew, trimmed margin included.
    {
      const withDialog = rr._computeSingleAppZoom([
        { hwnd: 0x10001, x: 0, y: 0, w: 641, h: 481, visible: true, className: 'SpaceCadet' },
        { hwnd: 0x10002, x: 180, y: 160, w: 280, h: 150, visible: true, className: '#32770' },
      ]).viewport;
      assert.strictEqual(withDialog.cropY, 0, 'no trim while a dialog is up');
      assert.strictEqual(withDialog.cropH, 481, 'the whole window comes back');
    }
    rr._exclusiveFullscreen = true;
    rr._exclusivePresentationViewport = v;
    const presented = { x: v.dstX / 3, y: v.dstY / 3, w: v.dstW / 3, h: v.dstH / 3 };
    rr.getPresentedRectClient = () => presented;
    const r = setup({left:0,top:0,right:710,bottom:375,width:710,height:375},
      presented,'fit', rr);
    // Everything below is anchored to the TABLE inside that scene, not to the
    // scene: crop x 23..383 of 641, y 32..448 of 481.
    const table = TouchControls._cropRectClient(presented);
    nudgesInBlack(table,'landscape Fit');
    const k = presented.w / v.cropW;
    const right=byLabel('Nudge right');
    assert(parseFloat(right.style.left)+parseFloat(right.style.width)
      < presented.x + (405 - v.cropX) * k,
      'the right nudge stays off the score panel beside the table');
    const tx = table.x, tw = table.w;
    // New game is away from the flippers at the phone's top-left in landscape.
    const ng = byLabel('New game');
    assert(ng.classList.contains('tc-chip'),'it renders as a chip');
    assert.strictEqual(ng._tcHeight,40,'and stacks at the chips\' height');
    assert.strictEqual(ng.innerHTML.indexOf('<svg'),0,'a glyph, not the words');
    assert.strictEqual(ng.parentNode, TouchControls._rows['tl:0'],
      'landscape New game belongs to the top-left phone corner');
    // Item 5b: no captions in landscape. A caption names an invisible zone, so
    // it has to be next to it; the side gutters this used to fall back to are
    // next to nothing, and the phone reported them as "all wrong".
    for (const cap of TouchControls._captions) {
      assert.strictEqual(cap.hidden,true,'no captions in landscape');
      assert.strictEqual(cap.style.left,'','and no stale placement left behind');
    }
    // The flipper split follows the table, not the scene.
    const near=(a,b,what)=>assert(Math.abs(a-b)<0.5,`${what}: ${a} != ${b}`);
    near(parseFloat(TouchControls._zones[1].style.left),tx+tw/2,
      'right flipper zone starts at the table\'s midline');
    // Item 5: landscape ARRIVES in Fit -- the whole scene, fitted to the
    // height. The layout named that framing and the overlay put the renderer
    // in it on the way into this orientation.
    assert.strictEqual(r.viewMode,'fit',
      'landscape lands on the whole window, fitted to the height, no bars');
    // ...but the chip is there, and it is a chip, not a label: "pinball
    // landscape is missing fit/fill button". The default is applied on the
    // EDGE into landscape, so a tap is not undone by the next 250ms poll.
    assert.strictEqual(TouchControls._modeEl.hidden,false,
      'the Fit/Fill chip is offered in landscape too');
    r.viewMode='zoom';
    TouchControls.layoutZones();
    assert.strictEqual(r.viewMode,'zoom',
      'a mode chosen in landscape STAYS chosen -- the default does not fight it');
    TouchControls.destroy();
  }

  // LANDSCAPE FILL, 710x375 -- what the chip switches to. The renderer's
  // contain branch grows the table crop back out toward the hole it goes in,
  // so the source is 23,16 360x447 rather than the crop's own 23,32 360x416,
  // and it still lands dstY 0 dstH 375: Fill costs no top or bottom bar
  // either. Everything is mapped through the viewport, so the table inside
  // that grown source is found the same way in both modes.
  {
    const { Win98Renderer } = require('../lib/renderer');
    const r = new Win98Renderer({ width: 641, height: 757, getContext() { return {}; } });
    r.singleAppMode = true;
    r.presentationCanvas = { width: 2130, height: 1125 };
    r.mobileCrop = app.mobileCrop;
    r.touchOverlay = { getBoardArea: () => ({ x: 204 / 710, y: 0, w: 302 / 710, h: 1 }) };
    r.scheduleRepaint = () => {};
    r.setViewMode('zoom');
    const v = r._computeSingleAppZoom([{ hwnd: 0x10001, x: 0, y: 0, w: 641, h: 481,
      visible: true, className: 'SpaceCadet' }]).viewport;
    assert.strictEqual(v.dstY, 0, 'Fill starts at the top of the output');
    assert.strictEqual(v.dstH, v.outputH, 'and ends at the bottom: no bars in Fill');
    r._exclusiveFullscreen = true;
    r._exclusivePresentationViewport = v;
    const presented = { x: v.dstX / 3, y: v.dstY / 3, w: v.dstW / 3, h: v.dstH / 3 };
    r.getPresentedRectClient = () => presented;
    TouchControls.install({ document, renderer: r }); TouchControls.setRenderer(r);
    TouchControls.setLayout(app.touchControls);
    TouchControls.el._rect = { left: 0, top: 0, right: 710, bottom: 375, width: 710, height: 375 };
    TouchControls.layoutZones();
    // Arriving sideways lands on the layout's named framing...
    assert.strictEqual(r.viewMode, 'fit', 'a new app arrives in landscape Fit');
    // ...and the chip then reaches the other one and KEEPS it. This is the
    // whole difference between a default and a lock, and it is the bug the
    // first version would have had: the 250ms poll would undo every tap.
    assert.strictEqual(TouchControls._modeEl.hidden, false, 'chip still offered');
    TouchControls.setViewMode('zoom');
    TouchControls.layoutZones();
    assert.strictEqual(r.viewMode, 'zoom', 'Fill in landscape stays Fill');
    const table = TouchControls._cropRectClient(presented);
    nudgesInBlack(table, 'landscape Fill');
    for (const cap of TouchControls._captions) {
      assert.strictEqual(cap.hidden, true, 'captions stay hidden in landscape Fill too');
    }
    // The zones are on the table in this framing as much as in the other one.
    assert(Math.abs(parseFloat(TouchControls._zones[1].style.left)
      - (table.x + table.w / 2)) < 0.5, 'the flipper split is the table midline');
    TouchControls.destroy();
  }

  // LANDSCAPE 667x375 -- the case that is not a smaller version of the one
  // above. The rails' column is not the table's shape, so the renderer's
  // contain branch gives up on it and grows the source out to the ENTIRE
  // 641x481 scene: the presented rect now carries the score panel, and
  // "fractions of the presented rect" would put the right-hand nudge on the
  // Space Cadet logo. The mapping goes through the viewport's source rect
  // instead, so the button stays in the table's own top corner.
  {
    const canvas = { width: 641, height: 481 };
    const presented = { x: 134 / 3, y: 0, w: 1733 / 3, h: 375 };
    const r = {
      mobileCrop: app.mobileCrop, viewMode: 'zoom', canvas,
      _exclusiveFullscreen: true,
      _exclusivePresentationViewport: {
        cropX: 0, cropY: 32, cropW: 641, cropH: 416,
        dstX: 134, dstY: 0, dstW: 1733, dstH: 1125, outputW: 2001, outputH: 1125,
      },
      getPresentedRectClient: () => presented,
      setViewMode(m) { this.viewMode = m === 'zoom' ? 'zoom' : 'fit'; return true; },
    };
    TouchControls.install({ document, renderer: r }); TouchControls.setRenderer(r);
    TouchControls.setLayout(app.touchControls);
    TouchControls.el._rect = { left: 0, top: 0, right: 667, bottom: 375, width: 667, height: 375 };
    TouchControls.layoutZones();
    const k = presented.w / 641;
    const tableLeft = presented.x + 23 * k, tableRight = presented.x + 383 * k;
    const panelLeft = presented.x + 405 * k;
    const right = TouchControls._widgets.find(w => w.getAttribute('aria-label') === 'Nudge right');
    const x = parseFloat(right.style.left);
    const size = parseFloat(right.style.width);
    const want = presented.x + (383 - 31.9) * k - size / 2;
    assert(Math.abs(x - want) < 0.5,
      `right nudge at ${x} should sit in the TABLE's black triangle (${want})`);
    assert(x + size < panelLeft, 'and stay off the score panel');
    // The flipper split follows the table too, not the scene.
    const mid = parseFloat(TouchControls._zones[1].style.left);
    assert(Math.abs(mid - (tableLeft + (tableRight - tableLeft) / 2)) < 0.5,
      `right flipper starts at the table's midline, got ${mid}`);
    // The picture reaches both edges here, so there is no gutter and no band:
    // nowhere to put a caption that is not on the game. Hidden beats covering.
    assert(TouchControls._captions.every(c => c.hidden === true),
      'captions are dropped rather than drawn over the playfield');
    TouchControls.destroy();
  }

  // PORTRAIT, THE REAL DEVICE -- a canvas TALLER than the window, which is the
  // shape that exposed the base rect. Measured on an iPhone (375x710 CSS,
  // DPR 3): the desktop canvas is 641x757 while Space Cadet's window is
  // 641x481 at 0,0, and the crop fractions are fractions of the WINDOW.
  // Multiplying them by the canvas instead made the width right by pure
  // coincidence (641 == 641) and stretched the height by 757/481, so the
  // table's bottom came out at 839 on a 710-tall screen: no band under the
  // picture, the landscape gutter branch took over, found no gutters, and hid
  // every caption -- and both nudges sat 19px low, on the artwork.
  //
  // The viewport here is not hand-written: it is what the real renderer
  // produces for that window, and it matches the device's reading field for
  // field (cropX 23, cropY 32, 360x416 -> dst 0,415 1125x1300 in 1125x2130).
  {
    const { Win98Renderer } = require('../lib/renderer');
    const r = new Win98Renderer({ width: 641, height: 757, getContext() { return {}; } });
    r.singleAppMode = true;
    r.presentationCanvas = { width: 1125, height: 2130 };
    r.mobileCrop = app.mobileCrop;
    // The board area the device's own overlay reserves at this size.
    r.touchOverlay = { getBoardArea: () => ({ x: 0, y: 415 / 2130, w: 1, h: 0.5 }) };
    // No rAF in this fake DOM, and nothing here needs a repaint.
    r.scheduleRepaint = () => {};
    r.setViewMode('zoom');
    const zoom = r._computeSingleAppZoom([{ hwnd: 0x10001, x: 0, y: 0, w: 641, h: 481,
      visible: true, className: 'SpaceCadet' }]);
    const v = zoom.viewport;
    assert.deepStrictEqual(
      [v.cropX, v.cropY, v.cropW, v.cropH, v.dstX, v.dstY, v.dstW, v.dstH],
      [23, 32, 360, 416, 0, 415, 1125, 1300], 'the device viewport, reproduced');
    // THE REGRESSION: the rectangle those fractions are OF is the window, and
    // the renderer must say so rather than leaving the overlay to infer it.
    assert.deepStrictEqual(v.cropBase, { x: 0, y: 0, w: 641, h: 481 },
      'the crop base is the WINDOW rect, not the 641x757 canvas');

    r._exclusiveFullscreen = true;
    r._exclusivePresentationViewport = v;
    const presented = { x: 0, y: 415 / 2130 * 710, w: 375, h: 1300 / 2130 * 710 };
    r.getPresentedRectClient = () => presented;
    TouchControls.install({ document, renderer: r }); TouchControls.setRenderer(r);
    TouchControls.setLayout(app.touchControls);
    TouchControls.el._rect = { left: 0, top: 0, right: 375, bottom: 710, width: 375, height: 710 };
    TouchControls.layoutZones();

    const table = TouchControls._cropRectClient(presented);
    const near = (a, b, what) => assert(Math.abs(a - b) < 0.01, `${what}: ${a} != ${b}`);
    near(table.x, 0, 'table left');
    near(table.y, 138.3333, 'table top');
    near(table.w, 375, 'table width');
    near(table.h, 433.3333, 'table height');
    // With the canvas as the base this was {y:157.5, h:682} -- bottom 839.
    near(table.y + table.h, 571.6666, 'the table ends on the screen, not 129px below it');

    // Consequence 1: there IS a band under the picture, so the captions are
    // placed in it and stay visible.
    assert.strictEqual(TouchControls._captions.length, 3, 'Flipper, Flipper, Launch');
    for (const cap of TouchControls._captions) {
      assert.strictEqual(cap.hidden, false, 'no caption is hidden on a portrait phone');
      near(parseFloat(cap.style.top), 579.6666, 'caption sits just under the table');
    }
    // Consequence 2: the nudges anchor to the table's own top corners.
    const nudge = name => parseFloat(
      TouchControls._widgets.find(w => w.getAttribute('aria-label') === name).style.top);
    // 138.33 (the table's top) + 0.0767 * 433.33 (the measured circle's centre)
    // - 20 (half of the 40px chip, which wins at this size).
    near(nudge('Nudge left'), 151.57, 'left nudge top');
    near(nudge('Nudge right'), 151.57, 'right nudge top');
    TouchControls.destroy();
  }
}

console.log('PASS  pinball phone affordances: captions, corner nudges, one landscape view');

console.log('PASS  touch controls hold, pair and release guest keys');

// Analog mouse joystick: velocity (not keys), no idle RAF, exact release,
// independent click, radial response, and native/presentation mapping.
{
  const pending = new Map(); let serial = 0, time = 0;
  window.requestAnimationFrame = fn => { pending.set(++serial, fn); return serial; };
  window.cancelAnimationFrame = id => pending.delete(id);
  const tick = () => { time += 16; const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn(time)); };
  const moves = [], clicks = [];
  const mouse = { canvas: {width:400,height:300}, _mouseX:320, _mouseY:240,
    _exclusiveTransform: {srcX:0,srcY:0,srcW:640,srcH:480},
    _unmapExclusiveInputPoint: (x,y) => ({x:x/2,y:y/2}),
    handleMouseMove(x,y) { this._mouseX=x*2; this._mouseY=y*2; moves.push([this._mouseX,this._mouseY]); },
    handleMouseDown(x,y,b) { clicks.push(['down',x*2,y*2,b]); },
    handleMouseUp(x,y,b) { clicks.push(['up',x*2,y*2,b]); },
  };
  TouchControls.install({document,renderer:mouse});
  TouchControls.setRenderer(mouse);
  TouchControls.setLayout({boardLayout:true,mouseJoystick:{pos:'bl'},buttons:[{mouseButton:0,label:'Jump',pos:'br'}]});
  TouchControls.el._rect={left:0,top:0,right:712,bottom:375,width:712,height:375};
  document.querySelector=()=>({content:'width=device-width, initial-scale=1'});
  TouchControls.layoutZones();
  assert.strictEqual(TouchControls._corners.bl.style.paddingLeft,'8px', 'Safari auto-inset viewport must not add the notch twice');
  assert.strictEqual(TouchControls._corners.br.style.paddingRight,'8px');
  assert.strictEqual(TouchControls._corners.bl.style.paddingBottom,
    'calc(36px + env(safe-area-inset-bottom, 0px))', 'joystick has comfortable vertical edge clearance');
  assert.strictEqual(TouchControls._corners.br.style.paddingBottom,
    TouchControls._corners.bl.style.paddingBottom, 'action button has matching clearance');
  document.querySelector=()=>({content:'width=device-width, viewport-fit=cover'});
  TouchControls.layoutZones();
  assert(TouchControls._corners.bl.style.paddingLeft.includes('safe-area-inset-left'), 'cover viewports still protect the notch');
  delete document.querySelector;
  const stick=TouchControls._widgets.find(w=>w.className.includes('tc-mouse-joystick'));
  const button=TouchControls._widgets.find(w=>w.className==='tc-btn');
  TouchControls.el._rect={left:0,top:0,right:375,bottom:628,width:375,height:628};
  mouse.getPresentedRectClient=()=>({x:0,y:70,w:375,h:281});
  TouchControls.layoutZones();
  assert.strictEqual(parseFloat(TouchControls._corners.bl.style.bottom),105,
    'portrait stick starts 24px below the actual picture, not at the phone bottom');
  assert.strictEqual(parseFloat(TouchControls._corners.br.style.bottom),159,
    'primary action top aligns with the joystick top');
  assert.strictEqual(TouchControls._keyEl.parentNode, TouchControls._utilityRow,
    'keyboard stays in the phone utility row instead of following Jump');
  assert.strictEqual(TouchControls._keyEl.style.top || '', '');
  assert.strictEqual(TouchControls._modeEl.style.top || '', '');
  mouse.getPresentedRectClient=()=>({x:0,y:0,w:375,h:628});
  TouchControls.layoutZones();
  assert.strictEqual(parseFloat(TouchControls._corners.br.style.bottom),58,
    'Fill fallback reserves the entire utility row above the safe bottom');
  delete mouse.getPresentedRectClient;
  stick._rect={left:0,top:0,width:112,height:112};
  const send=(type,id,x,y)=>stick.dispatch(type,touchEvent([touch(id,x,y)]));
  send('touchstart',1,57,56); assert.strictEqual(pending.size,0,'dead zone schedules no frames');
  send('touchmove',1,65,56); tick();
  const preciseBegin=mouse._mouseX; for(let i=0;i<64;i++)tick();
  assert(mouse._mouseX-preciseBegin >= 1 && mouse._mouseX-preciseBegin <= 2,
    'quarter tilt accumulates subpixel movement for very slow positioning');
  send('touchmove',1,56,56); mouse._mouseX=320;
  send('touchmove',1,74,56); tick();
  const begin=mouse._mouseX; for(let i=0;i<8;i++)tick(); const slow=mouse._mouseX-begin;
  assert(slow >= 7 && slow <= 9, 'half tilt gives about 63 guest px/s, not the old 200');
  send('touchmove',1,92,56); const faster=mouse._mouseX; for(let i=0;i<8;i++)tick();
  assert(slow>0 && mouse._mouseX-faster>slow*2,'more deflection produces higher speed');
  assert(mouse._mouseX-faster >= 114 && mouse._mouseX-faster <= 116,
    'full tilt still gives 900 guest px/s');
  assert.strictEqual(mouse._mouseY,240,'horizontal tilt does not move vertically');
  const clickX=mouse._mouseX;
  button.dispatch('touchstart',touchEvent([touch(2,300,250)]));
  tick(); assert.strictEqual(clicks[0][1],clickX,'click uses cursor before next frame');
  send('touchstart',3,20,56); // cannot steal the stick from finger 1
  send('touchend',3,20,56); assert(pending.size>0);
  send('touchend',1,92,56); assert.strictEqual(pending.size,0,'release cancels animation immediately');
  const stopped=mouse._mouseX; tick(); assert.strictEqual(mouse._mouseX,stopped);
  assert.strictEqual(clicks.length,1,'releasing steering does not release Jump');
  button.dispatch('touchend',touchEvent([touch(2,300,250)]));
  assert.strictEqual(clicks[1][0],'up');
  send('touchstart',4,56,92); tick();tick(); assert(mouse._mouseY>240,'vertical axis supports menus');
  send('touchcancel',4,56,92); assert.strictEqual(pending.size,0);
  send('touchstart',5,92,56); TouchControls.releaseAll(); assert.strictEqual(pending.size,0);
  assert.strictEqual(stick.children[0].style.transform,'translate(0px, 0px)');
  send('touchstart',6,92,56); TouchControls.setLayout(null); assert.strictEqual(pending.size,0);
  TouchControls.setLayout({mouseJoystick:{pos:'bl',responseExponent:1}});
  const linearStick=TouchControls._widgets.find(w=>w.className.includes('tc-mouse-joystick'));
  linearStick._rect={left:0,top:0,width:112,height:112}; mouse._mouseX=100;
  linearStick.dispatch('touchstart',touchEvent([touch(7,74,56)])); tick();
  for(let i=0;i<8;i++)tick();
  assert(mouse._mouseX >= 147 && mouse._mouseX <= 148,
    'per-game response exponent overrides the soft-center default');
  TouchControls.destroy();
  delete window.requestAnimationFrame; delete window.cancelAnimationFrame;
  console.log('PASS analog mouse joystick speed, mapping, dead zone, click pairing and cleanup');
}

{
  TouchControls.install({ document: global.document, renderer });
  TouchControls.el._rect = { left: 0, top: 0, width: 390, height: 844 };
  const previous = { ...global.window };
  global.window.innerWidth = 390;
  global.window.visualViewport = { height: 844, offsetTop: 0 };
  global.window.getComputedStyle = () => ({ getPropertyValue: key => key === '--tc-safe-top' ? '47px' : '0px' });

  // An app with no game controls gives up nothing: the two utility pills float
  // over the picture, and the keyboard one of them opens is a temporary
  // overlay with its own button to dismiss it. Notepad gets the whole phone.
  TouchControls.setLayout(null);
  assert.deepStrictEqual(TouchControls.getBoardArea(),
    { x: 0, y: 47 / 844, w: 1, h: (844 - 47) / 844 },
    'nothing but the status bar is taken from a chrome-only layout');

  TouchControls.setLayout({ dpad: { pos: 'bl', style: 'cross' } });
  let area = TouchControls.getBoardArea();
  assert.strictEqual(area.y * 844, 47);
  assert.strictEqual(Math.round((area.y + area.h) * 844), 640);
  global.document.body.classList.add('keyboard-open');
  global.window.visualViewport.height = 400;
  assert.deepStrictEqual(TouchControls.getBoardArea(), area, 'keyboard does not move controls/presentation anchors');
  global.document.body.classList.remove('keyboard-open');
  global.window.visualViewport.height = 844;
  TouchControls.el._rect.top = 47;
  area = TouchControls.getBoardArea();
  assert.strictEqual(area.y, 0, 'an already-inset host does not double the safe area');
  TouchControls.el._rect = { left: 0, top: 0, width: 844, height: 390 };
  global.window.innerWidth = 844;
  global.window.visualViewport.height = 390;
  global.window.getComputedStyle = () => ({ getPropertyValue: key => key === '--tc-safe-top' ? '0px' : '47px' });
  area = TouchControls.getBoardArea();
  assert.strictEqual(area.x * 844, 204, 'landscape rails already clear the notch');
  assert.strictEqual(area.h, 1);
  TouchControls.destroy();
  global.window = previous;
  console.log('PASS board area: status/notch insets, no double inset, keyboard freeze, landscape rails');
}

// Landscape gutter centring. A portrait-shaped game letterboxed on a landscape
// phone leaves a teal gutter down each side; the clusters are positioned by the
// rail reservation, which is a fraction of the SCREEN, so they used to sit
// against the bezel rather than in the middle of the space beside the picture.
// getBoardArea() deliberately does NOT change -- it is presentation's input and
// must stay constant or the fit and the reservation chase each other -- so the
// widgets follow the last presented rect instead, one way.
{
  const previous = { ...global.window };
  global.window.innerWidth = 667;
  global.window.visualViewport = { height: 375, offsetTop: 0 };
  global.window.getComputedStyle = () => ({
    getPropertyValue: (key) =>
      (key === 'padding-left' || key === 'padding-right') ? '18px' : '0px',
  });
  let presented = { x: 192, y: 0, w: 283, h: 375 };   // Rattler in landscape
  const gutterRenderer = {
    handleKeyDown() {}, handleKeyUp() {},
    getPresentedRectClient: () => presented,
  };
  TouchControls.install({ document: global.document, renderer: gutterRenderer });
  TouchControls.setLayout({
    boardLayout: true,
    dpad: { pos: 'bl', style: 'cross' },
    buttons: [{ vk: 0x71, label: 'New game', pos: 'br' }],
  });
  TouchControls.el._rect = { left: 0, top: 0, right: 667, bottom: 375, width: 667, height: 375 };
  const corners = { bl: TouchControls._corners.bl, br: TouchControls._corners.br };
  // Widths a real layout produces: a 168px cross pad and a 115px button, each
  // inside 18px of padding.
  const base = { bl: { left: 0, width: 204 }, br: { left: 516, width: 151 } };
  const shiftOf = (el) => {
    const m = /translateX\((-?[\d.]+)px\)/.exec(el.style.transform || '');
    return m ? parseFloat(m[1]) : 0;
  };
  // A browser reports the TRANSFORMED box from getBoundingClientRect. Model
  // that, or the test cannot see a layout that compounds its own shift.
  const settle = () => {
    for (const key of ['bl', 'br']) {
      const dx = shiftOf(corners[key]);
      corners[key]._rect = {
        left: base[key].left + dx, right: base[key].left + dx + base[key].width,
        top: 173, bottom: 375, width: base[key].width, height: 202,
      };
    }
  };
  settle();
  TouchControls.layoutZones();
  settle();
  // 115px button, 192px gutter: 38.5px of gutter each side instead of 18 and 59.
  assert.strictEqual(shiftOf(corners.br), -20.5,
    'the action button centres in the 192px right gutter instead of hugging the bezel');
  assert.strictEqual(corners.bl.style.transform, '',
    'a cluster already wider than its gutter slack is never pushed OUTWARD past its own padding');
  const settled = shiftOf(corners.br);
  TouchControls.layoutZones();
  settle();
  TouchControls.layoutZones();
  settle();
  assert.strictEqual(shiftOf(corners.br), settled,
    'repeated layouts are idempotent -- the shift is measured unshifted, not compounded');

  // A wide game fills the landscape screen: no gutter, so the buttons stay
  // floating over the picture exactly as before. No reserved strip.
  presented = { x: 0, y: 0, w: 667, h: 375 };
  TouchControls.layoutZones();
  settle();
  assert.strictEqual(corners.br.style.transform, '', 'no gutter, no shift');
  assert.strictEqual(corners.bl.style.transform, '');

  // A gutter narrower than the cluster cannot centre it, so the cluster hugs
  // the bezel instead of staying at its inset over the picture -- and lands ON
  // the bezel, never past it. This is what keeps Pinball's "New game" pill out
  // of the left flipper zone in landscape, where the pill is 115px and the
  // gutter 105: at its 18px inset it reached 10px into the zone.
  presented = { x: 40, y: 0, w: 600, h: 375 };
  TouchControls.layoutZones();
  settle();
  assert.strictEqual(corners.bl.style.transform, 'translateX(-18px)',
    'content flush with the left bezel: 0 (left) + 18 (padding) - 18');
  assert.strictEqual(shiftOf(corners.bl) + base.bl.left + 18, 0,
    'exactly the bezel, not past it');
  assert.strictEqual(corners.br.style.transform, 'translateX(18px)');
  assert.strictEqual(shiftOf(corners.br) + base.br.left + base.br.width - 18, 667,
    'and the right cluster flush with the right bezel');

  // Portrait has no side gutters to centre in at all.
  presented = { x: 0, y: 100, w: 375, h: 300 };
  TouchControls.el._rect = { left: 0, top: 0, right: 375, bottom: 667, width: 375, height: 667 };
  global.window.visualViewport = { height: 667, offsetTop: 0 };
  TouchControls.layoutZones();
  assert.strictEqual(corners.bl.style.transform, '');
  assert.strictEqual(corners.br.style.transform, '');
  // A real browser's getBoundingClientRect follows the transform this layout
  // just cleared; the fake one only follows `settle`, so say so, or the next
  // block measures a box that is still carrying the previous shift.
  settle();

  // Fill: renderer.setViewMode only SCHEDULES the repaint that recomputes the
  // presentation viewport, so laying out inline places the controls against the
  // mode they just left. The overlay has to lay out again after that repaint.
  const frames = [];
  global.window.requestAnimationFrame = (fn) => frames.push(fn);
  let mode = 'fit';
  gutterRenderer.viewMode = 'fit';
  gutterRenderer.mobileCrop = { x: 0, y: 0, w: 1, h: 0.85 };
  gutterRenderer.setViewMode = (next) => {
    if (mode === next) return false;
    mode = next; gutterRenderer.viewMode = next;
    // The new rect appears only when the scheduled repaint runs.
    global.window.requestAnimationFrame(() => { presented = { x: 0, y: 0, w: 667, h: 375 }; });
    return true;
  };
  TouchControls.el._rect = { left: 0, top: 0, right: 667, bottom: 375, width: 667, height: 375 };
  global.window.visualViewport = { height: 375, offsetTop: 0 };
  presented = { x: 192, y: 0, w: 283, h: 375 };
  TouchControls.setViewMode('zoom');
  assert(frames.length >= 2, 'a mode switch schedules its own re-layout, not just a repaint');
  settle();
  assert.strictEqual(shiftOf(corners.br), -20.5,
    'the inline layout can only see the rect of the mode being left -- which is the whole bug');
  const seen = [];
  while (frames.length) {
    const batch = frames.splice(0, frames.length);
    for (const fn of batch) { fn(); settle(); seen.push(shiftOf(corners.br)); }
  }
  assert.strictEqual(shiftOf(corners.br), 0,
    'once the Fill viewport exists the buttons are placed against it, not against the Fit rect');
  delete global.window.requestAnimationFrame;
  TouchControls.destroy();
  global.window = previous;
  console.log('PASS landscape clusters centre in the letterbox gutters and re-settle after a view-mode switch');
}

// Rodent's short landscape phone view may lose the menu and one bottom wall
// row, but the stopwatch/lives are gameplay state. Its pad sits at the phone
// edge; utility pills remain managed by their separate bottom-right row.
{
  const { APPS } = require('../lib/apps');
  const { Win98Renderer } = require('../lib/renderer');
  const app = APPS.wep16_rodent;
  assert.strictEqual(app.touchControls.landscapeLeftInset, 8);
  assert.strictEqual(app.touchControls.boardLayout, true);
  const renderer = Object.create(Win98Renderer.prototype);
  renderer.mobileCrop = app.mobileCrop;
  renderer.canvas = { width: 667, height: 375 };
  renderer.presentationCanvas = { width: 667, height: 375 };
  const windowRect = { x: 192, y: 6, w: 282, h: 357 };
  const fit = renderer._fitModeSource(windowRect, true);
  assert.deepStrictEqual(fit, {
    hwnd: undefined, x: 192, y: 44, w: 282, h: 306,
  }, 'landscape Fit keeps both side walls and starts before the stopwatch crown');
  renderer.presentationCanvas = { width: 375, height: 667 };
  assert.strictEqual(renderer._fitModeSource(windowRect, true), windowRect,
    'portrait Fit keeps the full titlebar, menu, stopwatch, and board');
  renderer.presentationCanvas = { width: 667, height: 375 };
  assert.strictEqual(renderer._fitModeSource(windowRect, false), windowRect,
    'a dialog or menu restores the complete native window');
  console.log('PASS Rodent phone Fit preserves the HUD and full portrait window');
}
