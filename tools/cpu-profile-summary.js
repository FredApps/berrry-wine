'use strict';
// Summarize V8 .cpuprofile objects (from CDP Profiler.stop) by self time, one
// thread per profile. Shared by the browser benches so a profile is read the
// same way everywhere: busy = sampled non-idle time, and each row's share is
// of that thread's busy time.
//
//   const { summarizeProfile, printProfiles } = require('./cpu-profile-summary');
//   printProfiles([{ label: 'page', ...summarizeProfile(profile, 15) }], seconds);

function summarizeProfile(profile, top = 15) {
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const self = new Map();
  let busy = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const f = byId.get(profile.samples[i])?.callFrame;
    const dt = profile.timeDeltas[i] || 0;
    if (!f || f.functionName === '(idle)') continue;
    const where = f.url
      ? `${f.url.replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '')}:${f.lineNumber + 1}` : '';
    const key = `${f.functionName || '(anonymous)'}  ${where}`;
    self.set(key, (self.get(key) || 0) + dt);
    busy += dt;
  }
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
    .map(([fn, us]) => ({ fn, ms: us / 1000, share: us / (busy || 1) }));
  return { busyMs: busy / 1000, top: rows };
}

// threads: [{label, busyMs, top}]. Rows are printed only for threads busier
// than 2% of the sample, so idle Workers stay one line each.
function printProfiles(threads, seconds, log = console.log) {
  for (const t of threads) {
    const wallShare = t.busyMs / (seconds * 1000);
    log(`cpu-profile ${(100 * wallShare).toFixed(1)}% of wall  ${t.busyMs.toFixed(0)}ms busy  ${t.label}`);
    if (wallShare < 0.02) continue;
    for (const r of t.top) log(`    ${(100 * r.share).toFixed(1).padStart(5)}%  ${r.ms.toFixed(0).padStart(6)}ms  ${r.fn}`);
  }
}

module.exports = { summarizeProfile, printProfiles };
