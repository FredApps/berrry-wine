#!/usr/bin/env node
'use strict';

// Bounded sequentially-consistent protocol model, NOT a production tracker.
// Each step is one indivisible action. Flushers for a page are serialized.
// A page copy is abstracted to a snapshot; torn/multi-byte stores, page reuse,
// generation wrap and incomplete write notification are outside this model.
const assert = require('assert');

function explore({ protocol, writers, flushes, initiallyDirty }) {
  const programs = writers.map((value, id) => {
    const steps = [
      ['read', s => { s.w[id].stamp = s.state; }],
      ['mark', s => {
        if (protocol === 'premark' || !(s.w[id].stamp & 1)) s.state |= 1;
      }],
      ['store', s => { s.memory = value; s.memoryVersion++; }],
    ];
    if (protocol === 'generation') steps.push(
      ['check', s => { s.w[id].repair = (s.state >>> 1) !== (s.w[id].stamp >>> 1); }],
      ['repair', s => { if (s.w[id].repair) s.state |= 1; }],
    );
    return steps.map(([label, step]) => [`w${id}.${label}`, step]);
  });
  const flushProgram = [];
  for (let i = 0; i < flushes; i++) {
    flushProgram.push([`f${i}.claim`, s => {
      s.copy = !!(s.state & 1);
      // A single atomic CAS in a real candidate must advance the generation
      // and clear DIRTY together, retrying if a writer changes the word.
      if (s.copy) s.state = protocol === 'generation' ? (s.state + 2) & ~1 : 0;
    }]);
    flushProgram.push([`f${i}.copy`, s => {
      if (s.copy) { s.disk = s.memory; s.diskVersion = s.memoryVersion; }
    }]);
  }
  programs.push(flushProgram);
  let schedules = 0, lost = 0, witness;
  function visit(state, positions, trace) {
    let done = true;
    for (let id = 0; id < programs.length; id++) {
      if (positions[id] === programs[id].length) continue;
      done = false;
      const next = { ...state, w: state.w.map(w => ({ ...w })) };
      const nextPositions = positions.slice();
      const [name, step] = programs[id][nextPositions[id]++];
      step(next);
      visit(next, nextPositions, [...trace, name]);
    }
    if (!done) return;
    schedules++;
    // Track write identity, not byte differences: a write-then-restore must
    // remain pending unless a flush actually observed the last store.
    if (!(state.state & 1) && state.diskVersion !== state.memoryVersion) {
      lost++;
      if (!witness) witness = trace;
    }
    // Drain pending dirty state once all writers are quiescent.
    if (state.state & 1) {
      state.disk = state.memory;
      state.diskVersion = state.memoryVersion;
    }
    if (protocol === 'generation') {
      assert.strictEqual(state.diskVersion, state.memoryVersion);
      assert.strictEqual(state.disk, state.memory);
    }
  }
  visit({ state: initiallyDirty ? 1 : 0, memory: 0, disk: 0,
    memoryVersion: 0, diskVersion: 0, copy: false, w: writers.map(() => ({})) },
  programs.map(() => 0), []);
  return { schedules, lost, witness };
}

const naive = explore({ protocol: 'premark', writers: [1], flushes: 1, initiallyDirty: false });
assert(naive.lost > 0, 'negative control must exhibit a lost write');
console.log('Premark lost-write witness: ' + naive.witness.join(' -> '));
let total = 0;
for (const initiallyDirty of [false, true]) {
  for (const writers of [[1], [1, 2], [1, 0]]) {
    for (const flushes of [1, 2]) {
      const result = explore({ protocol: 'generation', writers, flushes, initiallyDirty });
      assert.strictEqual(result.lost, 0);
      total += result.schedules;
    }
  }
}
console.log(`PASS generation recheck model: ${total} schedules, including write/restore and initially dirty pages`);
