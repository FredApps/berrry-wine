'use strict';

// lib/game-wait.js: the in-game wait window's 500 ms reveal per episode,
// coalescing of parks less than 250 ms apart, close on resume with no minimum
// time, honest byte totals, and Retry/Quit on a failed fetch.

const assert = require('assert');
const { createGameWaitController, REVEAL_DELAY_MS, MERGE_GAP_MS } = require('../lib/game-wait');

assert.strictEqual(REVEAL_DELAY_MS, 500);
assert.strictEqual(MERGE_GAP_MS, 250);

function harness() {
  let t = 0;
  let timers = [];
  const calls = [];
  const view = {
    show: m => calls.push(['show', m.state, m.bytesText]),
    render: m => calls.push(['render', m.state, m.bytesText]),
    hide: () => calls.push(['hide']),
  };
  const c = createGameWaitController({
    now: () => t,
    setTimer: (fn, ms) => { const id = { fn, at: t + ms }; timers.push(id); return id; },
    clearTimer: id => { timers = timers.filter(x => x !== id); },
    view,
  });
  const advance = ms => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      t = next.at;
      next.fn();
    }
    t = end;
  };
  const shows = () => calls.filter(x => x[0] === 'show').length;
  const hides = () => calls.filter(x => x[0] === 'hide').length;
  return { c, advance, calls, shows, hides };
}

(async () => {
  {
    // 499 ms: never shown.
    const h = harness();
    const tok = h.c.begin({ label: 'Diablo', file: 'spawn.mpq' });
    h.advance(499);
    h.c.end(tok);
    h.advance(1000);
    assert.strictEqual(h.shows(), 0);
    assert.strictEqual(h.c.stats.episodes, 1);
  }
  {
    // 500 ms: shown exactly at the deadline, hidden after resume + merge gap.
    const h = harness();
    const tok = h.c.begin({ label: 'Diablo', file: 'spawn.mpq', total: 262144 });
    h.advance(499);
    assert.strictEqual(h.shows(), 0);
    h.advance(1);
    assert.strictEqual(h.shows(), 1);
    assert.deepStrictEqual(h.calls[0], ['show', 'waiting', '0 bytes of 256 KB']);
    h.c.progress(tok, 131072);
    assert.deepStrictEqual(h.calls[h.calls.length - 1], ['render', 'waiting', '128 KB of 256 KB']);
    h.c.end(tok);
    h.advance(249);
    assert.strictEqual(h.hides(), 0);
    h.advance(1);
    assert.strictEqual(h.hides(), 1);
    assert.strictEqual(h.c.visible, false);
  }
  {
    // Parks 249 ms apart are one episode: one reveal over 3 short parks.
    const h = harness();
    let tok = h.c.begin({});
    h.advance(200); h.c.end(tok);
    h.advance(249);
    tok = h.c.begin({});
    h.advance(100);           // 549 ms since the episode began: revealed
    assert.strictEqual(h.shows(), 1);
    h.c.end(tok);
    h.advance(100);
    tok = h.c.begin({});
    h.c.end(tok);
    h.advance(300);
    assert.strictEqual(h.shows(), 1);
    assert.strictEqual(h.hides(), 1);
    assert.strictEqual(h.c.stats.episodes, 1);
  }
  {
    // 251 ms apart: two episodes, neither long enough to show.
    const h = harness();
    let tok = h.c.begin({});
    h.advance(300); h.c.end(tok);
    h.advance(251);
    tok = h.c.begin({});
    h.advance(300); h.c.end(tok);
    h.advance(1000);
    assert.strictEqual(h.shows(), 0);
    assert.strictEqual(h.c.stats.episodes, 2);
  }
  {
    // A stale reveal timer from an ended episode never shows the next one early.
    const h = harness();
    let tok = h.c.begin({});
    h.advance(100); h.c.end(tok);
    h.advance(260);            // episode 1 closed
    tok = h.c.begin({});       // episode 2 starts at t=360
    h.advance(140);            // t=500: episode 1's deadline, not 2's
    assert.strictEqual(h.shows(), 0);
    h.advance(360);
    assert.strictEqual(h.shows(), 1);
    h.c.end(tok);
  }
  {
    // Unknown total: no "x of y", only what arrived.
    const h = harness();
    const tok = h.c.begin({});
    h.c.progress(tok, 2048);
    h.advance(500);
    assert.deepStrictEqual(h.calls[0], ['show', 'waiting', '2 KB so far']);
  }
  {
    // A failure is shown at once and waits for the player.
    const h = harness();
    const tok = h.c.begin({ label: 'Diablo', file: 'spawn.mpq' });
    h.advance(10);
    const answer = h.c.fail(tok, new Error('HttpRangeProvider: x answered 503, expected 206'));
    assert.strictEqual(h.shows(), 1);
    assert.strictEqual(h.c.current.state, 'error');
    assert.match(h.c.current.reason, /HTTP 503/);
    h.advance(5000);
    assert.strictEqual(h.hides(), 0, 'an error stays until answered');
    h.c.action('retry');
    assert.strictEqual(await answer, 'retry');
    assert.strictEqual(h.c.current.state, 'waiting');
    h.c.end(tok);
    h.advance(250);
    assert.strictEqual(h.hides(), 1);

    const tok2 = h.c.begin({});
    const answer2 = h.c.fail(tok2, new Error('Load failed'));
    h.c.action('quit');
    assert.strictEqual(await answer2, 'quit');
    assert.strictEqual(h.c.visible, false);
    assert.strictEqual(h.c.current, null);
  }
  {
    // reset() (instance stopped) answers an open question with quit.
    const h = harness();
    const tok = h.c.begin({});
    const answer = h.c.fail(tok, new Error('x'));
    h.c.reset();
    assert.strictEqual(await answer, 'quit');
  }
  for (const action of ['retry', 'quit', 'reset']) {
    const h = harness();
    const first = h.c.begin({}), second = h.c.begin({});
    const a = h.c.fail(first, new Error('first read failed'));
    const b = h.c.fail(second, new Error('second read failed'));
    if (action === 'reset') h.c.reset(); else h.c.action(action);
    assert.deepStrictEqual(await Promise.all([a, b]),
      [action === 'retry' ? 'retry' : 'quit', action === 'retry' ? 'retry' : 'quit'],
      'every failed reader receives the shared decision');
  }
  console.log('test-game-wait: PASS');
})().catch(e => { console.error(e); process.exit(1); });
