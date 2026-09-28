#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'host.js'), 'utf8');
const RUN_CALL = 'self._runCooperativeSlice(activeStepsPerSlice);';
const runCall = source.indexOf(RUN_CALL);
const completionPump = source.indexOf(
  'self.hostCtx.pumpAudioCompletions();', runCall);
const timerPump = source.indexOf('self._pumpMultimediaTimer();', runCall);
const present = source.indexOf('self._presentAtBoundary(perf)', runCall);

assert(runCall >= 0, 'browser run loop should execute one cooperative guest slice');
assert(completionPump > runCall,
  'browser run loop must pump queued waveOut completions after the guest slice');
assert(timerPump > completionPump,
  'waveOut callbacks must be queued before the multimedia timer callback seam');
assert(present > completionPump,
  'waveOut callbacks must be available before the next DirectDraw present');

const between = source.slice(
  runCall + RUN_CALL.length,
  completionPump);
assert(!between.includes('instance.exports.run('),
  'waveOut completion pumping must happen at the first safe slice boundary');

console.log('PASS browser run loop pumps queued WOM_DONE at a cooperative slice boundary');
