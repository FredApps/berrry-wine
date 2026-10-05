(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReleaseModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // "Ready for desktop": one row per unreleased game, built only from the
  // snapshot's existing releaseReadiness, runs and launch catalog. Nothing here
  // measures, infers or certifies; a value that was not recorded stays unknown.
  const GATES = ['gameplay', 'input', 'correctness', 'performance', 'distribution', 'package'];
  const MET = ['passed', 'not-required'];

  // The same labels the corpus card uses; only a qualified logical-frame
  // counter is a frame rate, the others are event rates.
  function rateLabels(perf) {
    const logical = perf?.metric === 'guest-logical-frame-submissions', flips = perf?.counterKind === 'guest-flip-events';
    return {
      rate: logical ? 'logical gameplay frames/s' : flips ? 'guest Flip events/s' : 'guest presentation events/s',
      interval: logical ? 'p95 submission interval' : flips ? 'p95 Flip interval' : 'p95 presentation interval',
      frames: logical,
    };
  }

  function parseBuild(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string' || !value.trim()) return null;
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null; }
    catch { return null; }
  }

  function buildIdentity(value) {
    const b = parseBuild(value);
    const str = v => typeof v === 'string' && v.trim() && v !== 'unknown' ? v.trim() : null;
    if (!b) return {commit: null, dirty: null, wasm: null, text: 'Build not recorded'};
    const commit = str(b.commit), dirtyPatch = str(b.dirtyPatchSha256), wasm = str(b.wasmSha256);
    const dirty = typeof b.dirty === 'boolean' ? b.dirty : dirtyPatch ? true : null;
    const parts = [commit ? 'rev ' + commit.slice(0, 8) : 'rev not recorded', dirty === true ? 'dirty' + (dirtyPatch ? ' ' + dirtyPatch.slice(0, 8) : '') : dirty === false ? 'clean' : 'dirty state not recorded', wasm ? 'wasm ' + wasm.slice(0, 12) : 'wasm not recorded'];
    return {commit, dirty, dirtyPatch, wasm, text: parts.join(' · ')};
  }

  // The module a launch from this dashboard serves right now (emulator-server).
  function servedBuild(snapshot) {
    const b = snapshot.emulatorBuild;
    if (!b) return {known: false, wasm: null, text: 'Served build unknown'};
    const id = buildIdentity({commit: b.commit, dirty: b.dirty, wasmSha256: b.wasmSha256});
    const dirty = b.dirty === true ? ' (' + b.dirtyFiles + ' tracked file' + (b.dirtyFiles === 1 ? '' : 's') + ' modified)' : '';
    return {known: !!b.wasmSha256, wasm: b.wasmSha256 || null, commit: b.commit || null, dirty: b.dirty ?? null, reason: b.reason || '', text: id.text + dirty};
  }

  // Compare by module hash only; a matching commit with a different module is a different build.
  function buildMatch(servedWasm, recordedWasm) {
    if (!servedWasm || !recordedWasm) return {status: 'unknown', text: !recordedWasm ? 'reviewed run did not record its wasm' : 'served wasm unknown'};
    return servedWasm === recordedWasm ? {status: 'match', text: 'served wasm matches the reviewed gameplay run'} : {status: 'differs', text: 'served wasm differs from the reviewed gameplay run (' + recordedWasm.slice(0, 12) + ')'};
  }

  function measuredRate(snapshot, candidate) {
    const r = candidate.releaseReadiness || {};
    const reviewedRun = r.performance?.runKey && (snapshot.runs || []).find(run => run.key === r.performance.runKey && run.performance);
    const perf = reviewedRun ? {...reviewedRun.performance, runKey: reviewedRun.key} : candidate.performance || null;
    if (!perf || !Number.isFinite(perf.fps)) return {known: false, text: 'Rate unknown — no measurement recorded'};
    const run = (snapshot.runs || []).find(x => x.key === perf.runKey);
    const labels = rateLabels(perf);
    return {known: true, value: perf.fps, label: labels.rate, frames: labels.frames, reviewed: run?.verification === 'reviewed', historical: !!perf.historical,
      measuredAt: perf.measuredAt || null, scene: perf.scene || '', renderer: perf.renderer || '', runKey: perf.runKey, wasm: perf.wasmSha256 || null,
      qualification: r.performance?.status === 'recorded-review-needs-release-qualification' ? 'Recorded; release qualification still needed' : 'Not release-qualified',
      text: perf.fps.toFixed(1) + ' ' + labels.rate};
  }

  // Before/after: compare the newest measurement with each earlier one only when
  // the scene, counter, renderer, host and GPU are identical and both runs
  // recorded their module hash. Anything else is listed with the fields that differ.
  const SAME = [['metric', 'metric'], ['counterKind', 'counter'], ['scene', 'scene'], ['renderer', 'renderer'], ['host', 'host'], ['gpu', 'GPU']];
  function perfComparisons(snapshot, candidate) {
    const ids = new Set([candidate.id, ...(candidate.appIds || [])]);
    const measured = (snapshot.runs || []).filter(run => ids.has(run.candidateId) && run.performance && Number.isFinite(run.performance.fps))
      .map(run => ({runKey: run.key, reviewed: run.verification === 'reviewed', ...run.performance}))
      .sort((a, b) => String(b.measuredAt || '').localeCompare(String(a.measuredAt || '')));
    if (measured.length < 2) return {count: measured.length, pairs: [], notComparable: [], text: measured.length ? 'Not comparable: only one measurement recorded' : 'No measurement recorded'};
    const [after, ...earlier] = measured, pairs = [], notComparable = [];
    for (const before of earlier) {
      const reasons = SAME.filter(([key]) => (before[key] || null) !== (after[key] || null)).map(([key, label]) => label + ' differs');
      if (!before.wasmSha256 || !after.wasmSha256) reasons.push('module hash not recorded');
      if (reasons.length) { notComparable.push({before, after, reasons}); continue; }
      const labels = rateLabels(after);
      pairs.push({before, after, label: labels.rate, sameBuild: before.wasmSha256 === after.wasmSha256,
        deltaPct: before.fps > 0 ? 100 * (after.fps - before.fps) / before.fps : null});
    }
    return {count: measured.length, pairs, notComparable, text: pairs.length ? pairs.length + ' comparable pair' + (pairs.length === 1 ? '' : 's') : 'Not comparable: no earlier measurement matches scene, counter, renderer, host, GPU and recorded build'};
  }

  function gateRows(r) {
    return GATES.map(name => {
      const g = r?.gates?.[name] || {status: 'unknown', summary: '', source: ''};
      const status = String(g.status || 'unknown');
      const met = MET.includes(status);
      const stale = status === 'unknown' && r?.reviewStale;
      const detail = stale ? 'Recorded review is not current, so this gate is unknown' + (g.summary ? '; it said: ' + g.summary : '.')
        : g.summary || (status === 'unknown' ? 'No release review recorded for this gate.' : 'No summary recorded.');
      return {name, status, met, detail, source: g.source || ''};
    });
  }

  function desktopRow(snapshot, candidate) {
    const r = candidate.releaseReadiness;
    const gates = gateRows(r);
    const gameplayRun = r.reviewedGameplay?.runKey ? (snapshot.runs || []).find(run => run.key === r.reviewedGameplay.runKey) : null;
    const shots = r.reviewedGameplay?.screenshots || [];
    const input = gates.find(g => g.name === 'input');
    return {
      id: candidate.id, name: candidate.name || candidate.id, status: r.status, prospect: r.prospect,
      screenshot: shots.length ? {...shots[shots.length - 1], runKey: r.reviewedGameplay.runKey} : null,
      gameplayRun: gameplayRun ? {key: gameplayRun.key, startedAt: gameplayRun.startedAt, route: gameplayRun.route || '', build: buildIdentity(gameplayRun.build),
        servedMatch: buildMatch(snapshot.emulatorBuild?.wasmSha256, buildIdentity(gameplayRun.build).wasm)} : null,
      rate: measuredRate(snapshot, candidate),
      input: {status: input.status, text: input.met ? input.detail : input.status === 'unknown' ? 'Input not reviewed' : 'Input ' + input.status.replaceAll('-', ' ') + ': ' + input.detail},
      // No release gate or run field records audio today; say so instead of guessing.
      sound: {status: 'not-recorded', text: 'Sound not recorded (no sound gate or run audio field)'},
      gates, unmet: gates.filter(g => !g.met).length,
      blockers: r.blockers || [], staleReasons: r.staleReasons || [], reviewStale: !!r.reviewStale,
      next: r.next || '', summary: r.summary || '',
      launchable: (candidate.launch?.routes || []).some(route => route.available === true),
    };
  }

  function desktopQueue(snapshot, selection = 'all') {
    const games = (snapshot.candidates || []).filter(c => c.releaseReadiness?.scope === 'game');
    const unreleased = games.filter(c => c.releaseReadiness.productionMembership === 'no');
    const rows = unreleased.map(c => desktopRow(snapshot, c)).filter(row =>
      selection === 'all' || selection === 'gameplay' && row.screenshot || selection === 'unblocked' && !row.blockers.length || selection === 'ready' && row.status === 'ready');
    rows.sort((a, b) => Number(b.status === 'ready') - Number(a.status === 'ready') || Number(!!b.screenshot) - Number(!!a.screenshot) ||
      a.blockers.length - b.blockers.length || a.unmet - b.unmet || a.name.localeCompare(b.name));
    return {rows, unreleased: unreleased.length, unknownMembership: games.filter(c => c.releaseReadiness.productionMembership === 'unknown').length,
      ready: unreleased.filter(c => c.releaseReadiness.status === 'ready').length, withGameplay: unreleased.filter(c => c.releaseReadiness.reviewedGameplay).length,
      production: snapshot.releaseReadiness?.production || {status: 'unknown'}};
  }

  return {GATES, rateLabels, parseBuild, buildIdentity, servedBuild, buildMatch, measuredRate, perfComparisons, gateRows, desktopRow, desktopQueue};
});
