// Does a DirectSound software mixer keep ahead of the play cursor?
//
// A looping DirectSound buffer is a ring the guest refills behind the play
// cursor. If the guest mixer (fmod, Miles, ...) is late, the cursor sweeps
// into audio it already played a lap ago and plays it again -- the
// stutter/buzz that reads as "bad sound quality". Whether that is happening
// is a timing question about the real page, which headless cannot answer:
// its clock advances 200ms per batch, more than a whole ring.
//
// So this watches the live page. Every Unlock refresh (playRing loop===2)
// diffs the ring into 64-byte cells and stamps changed cells with a new
// generation. A 1ms timer (plus every refresh) samples the play cursor,
// unwraps it, and for every cell the cursor crossed asks: was this cell
// rewritten since the cursor last crossed it? Crossing unchanged NON-SILENT
// audio is a stale replay -- an underrun you can hear. Unchanged silence is
// counted separately; replaying zeros is inaudible.
//
// Also kept: the gaps between guest refreshes and between cursor samples. A
// sample gap longer than one ring lap means the cursor may have lapped the
// writer without us seeing a crossing; those are reported as `blindGaps`.
//
// Read back with read-dsound-underrun.js; disarm with
// window.__dsUnderrun.disarm().

(function () {
  if (window.__dsUnderrun) return 'already armed';
  const wine = window.wine;
  const voices = wine && wine.hostCtx && wine.hostCtx._voices;
  if (!voices || typeof voices.playRing !== 'function') return 'no hostCtx._voices on this page';
  const getMemory = () => wine.hostCtx.getMemory();
  const CELL = 64;
  const now = () => performance.now();

  const state = {
    armedAt: now(),
    rings: {},       // voice id -> ring tracker
    restores: [],
  };

  const bytesPerSec = (v) => Math.max(1, v.rate * v.channels * (v.bits / 8));

  const ringFor = (id, ptr, len) => {
    let r = state.rings[id];
    if (!r || r.len !== len || r.ptr !== ptr) {
      const cells = Math.ceil(len / CELL);
      r = state.rings[id] = {
        id, ptr, len, cells,
        snap: null,
        gen: new Uint32Array(cells),
        playedGen: new Uint32Array(cells),
        crossedOnce: new Uint8Array(cells),
        lastPos: null, lastSampleAt: null, lastRefreshAt: null,
        refreshes: 0, refreshGaps: [], sampleGaps: [],
        crossed: 0, fresh: 0, staleAudible: 0, staleSilent: 0, staleQuiet: 0, torn: 0,
        blindGaps: 0, blindGapMaxMs: 0,
        perSecond: [],   // [{t, fresh, stale}]
        lapMs: 0,
        leadHist: {}, spanHist: {}, emptyRefreshes: 0, events: [], lastStaleCell: -1, backJumps: 0, backMaxBytes: 0, drift: [], guestFallbacks: 0, routed: false,
      };
      const v = voices._map && voices._map[id];
      if (v) r.lapMs = len / bytesPerSec(v) * 1000;
    }
    return r;
  };

  const secondBucket = (r, t) => {
    const s = Math.floor((t - state.armedAt) / 1000);
    let b = r.perSecond[r.perSecond.length - 1];
    if (!b || b.s !== s) { b = { s, fresh: 0, stale: 0, refreshes: 0 }; r.perSecond.push(b); }
    return b;
  };

  const cellSilent = (r, c) => {
    const mem = new Uint8Array(getMemory(), r.ptr + c * CELL, Math.min(CELL, r.len - c * CELL));
    for (let i = 0; i < mem.length; i++) if (mem[i]) return false;
    return true;
  };

  // Near-silence that is not all zeros: a mixer idling at -1, or dither.
  // Rewriting it produces identical bytes, so it reads as unchanged -- and
  // it is inaudible either way. Judged on 16-bit samples within +-8.
  const cellQuiet = (r, c) => {
    const n = Math.min(CELL, r.len - c * CELL) >> 1;
    const mem = new Int16Array(getMemory(), r.ptr + c * CELL, n);
    for (let i = 0; i < n; i++) if (mem[i] > 8 || mem[i] < -8) return false;
    return true;
  };

  // The AUDIBLE cursor: where the thing making sound actually is. A routed
  // voice's worklet publishes it, so getPos() is already that. Otherwise
  // getPos() is derived from the guest clock, which is not the clock the
  // AudioBufferSource plays on; the source's own start instant is.
  const audiblePos = (r, v) => {
    if (v.workletNode) return voices.getPos(r.id) >>> 0;
    const ac = voices._ac;
    if (!ac || typeof v.playStart !== 'number' || !v.currentSrc) return null;
    const rateScale = v.freq && v.freq !== v.rate ? v.freq / v.rate : 1;
    const bytes = Math.floor((ac.currentTime - v.playStart) * bytesPerSec(v) * rateScale);
    const frame = Math.max(1, v.channels * (v.bits / 8));
    return ((bytes - bytes % frame) % r.len + r.len) % r.len;
  };

  // Walk the cursor from the last sample to `pos` and judge each crossed cell.
  const sample = (r, t) => {
    const v = voices._map && voices._map[r.id];
    if (!v) return;
    const guestPos = voices.getPos(r.id) >>> 0;
    const heard = audiblePos(r, v);
    r.routed = !!v.workletNode;
    const pos = heard === null ? guestPos : heard;
    if (heard === null) r.guestFallbacks++;
    else {
      // How far the cursor the guest is told about sits from the audible one:
      // positive = the guest thinks playback is further along than it is.
      let d = (guestPos - heard) % r.len;
      if (d >= r.len / 2) d -= r.len;
      if (d < -r.len / 2) d += r.len;
      if (r.drift.length < 20000) r.drift.push(d / bytesPerSec(v) * 1000);
    }
    if (r.lastPos === null) { r.lastPos = pos; r.lastSampleAt = t; return; }
    const gap = t - r.lastSampleAt;
    r.sampleGaps.push(gap);
    if (r.lapMs && gap > r.lapMs * 0.9) {
      r.blindGaps++;
      if (gap > r.blindGapMaxMs) r.blindGapMaxMs = gap;
    }
    const delta = (pos - r.lastPos + r.len) % r.len;
    // The guest cursor can step BACKWARDS a little (output latency is
    // subtracted from it and Chrome revises that number). Read literally,
    // a small step back is a whole lap forward, which would stamp every cell
    // as played and turn the next real crossings into false stale replays.
    // Hold the cursor where it was and count it instead.
    // Only when the clock says little time passed: a late sample (the page
    // busy for 40ms+) is a genuine forward move past half the ring.
    const expected = gap * bytesPerSec(v) / 1000;
    if (delta > r.len / 2 && expected < r.len / 2) {
      r.backJumps++;
      r.backMaxBytes = Math.max(r.backMaxBytes, r.len - delta);
      r.lastSampleAt = t;
      return;
    }
    const b = secondBucket(r, t);
    let c = Math.floor(r.lastPos / CELL);
    const endCell = Math.floor(pos / CELL);
    // Cells whose START the cursor passed in (lastPos, pos].
    let steps = Math.ceil(delta / CELL);
    while (steps-- > 0) {
      c = (c + 1) % r.cells;
      r.crossed++;
      if (!r.crossedOnce[c]) { r.crossedOnce[c] = 1; r.playedGen[c] = r.gen[c]; continue; }
      if (r.gen[c] !== r.playedGen[c]) { r.fresh++; b.fresh++; }
      else if (cellSilent(r, c)) r.staleSilent++;
      else if (cellQuiet(r, c)) r.staleQuiet++;
      else {
        r.staleAudible++; b.stale++;
        if (r.events.length < 600 && r.lastStaleCell !== (c + r.cells - 1) % r.cells) {
          const smp = new Int16Array(getMemory(), r.ptr + c * CELL, 4);
          r.events.push(`S${Math.round(t - state.armedAt)}:c${c}=${Array.from(smp).join('/')}`);
        }
        r.lastStaleCell = c;
      }
      r.playedGen[c] = r.gen[c];
      if (c === endCell) break;
    }
    r.lastPos = pos;
    r.lastSampleAt = t;
  };

  const origPlayRing = voices.playRing;
  voices.playRing = function (id, ptr, len, startOff, loop) {
    const ret = origPlayRing.apply(this, arguments);
    try {
      if (loop === 2) {
        const t = now();
        const r = ringFor(id, ptr, len);
        const cur = new Uint8Array(getMemory(), ptr, len);
        const pos = voices.getPos(id) >>> 0;
        const posCell = Math.floor(pos / CELL);
        if (r.snap) {
          const changed = [];
          for (let c = 0; c < r.cells; c++) {
            const a = c * CELL, e = Math.min(len, a + CELL);
            for (let i = a; i < e; i++) {
              if (cur[i] !== r.snap[i]) {
                r.gen[c]++;
                changed.push(c);
                if (c === posCell) r.torn++;
                break;
              }
            }
          }
          // Where the write landed relative to the play cursor, in cells ahead
          // of it: the writer's lead. Plus how much it wrote.
          if (changed.length) {
            let lo = r.cells;
            for (const c of changed) lo = Math.min(lo, (c - posCell + r.cells) % r.cells);
            const bin = Math.floor(lo / 10) * 10;
            r.leadHist[bin] = (r.leadHist[bin] || 0) + 1;
            if (r.events.length < 600) {
              r.events.push(`W${Math.round(t - state.armedAt)}:c${changed[0]}-${changed[changed.length - 1]}@${posCell}`);
            }
            const sb = Math.floor(changed.length / 10) * 10;
            r.spanHist[sb] = (r.spanHist[sb] || 0) + 1;
          } else r.emptyRefreshes++;
        }
        r.snap = cur.slice();
        if (r.lastRefreshAt !== null) r.refreshGaps.push(t - r.lastRefreshAt);
        r.lastRefreshAt = t;
        r.refreshes++;
        secondBucket(r, t).refreshes++;
        sample(r, t);
      }
    } catch (e) { state.error = String(e && e.stack || e); }
    return ret;
  };
  state.restores.push(() => { voices.playRing = origPlayRing; });

  const timer = setInterval(() => {
    const t = now();
    for (const id of Object.keys(state.rings)) {
      try { sample(state.rings[id], t); } catch (e) { state.error = String(e && e.stack || e); }
    }
  }, 1);
  state.restores.push(() => clearInterval(timer));

  // Baseline of any `?audio-delay` queue, so a read covers only this window.
  state.delayBaseline = {};
  for (const [id, v] of Object.entries(voices._map || {})) {
    if (!v || !v.delayQ) continue;
    const st = v.delayQ.stats;
    state.delayBaseline[id] = { bytes: st.bytes, chunks: st.chunks, underruns: st.underruns, gapMs: st.gapMs,
      skips: st.skips, lead: st.leadMs.length };
  }
  state.disarm = () => { for (const f of state.restores.splice(0)) f(); return 'disarmed'; };
  window.__dsUnderrun = state;
  return 'armed';
})();
