'use strict';

const NON_GAMES = new Set(['generally-track-editor', 'putty', 'virtualdub', '7zip-file-manager',
  'povray-installer', 'dependency-walker', 'far-manager-170', 'winrar-310']);
function normalizeFixture(p) { return p.replace(/^binaries\//, 'test/binaries/'); }
function fileUrl(f) { return typeof f === 'string' ? f : f?.url || ''; }
function inventory(manifest, registry, assessments = [], names = []) {
  const labels = new Map(names.map(a => [a[0], a[1]]));
  const entries = manifest.candidates.map(c => ({
    id: c.id, name: c.name, origin: 'manifest', kind: c.kind,
    scope: NON_GAMES.has(c.id) ? 'non-game' : c.kind === 'game-demo-presentation' ? 'noninteractive-demo' : 'game-or-game-installer',
    executablePaths: (c.executables || []).map(e => `${manifest.assetRoot || 'test/binaries/candidates'}/${c.fixture || c.id}/${e}`),
    appIds: [], apps: [],
  }));
  for (const [id, app] of Object.entries(registry)) {
    const exe = normalizeFixture(fileUrl(app.exe));
    const explicit = assessments.filter(c => c.appIds?.includes(id)).map(c => c.id);
    const matches = entries.filter(c => c.origin === 'manifest' && (c.id === id || explicit.includes(c.id) || c.executablePaths.includes(exe)));
    if (!matches.length) {
      // Include every registry-only entry. Unknown is safer than silently losing
      // games among utilities, WEP variants, installers and debug executables.
      const entry = { id, name: labels.get(id) || id, origin: 'registry-only', kind: app.kind || 'unknown',
        scope: ['dxball', 'blobby_volley'].includes(id) ? 'game' : 'classification-required', executablePaths: [exe], appIds: [], apps: [] };
      entries.push(entry); matches.push(entry);
    }
    const declaredPaths = [...new Set([app.exe, app.localFileManifest, ...(app.dlls || []), ...(app.files || [])].map(fileUrl).filter(Boolean))];
    const dependencies = [...new Set(declaredPaths.map(normalizeFixture))];
    for (const c of matches) { c.appIds.push(id); c.apps.push({id, executable: exe, dependencies, declaredPaths,
      localFileManifest: app.localFileManifest ? normalizeFixture(app.localFileManifest) : null}); }
  }
  for (const c of entries) {
    // Candidate executables are discovery hints (installer names and alternate
    // archive layouts), not a conjunctive launch manifest. Exact registered
    // routes own their executable and dependency requirements.
    c.executableHints = c.origin === 'manifest' ? c.executablePaths.slice() : [];
    if (c.apps.length) c.executablePaths = [...new Set(c.apps.map(a => a.executable))];
    c.executableBasis = c.apps.length ? 'registered-routes' : 'discovery-alternatives';
  }
  return entries.sort((a,b) => a.id.localeCompare(b.id));
}

function readyApp(app) {
  return app.readiness === 'route-and-runtime-review-required';
}
function fixtureSummary(c) {
  const readyAppIds = c.apps.filter(readyApp).map(a=>a.id);
  const missingPaths = [...new Set(c.apps.length
    ? c.apps.flatMap(a=>a.missingPaths || [])
    : c.executablePresence.some(e=>e.present) ? [] : c.executablePresence.map(e=>e.path))];
  return {readyAppIds, missingPaths,
    fixtureReadiness: readyAppIds.length ? 'registered-route-assets-present' : c.apps.length ? 'registered-routes-blocked' : 'launch-route-review-required'};
}

module.exports={inventory,readyApp,fixtureSummary};
