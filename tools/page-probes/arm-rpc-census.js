// Worker mode (`window.WINE_THREADS`): which host imports do guest Workers
// block on, how often, and how long does the page take to answer?
//
// Every synchronous import a guest Worker makes is a postMessage to the page
// plus an Atomics.wait (lib/guest-rpc.js brokerCall), and the page serves it
// only when its event loop gets to that message. So a Worker's throughput is
// capped by (calls it needs) x (time the page takes to answer each). This
// counts served calls per import name and records the gap between
// consecutive serves -- long gaps are the page busy elsewhere.
//
// test/run.js --rpc-census answers the same question headless, where the page
// is not the bottleneck; this one measures the real page.
//
// Read back with read-rpc-census.js; disarm with window.__rpcCensus.disarm().
(function () {
  if (window.__rpcCensus) return 'already armed';
  const wine = window.wine;
  const gw = wine && wine.guestWorker;
  if (!gw || !gw.broker) return 'no guest Worker on this page (threads off?)';
  const host = wine._mainImports && wine._mainImports.host;
  if (!host) return 'no main host import table';
  const now = () => performance.now();
  const state = { armedAt: now(), calls: {}, serves: 0, serveGapMs: [], serveMs: 0, restores: [] };
  // Serve cadence: the broker's serveRpc runs once per blocking call.
  const broker = gw.broker;
  const origServe = broker.serveRpc;
  let lastServe = null;
  broker.serveRpc = function (slot) {
    const t0 = now();
    if (lastServe !== null && state.serveGapMs.length < 100000) state.serveGapMs.push(t0 - lastServe);
    try { return origServe.apply(this, arguments); } finally {
      lastServe = now();
      state.serveMs += lastServe - t0;
      state.serves++;
    }
  };
  state.restores.push(() => { broker.serveRpc = origServe; });
  // Per-import counts: the broker invokes the main host table's functions.
  for (const name of broker.names || []) {
    const fn = host[name];
    if (typeof fn !== 'function') continue;
    host[name] = function () {
      state.calls[name] = (state.calls[name] || 0) + 1;
      return fn.apply(this, arguments);
    };
    state.restores.push(() => { host[name] = fn; });
  }
  state.disarm = () => { for (const f of state.restores.splice(0)) f(); return 'disarmed'; };
  window.__rpcCensus = state;
  return 'armed';
})();
