#!/usr/bin/env node
// The launch progress window's rules, on a fake clock (lib/launch-progress.js).
//
// WHY: the window must appear only when a launch is still pending 500ms after
// the user asked for it, from one deadline that phase changes do not reset,
// and must never flash on a fast launch, after a cancel, or from a stale timer
// left by an earlier launch. Its numbers must be honest: no percentage, bar or
// time estimate until every file's size is known, no transfer rate from cache
// hits. Those are timing and arithmetic rules, so they are checked here with an
// injected clock and a recording view rather than in a browser, where 500ms
// boundaries are at the mercy of machine load
// (ops/handoffs/claude-launch-ux-design-20261003.md, section 3D).

'use strict';

const assert = require('assert');
const { createLaunchController, createDomView } = require('../lib/launch-progress');

function harness() {
  let t = 0;
  let nextId = 1;
  const timers = new Map();
  const log = [];
  const view = {
    visible: false,
    model: null,
    shows: 0,
    show(m) { this.visible = true; this.model = m; this.shows++; log.push(['show', t, m.kind, m.title]); },
    render(m) { this.model = m; log.push(['render', t, m.kind, m.title]); },
    hide() { this.visible = false; log.push(['hide', t]); },
  };
  const ui = createLaunchController({
    now: () => t,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: id => timers.delete(id),
    view,
    host: 'example.test',
  });
  // Advance the clock, firing due timers in deadline order. `before` runs
  // at the exact deadline but ahead of the timer callbacks due then -- the
  // "finished at 500ms, before the timer task ran" interleaving.
  function advance(to, before) {
    for (;;) {
      const due = [...timers.entries()].filter(([, x]) => x.at <= to)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      t = due[1].at;
      if (before && t >= before.at && !before.done) { before.done = true; before.fn(); }
      if (!timers.has(due[0])) continue;
      timers.delete(due[0]);
      due[1].fn();
    }
    t = to;
    if (before && !before.done) { before.done = true; before.fn(); }
  }
  return { ui, view, log, advance, timers, get t() { return t; } };
}

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('ready at 499ms never shows anything and leaves no timer behind', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'sol', label: 'Solitaire' });
  h.advance(499);
  launch.ready();
  h.advance(5000);
  assert.strictEqual(h.view.shows, 0);
  assert.strictEqual(h.timers.size, 0, 'the reveal timer must be cleared');
});

test('ready at exactly 500ms, before the timer callback runs, does not show', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'sol' });
  h.advance(600, { at: 500, fn: () => launch.ready() });
  assert.strictEqual(h.view.shows, 0);
});

test('still pending at 500ms shows once; ready at 501ms hides at once', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'sol' });
  h.advance(500);
  assert.strictEqual(h.view.shows, 1);
  assert.strictEqual(h.view.visible, true);
  h.advance(501);
  launch.ready();
  assert.strictEqual(h.view.visible, false, 'no minimum display time');
  assert.deepStrictEqual(h.log[h.log.length - 1], ['hide', 501]);
});

test('phase changes do not reset the deadline', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'sol' });
  h.advance(200); launch.beginBatch('SOL.EXE', 1);
  h.advance(400); launch.setPhase('loading');
  assert.strictEqual(h.view.shows, 0);
  h.advance(500);
  assert.strictEqual(h.view.shows, 1, 'shown at 500ms from launch start');
  h.advance(700); launch.setPhase('starting');
  assert.strictEqual(h.view.shows, 1, 'shown once');
});

test('the deadline counts from startedAt, not from when begin() ran', () => {
  const h = harness();
  h.advance(450);
  h.ui.begin({ appId: 'sol', mode: 'direct', startedAt: 0 });
  h.advance(499);
  assert.strictEqual(h.view.shows, 0);
  h.advance(500);
  assert.strictEqual(h.view.shows, 1);
});

test('cancel at 300ms: the timer fires at 500ms and shows nothing', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'sol' });
  h.advance(300);
  launch.cancelled();
  h.advance(2000);
  assert.strictEqual(h.view.shows, 0);
});

test('a direct link that is cancelled says so instead of leaving a black page', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'sol', label: 'Solitaire', mode: 'direct' });
  h.advance(800);
  launch.cancelled();
  assert.strictEqual(h.view.model.kind, 'cancelled');
  assert.deepStrictEqual(h.view.model.buttons.map(b => b.id), ['desktop', 'again']);
});

test('failure at 300ms shows the error window directly, no loading window first', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'diablo', label: 'Diablo' });
  h.advance(300);
  launch.fail({ file: 'DIABDAT.MPQ', reason: 'server error (HTTP 503)', attempts: 3 });
  assert.strictEqual(h.view.shows, 1);
  assert.strictEqual(h.log[0][2], 'error', 'the first thing shown is the error');
  assert.strictEqual(h.view.model.title, 'Download error');
  assert(h.view.model.status[0].includes('after 3 attempts'));
  assert.deepStrictEqual(h.view.model.buttons.map(b => b.id), ['details', 'close', 'retry']);
  h.advance(5000);
  assert.strictEqual(h.view.model.kind, 'error', 'a later timer never replaces the error');
});

test('a stale timer from a cancelled launch cannot reveal the next one early', () => {
  const h = harness();
  const a = h.ui.begin({ appId: 'a' });
  h.advance(100); a.cancelled();
  h.advance(200);
  h.ui.begin({ appId: 'b' });
  h.advance(500);
  assert.strictEqual(h.view.shows, 0, "A's 500ms is not B's");
  h.advance(699);
  assert.strictEqual(h.view.shows, 0);
  h.advance(700);
  assert.strictEqual(h.view.shows, 1);
  assert(h.view.model.title.includes('b'));
});

test('a ready launch A and a slow launch B on the desktop', () => {
  const h = harness();
  const a = h.ui.begin({ appId: 'a' });
  h.advance(100); a.ready();
  h.advance(450);
  const b = h.ui.begin({ appId: 'b' });
  h.advance(949);
  assert.strictEqual(h.view.shows, 0);
  h.advance(950);
  assert.strictEqual(h.view.shows, 1);
  b.ready();
  assert.strictEqual(h.view.visible, false);
});

test('a launch superseded before its deadline never shows', () => {
  const h = harness();
  h.ui.begin({ appId: 'a' });
  h.advance(200);
  const b = h.ui.begin({ appId: 'b' });
  h.advance(600);
  assert.strictEqual(h.view.shows, 0);
  b.ready();
  h.advance(2000);
  assert.strictEqual(h.view.shows, 0);
});

test('a launch-owned prompt holds the reveal until it closes', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'blobby' });
  launch.promptOpen();
  h.advance(2000);
  assert.strictEqual(h.view.shows, 0, 'never under the prompt');
  launch.promptClose();
  assert.strictEqual(h.view.shows, 1, 'revealed as soon as the prompt closes');
});

test('a prompt that closes before 500ms leaves the normal deadline', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'blobby' });
  launch.promptOpen();
  h.advance(100);
  launch.promptClose();
  assert.strictEqual(h.view.shows, 0);
  h.advance(500);
  assert.strictEqual(h.view.shows, 1);
});

test('Retry keeps the error window up and only becomes progress at its own deadline', () => {
  const h = harness();
  const first = h.ui.begin({ appId: 'diablo', label: 'Diablo' });
  h.advance(1000);
  first.fail({ file: 'X.MPQ', reason: 'network error' });
  const second = h.ui.begin({ appId: 'diablo', label: 'Diablo', retryOf: first });
  assert.strictEqual(h.view.visible, true);
  assert.strictEqual(h.view.model.kind, 'error');
  assert.deepStrictEqual(h.view.model.status, ['Retrying…']);
  h.advance(1499);
  assert.strictEqual(h.view.model.kind, 'error');
  h.advance(1500);
  assert.strictEqual(h.view.model.kind, 'progress');
  second.ready();
  assert.strictEqual(h.view.visible, false);
});

test('a Retry that finishes fast takes the window down without a progress flash', () => {
  const h = harness();
  const first = h.ui.begin({ appId: 'diablo' });
  first.fail({ file: 'X.MPQ', reason: 'network error' });
  const second = h.ui.begin({ appId: 'diablo', retryOf: first });
  h.advance(200);
  second.ready();
  assert.strictEqual(h.view.visible, false);
  assert(!h.log.some(e => e[0] !== 'hide' && e[2] === 'progress'), 'never rendered progress');
});

test('unknown sizes: no percentage, no bar fill, "Not known"', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'diablo', label: 'Diablo' });
  launch.beginBatch('Diablo (2 files)', 2);
  launch.transfer({ kind: 'start', id: 1, url: 'a/DIABLO.EXE', total: 1000 });
  launch.transfer({ kind: 'start', id: 2, url: 'a/DIABDAT.MPQ', total: null });
  launch.transfer({ kind: 'progress', id: 1, loaded: 500 });
  h.advance(600);
  const m = h.view.model;
  assert.strictEqual(m.title, 'Downloading Diablo');
  assert.deepStrictEqual(m.bar, { determinate: false });
  assert.match(m.rows[0][1], /^Not known \(500 bytes copied\)$/);
  assert(m.rows.some(r => r[1].includes('size not reported by server')));
});

test('not every file started yet: still no percentage even with sizes so far', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'x', label: 'X' });
  launch.beginBatch('X (3 files)', 3);
  launch.transfer({ kind: 'start', id: 1, url: 'a', total: 100 });
  launch.transfer({ kind: 'start', id: 2, url: 'b', total: 100 });
  h.advance(600);
  assert.strictEqual(h.view.model.bar.determinate, false);
  launch.transfer({ kind: 'start', id: 3, url: 'c', total: 100 });
  launch.transfer({ kind: 'progress', id: 1, loaded: 60 });
  const m = h.ui.current.model();
  assert.strictEqual(m.bar.determinate, true);
  assert.strictEqual(m.bar.percent, 20);
  assert.strictEqual(m.title, '20% of X (3 files)');
  assert.strictEqual(m.rows[0][1], 'Not known (60 bytes of 300 bytes copied)', 'no rate yet, so no estimate');
});

test('rate and time left appear only after 2s of network bytes', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'x', label: 'X' });
  launch.beginBatch('X', 1);
  launch.transfer({ kind: 'start', id: 1, url: 'big.dat', total: 10 * 1024 * 1024 });
  for (let ms = 100; ms <= 1900; ms += 100) {
    h.advance(ms);
    launch.transfer({ kind: 'progress', id: 1, loaded: ms * 1024 });
  }
  let m = launch.model();
  assert(!m.rows.some(r => r[0] === 'Transfer rate:'), 'no rate before 2s');
  for (let ms = 2000; ms <= 3000; ms += 100) {
    h.advance(ms);
    launch.transfer({ kind: 'progress', id: 1, loaded: ms * 1024 });
  }
  m = launch.model();
  const rate = m.rows.find(r => r[0] === 'Transfer rate:');
  assert(rate, 'a rate after 2s of data');
  assert.strictEqual(rate[1], '1000 KB/Sec');
  assert.match(m.rows[0][1], /^\d+ sec \(2\.9 MB of 10\.0 MB copied\)$/);
});

test('cache hits are counted, never timed', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'x', label: 'X' });
  launch.beginBatch('X (2 files)', 2);
  launch.transfer({ kind: 'start', id: 1, url: 'a.dll', total: 4096 });
  launch.transfer({ kind: 'progress', id: 1, loaded: 4096, source: 'cache' });
  launch.transfer({ kind: 'done', id: 1, loaded: 4096, source: 'cache' });
  launch.transfer({ kind: 'start', id: 2, url: 'b.dat', total: 8192 });
  h.advance(3000);
  const m = launch.model();
  assert.deepStrictEqual(m.rows.find(r => r[0] === 'From cache:'), ['From cache:', '1 of 2 files']);
  assert(!m.rows.some(r => r[0] === 'Transfer rate:'), 'cached bytes are not a transfer rate');
});

test('a stall of 8s says so and names the file', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'x', label: 'X' });
  launch.beginBatch('X', null);
  launch.transfer({ kind: 'start', id: 1, url: 'DIABDAT.MPQ', total: null });
  launch.transfer({ kind: 'progress', id: 1, loaded: 1000 });
  h.advance(9000);
  const m = launch.model();
  assert.deepStrictEqual(m.rows.find(r => r[0] === 'Transfer rate:'),
    ['Transfer rate:', 'Waiting — no data for 9 sec']);
  assert.deepStrictEqual(m.status, ['Waiting for DIABDAT.MPQ — the network is slow.']);
});

test('the percentage never goes backwards inside a batch', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'x', label: 'X' });
  launch.beginBatch('X', 1);
  launch.transfer({ kind: 'start', id: 1, url: 'a', total: 100 });
  launch.transfer({ kind: 'progress', id: 1, loaded: 50 });
  assert.strictEqual(launch.model().bar.percent, 50);
  launch.transfer({ kind: 'progress', id: 1, loaded: 50, total: 200 });
  assert.strictEqual(launch.model().bar.percent, 50);
});

test('the starting phase is a status line, not a percentage', () => {
  const h = harness();
  const launch = h.ui.begin({ appId: 'sol', label: 'Solitaire' });
  launch.beginBatch('SOL.EXE', 1);
  launch.transfer({ kind: 'start', id: 1, url: 'sol.exe', total: 100 });
  launch.transfer({ kind: 'done', id: 1, loaded: 100, source: 'network' });
  launch.setPhase('starting');
  h.advance(7000);
  const m = launch.model();
  assert.strictEqual(m.title, 'Starting Solitaire');
  assert.strictEqual(m.bar, null);
  assert.deepStrictEqual(m.status, ['Starting Solitaire…',
    "Waiting for the program's first window (0:07 elapsed)."]);
  assert.deepStrictEqual(m.rows, [['Downloaded:', '1 file, 100 bytes']]);
});

test('actions route to the launch on screen', () => {
  const h = harness();
  let cancelled = 0;
  const launch = h.ui.begin({ appId: 'x', handlers: { cancel: () => { cancelled++; } } });
  h.ui.action('cancel');
  assert.strictEqual(cancelled, 0, 'nothing on screen, nothing to cancel');
  h.advance(500);
  h.ui.action('cancel');
  assert.strictEqual(cancelled, 1);
  launch.cancelled();
  assert.strictEqual(h.view.visible, false);
});

test('Retry failing before its deadline shows the new error and another Retry', () => {
  const h = harness();
  const first = h.ui.begin({ appId: 'x' });
  first.fail({ message: 'First failure' });
  const retry = h.ui.begin({ appId: 'x', retryOf: first });
  h.advance(100);
  retry.fail({ message: 'Second failure' });
  h.advance(2000);
  assert.strictEqual(h.view.model.kind, 'error');
  assert.deepStrictEqual(h.view.model.status, ['Second failure']);
  assert(h.view.model.buttons.some(b => b.id === 'retry'));
});

test('direct Retry cancelled before its deadline keeps the cancellation actions', () => {
  const h = harness();
  const first = h.ui.begin({ appId: 'x', mode: 'direct' });
  first.fail({ message: 'First failure' });
  const retry = h.ui.begin({ appId: 'x', mode: 'direct', retryOf: first });
  h.advance(100);
  retry.cancelled();
  h.advance(2000);
  assert.strictEqual(h.view.model.kind, 'cancelled');
  assert.deepStrictEqual(h.view.model.buttons.map(b => b.id), ['desktop', 'again']);
});

test('retained Retry window reveals after the last prompt closes past deadline', () => {
  const h = harness();
  const first = h.ui.begin({ appId: 'x' });
  first.fail({ message: 'First failure' });
  const retry = h.ui.begin({ appId: 'x', retryOf: first });
  retry.promptOpen(); retry.promptOpen();
  h.advance(700);
  retry.promptClose();
  assert.deepStrictEqual(h.view.model.status, ['Retrying…']);
  retry.promptClose();
  assert.strictEqual(h.view.model.kind, 'progress');
  assert.strictEqual(retry.retrying, false);
  assert.strictEqual(h.view.shows, 1, 'reuse the visible window');
});

// Minimal DOM transport for the actual createDomView implementation. No view
// logic is copied: nodes retain identity, event listeners, attributes, children
// and a controlled rAF queue. Browser tests own layout and native click synthesis.
function domHarness() {
  const frames = [], actions = [];
  const doc = { activeElement: null, documentElement: {clientWidth: 800, clientHeight: 600},
    defaultView: {requestAnimationFrame: fn => frames.push(fn)} };
  function node(tag) {
    const attrs = new Map(), listeners = new Map(), slots = new Map(), classes = new Set();
    const n = {tagName: tag, dataset: {}, style: {}, children: [], hidden: false, textContent: '',
      classList: {toggle(k, on) { if (on) classes.add(k); else classes.delete(k); }},
      setAttribute(k,v) { attrs.set(k,String(v)); }, getAttribute(k) { return attrs.get(k) ?? null; },
      removeAttribute(k) { attrs.delete(k); },
      addEventListener(k,fn) { listeners.set(k,fn); },
      fire(k) { listeners.get(k)?.({target:n,preventDefault(){},stopPropagation(){}}); },
      appendChild(c) { c.parentNode=n; n.children.push(c); return c; },
      replaceChildren(...children) { for (const c of n.children) c.parentNode=null; n.children=[]; children.forEach(c=>n.appendChild(c)); },
      remove() { if(n.parentNode) n.parentNode.children=n.parentNode.children.filter(c=>c!==n); n.parentNode=null; },
      contains(c) { return c===n || n.children.some(x=>x.contains(c)); },
      focus() { doc.activeElement=n; },
      querySelector(sel) {
        if(sel.startsWith('[data-action=')) return n.children.find(c=>c.dataset.action===sel.match(/"([^"]+)"/)[1]) || null;
        if(sel==='.wa-launch-default') return n.children.find(c=>c.className?.includes('wa-launch-default')) || null;
        if(sel==='button') return n.children.find(c=>c.tagName==='button') || null;
        // Static markup emitted by build(): instantiate each named slot once.
        if(!slots.has(sel)) { const c=node('div'); slots.set(sel,c); n.appendChild(c); }
        return slots.get(sel);
      },
    };
    return n;
  }
  doc.createElement=node; doc.body=node('body');
  const taskHost=node('div'); doc.getElementById=id=>id==='launch-task-buttons'?taskHost:null;
  const view=createDomView(doc,{onAction:a=>actions.push(a)});
  return {view,actions,doc,flush(){while(frames.length) frames.shift()();}};
}

test('actual DOM queued progress cannot overwrite a synchronous failure', () => {
  const h=harness(), launch=h.ui.begin({appId:'x'}), d=domHarness();
  d.view.show(launch.model());
  launch.setPhase('starting'); d.view.render(launch.model());
  launch.fail({message:'Required file failed'}); d.view.render(launch.model());
  d.flush();
  const el=d.view.element;
  assert.strictEqual(el.querySelector('.wa-launch-titletext').textContent,'Download error');
  const retry=el.querySelector('.wa-launch-foot').querySelector('[data-action="retry"]');
  assert(retry); retry.fire('click'); assert.deepStrictEqual(d.actions,['retry']);
});

test('actual DOM keeps action nodes across progress frames and invokes Cancel once', () => {
  const h=harness(), launch=h.ui.begin({appId:'x'}), d=domHarness();
  launch.beginBatch('x',1); launch.transfer({kind:'start',id:1,url:'x.dat',total:100});
  d.view.show(launch.model());
  const foot=d.view.element.querySelector('.wa-launch-foot');
  const pressed=foot.querySelector('[data-action="cancel"]');
  launch.transfer({kind:'progress',id:1,loaded:50}); d.view.render(launch.model()); d.flush();
  assert.strictEqual(foot.querySelector('[data-action="cancel"]'),pressed);
  assert.strictEqual(pressed.parentNode,foot,'pressed node remains attached');
  pressed.fire('click'); assert.deepStrictEqual(d.actions,['cancel']);
});

test('actual DOM progress never takes the keyboard; an error does', () => {
  // NFS III: the game ran behind a direct-link progress window whose Cancel
  // had focus, so the game's own Enter cancelled the launch.
  const h=harness(), launch=h.ui.begin({appId:'x',mode:'direct'}), d=domHarness();
  const m=launch.model();
  assert.strictEqual(m.kind,'progress'); assert(!m.windowed,'direct-link shape');
  d.view.show(m);
  assert.strictEqual(d.doc.activeElement,null,'progress focuses nothing');
  launch.setPhase('starting'); d.view.render(launch.model()); d.flush();
  assert.strictEqual(d.doc.activeElement,null,'still nothing while starting');
  launch.fail({message:'Required file failed'}); d.view.render(launch.model());
  const def=d.view.element.querySelector('.wa-launch-foot').querySelector('.wa-launch-default');
  assert(def); assert.strictEqual(d.doc.activeElement,def,'an error focuses its default button');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n${e.stack}`); }
}
if (failed) { console.log(`${failed} of ${cases.length} failed`); process.exit(1); }
console.log(`PASS  ${cases.length} launch-progress cases`);
