'use strict';

// Read-only release review. Local registry membership and screenshots alone
// never establish deployed membership or permission to publish a package.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const STATUSES = ['ready', 'review-needed', 'blocked', 'unknown', 'already-production'];
const SOURCE_KEYS = ['build/wine-assembly.wasm', 'lib/apps.js', 'host.js', 'lib/guest-worker.js', 'lib/guest-thread-host.js', 'lib/renderer.js', 'lib/renderer-input.js', 'lib/dll-loader.js', 'lib/region-map.generated.js'];
const GATES = ['gameplay', 'input', 'correctness', 'performance', 'distribution', 'package'];
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const text = value => typeof value === 'string' ? value.slice(0, 4000) : '';

async function verifyArtifact(root, relative, digest) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || !/^[a-f0-9]{64}$/.test(digest || '')) return false;
  try {
    const base = await fs.realpath(root), file = await fs.realpath(path.resolve(base, relative));
    if (!file.startsWith(base + path.sep)) return false;
    return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex') === digest;
  } catch { return false; }
}

async function loadReleaseReview(root) {
  let data;
  try { data = JSON.parse(await fs.readFile(path.join(root, 'ops/release-readiness.json'), 'utf8')); }
  catch (error) { return {reviews: [], production: {status: 'unknown', reason: error.code === 'ENOENT' ? 'No verified production snapshot recorded.' : 'Release review could not be read.'}}; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {reviews: [], production: {status: 'unknown', reason: 'Invalid release review object.'}};
  const p = data.production && typeof data.production === 'object' ? data.production : {};
  const reviews = [];
  for (const row of Array.isArray(data.reviews) ? data.reviews : []) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const hashes = row.sourceHashes && typeof row.sourceHashes === 'object' && !Array.isArray(row.sourceHashes) ? row.sourceHashes : {};
    const validSources = SOURCE_KEYS.every(key => typeof hashes[key] === 'string') && (await Promise.all(Object.entries(hashes).map(([file, digest]) => verifyArtifact(root, file, digest)))).every(Boolean);
    reviews.push({...row, sourceValidation: validSources ? 'current' : 'missing-or-mismatched'});
  }
  let extracted = null;
  if (await verifyArtifact(root, p.artifact, p.sha256)) {
    const source = await fs.readFile(path.resolve(root, p.artifact), 'utf8');
    const block = source.match(/const\s+DESKTOP_APPS\s*=\s*\[([\s\S]*?)^\s*\];/m)?.[1];
    if (block) extracted = [...block.matchAll(/^\s*\[\s*['"]([^'"]+)['"]/gm)].map(match => match[1]);
  }
  const valid = Array.isArray(p.appIds) && extracted && JSON.stringify([...new Set(extracted)].sort()) === JSON.stringify([...new Set(p.appIds || [])].sort()) && validDate(p.checkedAt) && /^https:\/\//.test(p.url || '') &&
    Array.isArray(p.appIds) && p.appIds.every(id => typeof id === 'string' && id.length > 0) &&
    await verifyArtifact(root, p.artifact, p.sha256) && await verifyArtifact(root, p.indexArtifact, p.indexSha256);
  return {reviews, production: valid
    ? {...p, appIds: [...new Set(p.appIds)], status: 'verified', source: p.url, scope: 'Verified at checkedAt; no live network request during dashboard polling.'}
    : {status: 'unknown', checkedAt: p.checkedAt || null, reason: 'Production snapshot provenance is missing or its artifact hash does not match.'}};
}

function classifyScope(candidate) {
  if (['tools', 'collections', 'graphics-demos'].includes(candidate.category?.id) || candidate.inventoryScope === 'non-game') return 'non-game';
  if (candidate.category?.id && !['unknown', 'unclassified'].includes(candidate.category.id)) return 'game';
  if (['game', 'game-or-game-installer'].includes(candidate.inventoryScope)) return 'game';
  return 'unknown';
}

function deriveReleaseReadiness({candidates, runs, tasks, review = {}}) {
  const production = review.production || {status: 'unknown', reason: 'No production snapshot.'};
  const deployed = new Set(production.status === 'verified' ? production.appIds : []);
  const entries = candidates.map(candidate => {
    const appIds = candidate.appIds || [];
    const inProduction = appIds.filter(id => deployed.has(id));
    const productionMembership = production.status !== 'verified' || !appIds.length ? 'unknown' : inProduction.length ? 'yes' : 'no';
    const matching = runs.filter(run => run.candidateId === candidate.id || appIds.includes(run.candidateId));
    const gameplay = matching.find(run => run.verification === 'reviewed' && run.gameplayScreenshots?.length);
    const decision = (review.reviews || []).find(row => row.id === candidate.id);
    const reviewedRun = matching.find(run => run.key === decision?.basedOnRunKey && run.verification === 'reviewed' && run.gameplayScreenshots?.length);
    const newerFailure = reviewedRun && matching.find(run => run.outcome === 'failed' && run.startedAt > reviewedRun.startedAt && (/gameplay/i.test(run.route || '') || /^GAMEPLAY-/.test(run.taskId || '')));
    const currentReview = !!(decision && text(decision.reviewer) && validDate(decision.reviewedAt) && reviewedRun && !newerFailure && decision.sourceValidation === 'current');
    const blockers = [];
    const add = (code, summary, source) => blockers.push({code, summary, source});
    if (newerFailure) add('newer-gameplay-failure', 'A newer gameplay run failed after the reviewed release evidence.', newerFailure.key);
    const gates = Object.fromEntries(GATES.map(name => {
      const supplied = decision?.gates?.[name];
      const status = (currentReview || supplied?.status === 'blocked') && ['passed', 'blocked', 'review-needed', 'unknown', 'not-required'].includes(supplied?.status)
        && text(supplied.summary) && text(supplied.source) ? supplied.status : 'unknown';
      return [name, {status, summary: text(supplied?.summary), source: text(supplied?.source)}];
    }));
    if (gameplay && gates.gameplay.status === 'unknown') gates.gameplay = {status: 'passed', summary: 'Explicitly reviewed gameplay scene; this does not certify input or release correctness.', source: gameplay.key};
    for (const task of tasks) {
      const linked = task.explicitCandidates?.some(id => id === candidate.id || appIds.includes(id)) || task.id === 'GAMEPLAY-' + candidate.id;
      if (linked && task.status !== 'done' && (task.status === 'blocked' || task.blocker)) add('task:' + task.id, task.blocker || task.title, 'TODOS.md:' + task.line);
    }
    const registeredRoute = candidate.registeredExecutables?.some(file => file.present === true);
    if (!registeredRoute && (candidate.fixtureStatus === 'missing' || candidate.fixtureStatus === 'partial')) add('fixture', 'Executable fixture is ' + candidate.fixtureStatus + '; full package closure still requires review.', 'test/candidate-corpus/manifest.json');
    for (const name of GATES) if (gates[name].status === 'blocked') add('gate:' + name, gates[name].summary, gates[name].source);
    for (const blocker of Array.isArray(decision?.blockers) ? decision.blockers : []) if (blocker && text(blocker.summary)) add(text(blocker.code) || 'review', text(blocker.summary), text(blocker.source));
    const complete = currentReview && GATES.every(name => gates[name].status === 'passed' || (name === 'performance' && gates[name].status === 'not-required'));
    const scope = classifyScope(candidate);
    let status = productionMembership === 'yes' ? 'already-production' : blockers.length ? 'blocked'
      : productionMembership === 'unknown' ? 'unknown' : complete ? 'ready' : 'review-needed';
    if (scope !== 'game' && status === 'ready') status = 'review-needed';
    const measured = matching.find(run => run.verification === 'reviewed' && run.performance);
    const performance = measured ? {status: 'recorded-review-needs-release-qualification', metric: measured.performance.metric, runKey: measured.key, physicalFps: null}
      : {status: 'not-measured', metric: null, physicalFps: null};
    const prospect = complete ? 'evidence-complete' : gameplay ? 'gameplay-reviewed' : 'needs-evidence';
    return {id: candidate.id, name: candidate.name, scope, status, productionMembership, appIds, inProductionAppIds: inProduction,
      unreleasedAppIds: production.status === 'verified' ? appIds.filter(id => !deployed.has(id)) : [],
      localDesktopAppIds: candidate.localDesktopAppIds || [], blockers, gates, performance,
      reviewedGameplay: gameplay ? {runKey: gameplay.key, screenshots: gameplay.gameplayScreenshots} : null,
      reviewedAt: currentReview ? decision.reviewedAt : null, reviewer: currentReview ? decision.reviewer : null,
      reviewStale: !!decision && !currentReview, prospect,
      summary: status === 'ready' ? 'Explicit release gates reviewed; not deployed by this dashboard.' : status === 'already-production' ? 'Present in the verified public desktop snapshot; compatibility is separate.' : blockers.length ? blockers[0].summary : gameplay ? 'Reviewed gameplay available; remaining release gates need review.' : 'Release evidence is incomplete.',
      next: text(decision?.next) || (productionMembership === 'unknown' ? 'Verify production desktop membership.' : 'Review remaining release gates and record a decision.'),
      rank: status === 'ready' ? 0 : productionMembership === 'no' && gameplay && !blockers.length ? 1 : status === 'review-needed' ? 2 : status === 'unknown' ? 3 : status === 'blocked' ? 4 : 5};
  });
  entries.sort((a,b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const games = entries.filter(entry => entry.scope === 'game');
  const counts = Object.fromEntries(STATUSES.map(status => [status, games.filter(entry => entry.status === status).length]));
  return {schemaVersion: 1, production, counts, gameCount: games.length, nonGameCount: entries.filter(e => e.scope === 'non-game').length,
    unknownScopeCount: entries.filter(e => e.scope === 'unknown').length, prospects: games.filter(e => e.productionMembership === 'no' && e.reviewedGameplay && !e.blockers.length).length, entries};
}
module.exports = {loadReleaseReview, deriveReleaseReadiness, classifyScope, SOURCE_KEYS};
