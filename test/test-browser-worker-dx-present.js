#!/usr/bin/env node
'use strict';

// The browser's guest-main Worker loop has its own slice boundary. DirectDraw
// writes happen in shared memory, but uploading that shared primary to the
// renderer remains main-thread work. Missing this one call left _dxDirty set
// indefinitely: AoE II accepted Single Player and created its EDIT child while
// the browser kept displaying the old menu frame.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8');
const start = source.indexOf('_runThreaded(stepsPerSlice)');
const end = source.indexOf('// Schedule the next guest slice.', start);
assert(start >= 0 && end > start, 'host.js should contain the browser Worker run loop');

const loop = source.slice(start, end);
const rendezvous = loop.search(
  /await Promise\.all\(\[runMainThenEnd\(\), runThreads\(\)\]\)/);
// The boundary no longer uploads by itself: it arms the display-frame present
// (or publishes a frame that fell due mid-slice). test-host-raf-present.js
// drives that behaviour; this pins where the boundary sits.
const boundary = loop.indexOf('self._presentAtBoundary(perf)', rendezvous);

assert(rendezvous >= 0, 'Worker loop should await its guest slice rendezvous');
assert(boundary > rendezvous,
  'Worker slice boundary must publish DirectDraw surfaces dirtied by guest RPC');

// And the one presenter uploads the DirectDraw frame before compositing it.
const presentNow = source.indexOf('  _presentNow() {');
const presentNowEnd = source.indexOf('\n  }\n', presentNow);
assert(presentNow >= 0 && presentNowEnd > presentNow, 'host.js should define _presentNow');
const body = source.slice(presentNow, presentNowEnd);
const upload = body.indexOf('this._presentDxIfDirty(true)');
const composite = body.indexOf('r.flushRepaint(');
assert(upload >= 0 && composite > upload,
  'Worker DirectDraw upload must happen before the renderer composites the frame');

console.log('PASS browser Worker slice uploads dirty DirectDraw frames before compositing');
