#!/usr/bin/env node
'use strict';

// The browser run loop used to upload the DirectDraw frame and composite the
// desktop at the end of every scheduler step. Steps outnumber display frames
// (Moorhuhn 3: ~90 guest presents/s on a 60 Hz page), so every upload past
// one per frame was overwritten unseen. host.js now only notes a waiting
// frame at the step boundary and uploads from requestAnimationFrame.
//
// This drives host.js's real Worker run loop in a vm context with a fake rAF
// and checks the contract:
//   - N presents inside one display frame produce ONE upload, of the newest
//   - no upload happens before the rAF (the boundary only arms it)
//   - a rAF that fires while a Worker slice holds publication makes the
//     frame due, and the slice's own boundary publishes it
//   - stop() flushes a pending frame and drops the rAF
//   - an idle loop arms no rAF at all
//   - with no rAF (a non-DOM host) the boundary presents synchronously
// plus the perf HUD's upload counter, which is what keeps "PRESENT/s" (guest
// presents) and "upload/s" (canvas uploads) apart.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const hostSource = fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8');

function makeHost({ withRaf }) {
  const rafQueue = new Map();
  let rafSeq = 0;
  const context = { URLSearchParams, console, setTimeout, clearTimeout };
  if (withRaf) {
    context.requestAnimationFrame = cb => { rafQueue.set(++rafSeq, cb); return rafSeq; };
    context.cancelAnimationFrame = id => { rafQueue.delete(id); };
  }
  vm.runInNewContext(hostSource + '\n;globalThis.WineAssembly = WineAssembly;', context);
  const wine = new context.WineAssembly();
  if (withRaf) wine.__rafForTest = context.requestAnimationFrame;
  const log = { uploads: [], composites: 0, pacedCalls: 0, unpacedCalls: 0 };
  // The guest's frame counter: each slice "presents" a new frame by bumping
  // it and marking the surface dirty, exactly what dx_trace kind 5 does.
  let guestFrame = 0;
  wine._presentDxIfDirty = paced => {
    if (paced) log.pacedCalls++; else log.unpacedCalls++;
    if (!wine._dxDirty) return 0;
    wine._dxDirty = false;
    log.uploads.push(guestFrame);
    return 1;
  };
  let held = false;
  wine.renderer = {
    inputQueue: [], _inputPendingPublishers: new Set(),
    _repaintScheduled: false, _repaintPending: false, _workerRepaintDeferred: false,
    beginWorkerGuestSlice() { held = true; },
    endWorkerGuestSlice() { held = false; },
    _workerPublicationHeld() { return held; },
    flushRepaint(force) {
      if (this._repaintScheduled || force) { this._repaintScheduled = false; log.composites++; }
    },
  };
  const present = () => { guestFrame++; wine._dxDirty = true; };
  const fireRaf = () => {
    const cbs = [...rafQueue.values()];
    rafQueue.clear();
    for (const cb of cbs) cb();
    return cbs.length;
  };
  return { wine, log, present, fireRaf, rafQueue, isHeld: () => held };
}

// Drive host.js's own Worker loop (_runThreaded) with a controllable slice.
function driveWorkerLoop(h) {
  const { wine } = h;
  const scheduled = [];
  const resolvers = [];
  wine._scheduleStep = step => scheduled.push(step);
  wine._beginGuestTickBatch = () => {};
  wine._guestTickMs = () => 0;
  wine.instance = { exports: {} };
  wine.guestWorker = {
    broker: { publish() {} },
    slice() { return new Promise(resolve => resolvers.push(resolve)); },
  };
  wine.running = true;
  wine._runThreaded(1000);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  // Finish the in-flight slice (optionally presenting inside it), let the
  // boundary run, and start the next slice.
  const finishSlice = async ({ presents = 0, next = true } = {}) => {
    for (let i = 0; i < presents; i++) h.present();
    resolvers.shift()({ eip: 1, yield: 0, focusHwnd: 0, blocks: 1000, ms: 1 });
    await tick();
    if (next) {
      assert.strictEqual(scheduled.length, 1, 'a completed slice schedules its successor');
      scheduled.shift()();
    }
  };
  return { finishSlice, resolvers, scheduled };
}

(async () => {
  // ---- many presents in one display frame -> one upload -------------------
  {
    const h = makeHost({ withRaf: true });
    const loop = driveWorkerLoop(h);
    // The first slice is in flight: presents land inside it.
    await loop.finishSlice({ presents: 2 });
    await loop.finishSlice({ presents: 1 });
    await loop.finishSlice({ presents: 3 });
    assert.deepStrictEqual(h.log.uploads, [],
      'a step boundary must not upload; it only arms the display frame');
    assert.strictEqual(h.rafQueue.size, 1, 'three dirty boundaries share one pending rAF');
    // The rAF fires between slices (publication not held).
    h.wine.renderer.endWorkerGuestSlice();
    assert.strictEqual(h.fireRaf(), 1);
    assert.deepStrictEqual(h.log.uploads, [6],
      'six guest presents inside one frame produce exactly one upload, of the newest frame');
    assert.strictEqual(h.log.pacedCalls, 1, 'the rAF upload bypasses the wall-clock frame bucket');
    assert.strictEqual(h.log.unpacedCalls, 0);

    // ---- a rAF during a held Worker slice -> published at the boundary ----
    h.wine.renderer.beginWorkerGuestSlice();
    await loop.finishSlice({ presents: 1 });          // arms a rAF
    h.wine.renderer.beginWorkerGuestSlice();          // next slice in flight
    assert.strictEqual(h.fireRaf(), 1);
    assert.deepStrictEqual(h.log.uploads, [6],
      'nothing is published while the Worker slice holds publication');
    assert.strictEqual(h.wine._presentFrameDue, true, 'the missed frame is remembered as due');
    await loop.finishSlice({ presents: 1 });
    assert.deepStrictEqual(h.log.uploads, [6, 8],
      'the due frame is published at the very next slice boundary, newest pixels');
    assert.strictEqual(h.rafQueue.size, 0, 'publishing at the boundary consumes the frame');

    // ---- idle: no rAF armed -----------------------------------------------
    await loop.finishSlice({ presents: 0 });
    assert.strictEqual(h.rafQueue.size, 0, 'an idle boundary must not arm a rAF');

    // ---- stop flushes the pending frame -----------------------------------
    await loop.finishSlice({ presents: 1, next: false });
    assert.strictEqual(h.rafQueue.size, 1, 'a dirty boundary armed a rAF');
    h.wine.renderer.endWorkerGuestSlice();
    try { h.wine.stop({ repaint: false }); } catch (_) {}
    assert.deepStrictEqual(h.log.uploads, [6, 8, 9], 'stop() puts the final frame on the canvas');
    assert.strictEqual(h.rafQueue.size, 0, 'stop() drops the pending rAF (it would hold the host alive)');
  }

  // ---- a trap stops the loop before its boundary: stop still flushes -------
  {
    const h = makeHost({ withRaf: true });
    const loop = driveWorkerLoop(h);
    h.wine.logToUI = () => {};
    h.present();
    h.wine.renderer.endWorkerGuestSlice();
    loop.resolvers.shift()({ eip: 1, yield: 0, focusHwnd: 0, blocks: 1000, ms: 1,
      trapped: 'unreachable', regs: {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(h.rafQueue.size, 0, 'a trapped slice never reached its boundary');
    assert.deepStrictEqual(h.log.uploads, [1],
      'stop() uploads a dirty frame even when no rAF was armed for it');
  }

  // ---- GDI-only composite is paced the same way ---------------------------
  {
    const h = makeHost({ withRaf: true });
    const loop = driveWorkerLoop(h);
    h.wine.renderer._repaintScheduled = true;
    await loop.finishSlice();
    h.wine.renderer._repaintScheduled = true;
    await loop.finishSlice();
    assert.strictEqual(h.log.composites, 0, 'no composite at a step boundary');
    h.wine.renderer.endWorkerGuestSlice();
    h.fireRaf();
    assert.strictEqual(h.log.composites, 1, 'one composite per display frame');
    h.wine.running = false;
  }

  // ---- the renderer's own rAF does not composite the frame a second time ---
  // Its scheduleRepaint() arms a rAF during the step, i.e. before the present
  // rAF, so left alone it composites first (without the new DX frame) and the
  // present composites again: two composites per display frame.
  {
    const h = makeHost({ withRaf: true });
    const loop = driveWorkerLoop(h);
    const r = h.wine.renderer;
    r._repaintRaf = null;
    r.scheduleRepaint = function () {
      if (this._repaintScheduled) return;
      this._repaintScheduled = true;
      if (this._repaintRaf !== null) return;
      this._repaintRaf = h.wine.__rafForTest(() => {
        this._repaintRaf = null;
        if (this._repaintScheduled) { this._repaintScheduled = false; h.log.composites++; }
      });
    };
    // Like host-imports' _presentDxSurfaceToMainWindow: an upload schedules
    // the composite that will show it.
    const upload = h.wine._presentDxIfDirty;
    h.wine._presentDxIfDirty = paced => {
      const n = upload(paced);
      if (n) r.scheduleRepaint();
      return n;
    };
    for (let frame = 1; frame <= 3; frame++) {
      h.present(); r.scheduleRepaint();          // guest draws inside the slice
      await loop.finishSlice();
      h.present(); r.scheduleRepaint();
      await loop.finishSlice();
      r.endWorkerGuestSlice();
      h.fireRaf();
      r.beginWorkerGuestSlice();
      assert.strictEqual(h.log.composites, frame, `one composite per display frame (frame ${frame})`);
      assert.strictEqual(h.log.uploads.length, frame, `one upload per display frame (frame ${frame})`);
    }
    h.wine.running = false;
  }

  // ---- no requestAnimationFrame: synchronous, as before --------------------
  {
    const h = makeHost({ withRaf: false });
    const loop = driveWorkerLoop(h);
    await loop.finishSlice({ presents: 1 });
    assert.deepStrictEqual(h.log.uploads, [1], 'without rAF the boundary uploads synchronously');
    assert.strictEqual(h.log.unpacedCalls >= 1, true, 'and keeps the wall-clock throttle');
    assert.strictEqual(h.log.composites >= 1, true, 'and composites with flushRepaint(true)');
    h.wine.running = false;
  }

  // ---- perf HUD: uploads counted apart from guest presents ----------------
  {
    let time = 1000;
    const sandbox = { performance: { now: () => time } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'perf-hud.js'), 'utf8'), sandbox);
    const hud = sandbox.WinePerf;
    hud.frameUpload(1, 1);
    assert.strictEqual(hud.uploads.length, 0, 'a disabled HUD records nothing');
    hud.enabled = true;
    hud._startedAt = time;
    for (let i = 0; i < 60; i++) {
      time += 16.7;
      hud.guestFrame(); hud.guestFrame();         // guest presents twice a frame
      hud.frameUpload(2, 1);                        // page uploads once
    }
    const s = hud.snapshot();
    assert(Math.abs(s.uploadsPerSec - s.guestFps / 2) < 2,
      `uploads/s (${s.uploadsPerSec}) is half of PRESENT/s (${s.guestFps})`);
    assert.strictEqual(s.uploadsTotal, 60);
    assert.strictEqual(s.steps, 0, 'out-of-step flushes are not counted as steps');
    assert(Math.abs(s.phaseMs.present - 120) < 1e-6, 'but their time is present-phase time');
    assert(s.presentMsPerSec > 100 && s.presentMsPerSec < 140,
      `present ms/s is absolute (${s.presentMsPerSec})`);
    hud.stepBegin();
    hud.frameUpload(3, 0);
    hud.stepEnd();
    assert.strictEqual(hud.snapshot().uploadsTotal, 60, 'a flush that moved no pixels is not an upload');
  }

  console.log('PASS browser present is coalesced to one upload per display frame');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
