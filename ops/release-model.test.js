'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ReleaseModel = require('./release-model');
const {deriveReleaseReadiness} = require('./release-readiness');

const {browserApp} = require('./test-app-vm');

const shots = [{name: 'play.png', url: '/artifact?key=scratch%2Fruns%2Fplay%2Fplay.png'}];
const gameplayRun = {key: 'scratch/runs/play', candidateId: 'alpha', verification: 'reviewed', outcome: 'passed', startedAt: '2026-10-03T10:00:00Z', route: 'gameplay', gameplayScreenshots: shots, screenshots: shots, visuals: shots,
  build: JSON.stringify({commit: '0123456789abcdef', dirtyPatchSha256: null, wasmSha256: 'f40d4ca3382279ff9b82'}), performance: null};
const perfRun = {...gameplayRun, candidateId: 'gamma', key: 'scratch/runs/perf', startedAt: '2026-10-03T11:00:00Z',
  performance: {fps: 7.95, metric: 'guest-logical-frame-submissions', counterKind: 'guest-logical-frame-submissions', measuredAt: '2026-10-03T11:00:00Z', scene: 'Round one', historical: false, samples: []}};
const flipRun = {key: 'scratch/runs/flip', candidateId: 'beta', verification: 'unreviewed', outcome: 'passed', startedAt: '2026-10-02T10:00:00Z', gameplayScreenshots: [], screenshots: [], visuals: [], build: '{}',
  performance: {fps: 33.9, metric: 'guest-presents', counterKind: 'guest-flip-events', historical: true, samples: []}};

function snapshot(reviews = []) {
  const candidates = [
    {id: 'alpha', name: 'Alpha <Demo>', appIds: ['alpha_app'], category: {id: 'arcade'}, fixtureStatus: 'present', launch: {routes: [{appId: 'alpha_app', label: 'Alpha', available: true, url: '/emulator/?app=alpha_app'}], productionRoutes: []}},
    {id: 'beta', name: 'Beta', appIds: ['beta_app'], category: {id: 'racing'}, fixtureStatus: 'missing', launch: {routes: [{appId: 'beta_app', available: false, reason: 'Missing files', missingPaths: ['test/binaries/beta.exe']}], productionRoutes: []}},
    {id: 'gamma', name: 'Gamma', appIds: ['gamma_app'], category: {id: 'arcade'}, fixtureStatus: 'present', launch: {routes: [], productionRoutes: []}},
    {id: 'tool', name: 'Tool', appIds: ['tool_app'], category: {id: 'tools'}, fixtureStatus: 'present'},
  ];
  const runs = [perfRun, gameplayRun, flipRun];
  candidates.find(c => c.id === 'beta').performance = {...flipRun.performance, runKey: flipRun.key};
  const releaseReadiness = deriveReleaseReadiness({candidates, runs, tasks: [], review: {production: {status: 'verified', appIds: ['gamma_app'], checkedAt: '2026-10-03T20:00:00Z'}, reviews}});
  for (const c of candidates) c.releaseReadiness = releaseReadiness.entries.find(e => e.id === c.id);
  return {candidates, runs, releaseReadiness, tasks: [], agents: [], terminals: [], approvals: {items: []}, warnings: []};
}

test('desktop queue lists only unreleased games and keeps unmeasured rates unknown', () => {
  const q = ReleaseModel.desktopQueue(snapshot());
  assert.deepEqual(q.rows.map(r => r.id), ['alpha', 'beta'], 'released gamma and non-game tool are excluded; reviewed gameplay sorts first');
  const [alpha, beta] = q.rows;
  assert.equal(alpha.screenshot.name, 'play.png');
  assert.equal(alpha.gameplayRun.build.text, 'rev 01234567 · dirty state not recorded · wasm f40d4ca33822');
  assert.equal(alpha.sound.status, 'not-recorded');
  assert.equal(alpha.input.text, 'Input not reviewed');
  assert.equal(alpha.unmet, 5, 'only gameplay passed');
  assert.equal(alpha.rate.known, false, 'no measurement for alpha stays unknown');
  // Beta has an unreviewed historical Flip-event rate: shown with its own label, never called FPS.
  assert.equal(beta.rate.known, true);
  assert.equal(beta.rate.label, 'guest Flip events/s');
  assert.equal(beta.rate.frames, false);
  assert.equal(beta.rate.reviewed, false);
  assert.equal(beta.screenshot, null);
  assert.ok(beta.blockers.some(b => b.code === 'fixture'));
});

test('a reviewed logical-frame measurement is preferred and labelled as such', () => {
  const s = snapshot();
  s.candidates[0].releaseReadiness.performance = {status: 'recorded-review-needs-release-qualification', metric: 'guest-logical-frame-submissions', runKey: perfRun.key};
  const rate = ReleaseModel.measuredRate(s, s.candidates[0]);
  assert.equal(rate.text, (7.95).toFixed(1) + ' logical gameplay frames/s');
  assert.equal(rate.frames, true);
  assert.equal(rate.reviewed, true);
  assert.equal(rate.qualification, 'Recorded; release qualification still needed');
  const none = ReleaseModel.measuredRate(s, {id: 'x', releaseReadiness: {performance: {status: 'not-measured'}}, performance: null});
  assert.deepEqual(none, {known: false, text: 'Rate unknown — no measurement recorded'});
});

test('stale reviews name exactly why they are not current', () => {
  const review = {id: 'alpha', reviewer: 'root', reviewedAt: '2026-10-03T12:00:00Z', basedOnRunKey: 'scratch/runs/missing', sourceValidation: 'missing-or-mismatched',
    gates: {input: {status: 'passed', summary: 'Keys move the player', source: 'input.log'}}};
  const row = ReleaseModel.desktopQueue(snapshot([review])).rows.find(r => r.id === 'alpha');
  assert.equal(row.reviewStale, true);
  assert.equal(row.staleReasons.length, 2);
  assert.match(row.staleReasons.join(' '), /basedOnRunKey/);
  assert.match(row.staleReasons.join(' '), /source hashes/);
  assert.equal(row.gates.find(g => g.name === 'input').status, 'unknown', 'a stale review cannot pass a gate');
  assert.match(row.gates.find(g => g.name === 'input').detail, /not current/);
});

test('build identity never invents values', () => {
  assert.equal(ReleaseModel.buildIdentity('{').text, 'Build not recorded');
  assert.equal(ReleaseModel.buildIdentity('{"commit":"unknown","wasmSha256":null}').text, 'rev not recorded · dirty state not recorded · wasm not recorded');
  assert.equal(ReleaseModel.buildIdentity({commit: 'abc', dirtyPatchSha256: 'ffeeddccbbaa', wasmSha256: 'w'}).text, 'rev abc · dirty ffeeddcc · wasm w');
  assert.equal(ReleaseModel.buildIdentity({commit: 'abc', dirty: false}).dirty, false);
});

test('Ready for desktop view escapes names, lists unmet gates and launch state', () => {
  const ctx = browserApp(snapshot());
  const html = vm.runInContext('desktopView()', ctx);
  assert.ok(html.includes('Alpha &lt;Demo&gt;'));
  assert.ok(!html.includes('Alpha <Demo>'));
  assert.ok(html.includes('2 unreleased games'));
  assert.ok(html.includes('Rate unknown — no measurement recorded'));
  assert.ok(html.includes('33.9 guest Flip events/s'));
  assert.ok(html.includes('unreviewed run'));
  assert.ok(html.includes('Sound not recorded'));
  assert.ok(html.includes('<strong>input</strong> unknown: No release review recorded for this gate.'));
  assert.ok(html.includes('href="/emulator/?app=alpha_app"'));
  assert.ok(html.includes('Launch unavailable'));
  assert.ok(!/\bFPS\b/.test(html.replace(/frames\/s/g, '')), 'no bare FPS claim is rendered');
  vm.runInContext("desktopSelection='gameplay'", ctx);
  const filtered = vm.runInContext('desktopView()', ctx);
  assert.ok(filtered.includes('Alpha') && !filtered.includes('data-desktop-row="beta"'));
});

test('release view script is served and loaded before app.js', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.ok(html.indexOf('/release-model.js') > 0 && html.indexOf('/release-model.js') < html.indexOf('/app.js'));
  assert.ok(html.includes('href="#release"'));
  assert.ok(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8').includes("'/release-model.js': ['release-model.js'"));
});

test('launch shows the served build and compares it with the reviewed gameplay module only by hash', () => {
  const s = snapshot();
  assert.equal(ReleaseModel.servedBuild(s).text, 'Served build unknown');
  s.emulatorBuild = {commit: 'aaaaaaaa11111111aaaaaaaa11111111aaaaaaaa', dirty: true, dirtyFiles: 3, wasmSha256: 'f40d4ca3382279ff9b82', note: 'live tree'};
  assert.equal(ReleaseModel.servedBuild(s).text, 'rev aaaaaaaa · dirty · wasm f40d4ca33822 (3 tracked files modified)');
  const alpha = ReleaseModel.desktopQueue(s).rows.find(r => r.id === 'alpha');
  assert.equal(alpha.gameplayRun.servedMatch.status, 'match');
  s.emulatorBuild.wasmSha256 = 'ffff';
  assert.equal(ReleaseModel.desktopQueue(s).rows.find(r => r.id === 'alpha').gameplayRun.servedMatch.status, 'differs');
  assert.equal(ReleaseModel.buildMatch('ffff', null).status, 'unknown');
  const ctx = browserApp(s);
  const html = vm.runInContext('desktopView()', ctx);
  assert.ok(html.includes('Build rev aaaaaaaa · dirty · wasm ffff (3 tracked files modified)'));
  assert.ok(html.includes('served wasm differs from the reviewed gameplay run (f40d4ca33822)'));
  assert.ok(html.includes('Missing: test/binaries/beta.exe'), 'missing files are listed on the row, not only in details');
  for (const c of s.candidates) Object.assign(c, {category: {...c.category, label: c.category.id}, taskIds: []});
  const corpus = vm.runInContext('corpusView()', ctx);
  assert.ok(corpus.includes('Launches serve: rev aaaaaaaa'));
  assert.ok(!corpus.includes('build-chip'), 'corpus cards stay compact; build is shown once in the launch bar');
  assert.ok(vm.runInContext("corpusLaunchActions(state.candidates[0],true)", ctx).includes('build-chip'));
});

test('performance before/after compares only identical scene, counter, renderer, host, GPU with recorded builds', () => {
  const base = {metric: 'guest-logical-frame-submissions', counterKind: 'guest-logical-frame-submissions', scene: 'Round one', renderer: 'GDI', host: 'box', gpu: 'sw', historical: false, samples: []};
  const run = (key, fps, at, extra = {}) => ({key, candidateId: 'alpha', verification: 'reviewed', performance: {...base, fps, measuredAt: at, wasmSha256: 'w-' + key, ...extra}});
  const candidate = {id: 'alpha', appIds: ['alpha_app']};
  const s = {runs: [run('old', 20, '2026-10-01T00:00:00Z'), run('new', 25, '2026-10-03T00:00:00Z'), run('other-scene', 40, '2026-10-02T00:00:00Z', {scene: 'Menu'}),
    run('no-build', 22, '2026-10-02T12:00:00Z', {wasmSha256: null}), run('flip', 60, '2026-10-02T06:00:00Z', {counterKind: 'guest-flip-events', metric: 'guest-presents'})]};
  const cmp = ReleaseModel.perfComparisons(s, candidate);
  assert.equal(cmp.count, 5);
  assert.equal(cmp.pairs.length, 1);
  assert.equal(cmp.pairs[0].before.runKey, 'old');
  assert.equal(cmp.pairs[0].after.runKey, 'new');
  assert.equal(cmp.pairs[0].deltaPct, 25);
  assert.equal(cmp.pairs[0].sameBuild, false);
  assert.equal(cmp.pairs[0].label, 'logical gameplay frames/s');
  const reasons = Object.fromEntries(cmp.notComparable.map(n => [n.before.runKey, n.reasons.join(', ')]));
  assert.equal(reasons['other-scene'], 'scene differs');
  assert.equal(reasons['no-build'], 'module hash not recorded');
  assert.equal(reasons.flip, 'metric differs, counter differs');
  assert.equal(ReleaseModel.perfComparisons({runs: [s.runs[0]]}, candidate).text, 'Not comparable: only one measurement recorded');
  assert.equal(ReleaseModel.perfComparisons({runs: [s.runs[1], s.runs[2]]}, candidate).pairs.length, 0);
  const ctx = browserApp({...snapshot(), runs: s.runs});
  const html = vm.runInContext("perfComparisonHtml({id:'alpha',appIds:[]})", ctx);
  assert.match(html, /\+25\.0%<\/strong> logical gameplay frames\/s · different builds/);
  assert.match(html, /3 not comparable/);
  assert.match(html, /wasm w-old/);
});
