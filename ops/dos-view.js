'use strict';
// Dashboard view: the original DOS / ToyVM corpus (#dos). Uses app.js's shared
// helpers (escape, title, badge, empty, link, matches, when, show, render) at
// call time. Every launch is a same-origin link the gateway's session cookie
// already covers: /toyvm/?title= for a ToyVM session, the emulator catalog's
// own build-pinned /emulator/ URL for the release's DOSBox route. Both pages
// show their own delayed loading dialog.
let dosFilter = 'all';
const DOS_FILTERS = [['all', 'All'], ['available', 'Payload here'], ['launchable', 'Launchable'], ['gameplay', 'Gameplay reviewed'], ['perf', 'Performance measured'], ['blocked', 'Blocked']];
const dosMatch = (r, f) => f === 'all' || (f === 'available' && r.flags.available) || (f === 'launchable' && r.flags.launchable) || (f === 'gameplay' && r.flags.gameplayReviewed) || (f === 'perf' && r.flags.performanceMeasured) || (f === 'blocked' && r.flags.blocked);
const dosSafe = (u, prefix) => typeof u === 'string' && u.startsWith(prefix) && !/[\u0000- \\]/.test(u);
const dosBytes = (n) => !Number.isFinite(n) ? '?' : n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
const dosToyvmTone = { blocked: 'bad', untested: 'warn', unknown: '' };
// Row cells stay brief; the full cited text is in Details. (Cutting the prose
// at its first ". " broke on "e.g." -- a fixed phrase per blocker id cannot.)
const DOS_BLOCKER_SHORT = { extender: 'a 32-bit DOS extender ToyVM has never run', 'flat-fs-collision': 'clashing file names in subfolders', cdrom: 'needs a CD-ROM drive', vbe2: 'needs VESA 2.0', 'entry-missing': 'entry program missing' };
const dosLevelTone = { 'gameplay-reviewed': 'good', 'in-progress': 'warn', 'not-routed': '' };

function dosToyvmCell(r) {
  const t = r.toyvm, label = t.status === 'blocked' ? 'Blocked on ToyVM' : t.status === 'untested' ? 'Untested on ToyVM' : 'ToyVM: unknown';
  const action = t.launch && dosSafe(t.launch.url, '/toyvm/') ? `<a class="emulator-launch" href="${escape(t.launch.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(t.launch.label + ' — ' + r.title)}">${escape(t.launch.label)} ↗</a>`
    : `<p class="sub">${escape(t.blockers.length ? 'Blocked by: ' + t.blockers.map((b) => DOS_BLOCKER_SHORT[b.id] || b.id).join(', ') + '. Details has the sources.' : t.reason)}</p>`;
  const got = (t.evidence || []).at(-1);
  return `<div class="dos-route"><span class="dos-route-name">ToyVM</span>${badge(label, dosToyvmTone[t.status] || '')}${got ? badge('Reached: ' + got.reached.replace(/-/g, ' ') + ' (probe)', '') : ''}${action}</div>`;
}
function dosDosboxCell(r) {
  const d = r.dosbox, s = d.status, route = d.routes.find((x) => x.available && dosSafe(x.url, '/emulator/'));
  const action = route ? `<a class="emulator-launch" href="${escape(route.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape('Open in the Win98 emulator — ' + r.title)}">Open in Win98 emulator ↗</a>`
    : `<p class="sub">${escape(d.reason || d.routes[0]?.reason || 'No launch route.')}</p>`;
  return `<div class="dos-route"><span class="dos-route-name">Win98 + DOSBox.exe</span>${s ? badge(s.label, dosLevelTone[s.level] || '') : ''}${s?.stale ? badge('Newer run than summary', 'warn') : ''}${action}</div>`;
}
function dosRowHtml(r) {
  if (r.engine === 'toyvm-gallery') {
    return `<article class="panel dos-row"><div class="dos-head"><h3>${escape(r.title)}</h3>${badge(r.label, 'good')}</div><p class="sub">${escape(r.summary)}</p><div class="links">${r.galleryGithub ? link(r.galleryGithub, 'Gallery source') : ''}${r.basis.map((b) => b.github ? link(b.github, b.path) : '').join('')}</div></article>`;
  }
  const ev = [r.flags.gameplayReviewed ? badge('Gameplay reviewed', 'good') : '', r.flags.performanceMeasured ? badge('Performance measured', 'good') : '',
    r.latestRun ? badge('Latest run: ' + r.latestRun.outcome, tone(r.latestRun.outcome)) : badge('No recorded run')].join('');
  const size = r.payload.present ? `${r.payload.files} files · ${dosBytes(r.payload.bytes)}` : 'payload not on this machine';
  return `<article class="panel dos-row"><div class="dos-head"><h3>${escape(r.title)}</h3><code>${escape(r.entry.program)}${r.entry.args ? ' ' + escape(r.entry.args) : ''}</code></div>`
    + `<p class="sub">${escape(size)}${r.programs[0]?.extender ? ' · ' + escape(r.programs[0].extender) : r.programs[0] ? ' · ' + escape(r.programs[0].mode) : ''}</p>`
    + `<div class="dos-routes">${dosToyvmCell(r)}${dosDosboxCell(r)}</div><div class="dos-foot">${ev}<button data-dos="${escape(r.id)}" aria-label="${escape('Details — ' + r.title)}">Details →</button></div></article>`;
}
function dosView() {
  const c = state.dosCorpus;
  if (!c || !c.available) return title('DOS / ToyVM corpus', 'Original MS-DOS programs, kept apart from the Windows EXE corpus.') + empty(c?.reason || 'The DOS corpus has not been read yet.');
  const rows = c.rows.filter((r) => dosMatch(r, dosFilter) && matches(r));
  const counts = DOS_FILTERS.map(([id, label]) => `<button data-dos-filter="${id}" aria-pressed="${dosFilter === id}"><strong>${c.rows.filter((r) => dosMatch(r, id)).length}</strong> ${label}</button>`).join('');
  return title('DOS / ToyVM corpus', 'Original MS-DOS programs and the engine that would run each one. A launch link proves files and build only; gameplay is what a reviewed run shows.')
    + `<div class="release-counts dos-filters" role="group" aria-label="DOS corpus filters">${counts}</div>`
    + `<p class="source-note">ToyVM verdicts are static: what each program asks for, against what ToyVM implements, with the source for each fact. “Untested” is not a claim that it works.${c.github?.manifest ? ' ' + link(c.github.manifest, 'Corpus manifest') : ''}</p>`
    + `<div class="dos-list">${rows.map(dosRowHtml).join('') || empty('No DOS titles match this filter.')}</div>`;
}
function dosFactList(list) {
  return list.map((b) => `<li><p>${escape(b.text)}</p>${b.facts.map((f) => `<p class="sub">${escape(f.text)} <code>${escape(f.cite)}</code></p>`).join('')}</li>`).join('');
}
function dosDetail(id) {
  const r = state.dosCorpus?.rows.find((x) => x.id === id); if (!r) return;
  const p = r.provenance, s = r.dosbox.status;
  const shots = r.screenshots.length ? `<div class="dos-shots">${r.screenshots.map((x) => `<img src="${escape(x.url)}" alt="${escape(r.title + ' — ' + x.name)}" loading="lazy">`).join('')}</div><p class="sub">From ${escape(r.gameplayRun?.id || r.reviewedPass?.id || r.latestRun?.id || 'the latest run')} · ${escape(when((r.gameplayRun || r.reviewedPass || r.latestRun)?.startedAt))}</p>` : empty('No screenshot recorded.');
  const excluded = Object.entries(r.payload.excluded || {}).map(([k, n]) => `${k} ${n}`).join(', ');
  show('DOS CORPUS / ' + r.id, `<h1>${escape(r.title)}</h1><p class="sub">${escape(p.release || '')}</p>`
    + `<div class="dos-routes">${dosToyvmCell(r)}${dosDosboxCell(r)}</div>`
    + `<h3>Entry program</h3><p><code>${escape(r.entry.program)}${r.entry.args ? ' ' + escape(r.entry.args) : ''}</code></p><p class="sub">${escape(r.entrySource)}</p>`
    + (r.programs.length ? `<ul>${r.programs.map((x) => `<li><code>${escape(x.name)}</code> · ${escape(x.mode)}${x.extender ? ' · ' + escape(x.extender) : ''}</li>`).join('')}</ul>` : '')
    + `<h3>ToyVM</h3><p>${escape(r.toyvm.verdict)}</p>${(r.toyvm.evidence || []).map((e) => `<p class="sub">${escape(when(e.at))} · ${escape(e.summary)} <code>${escape(e.run)}</code>${e.present ? '' : ' (run folder not on this machine)'}</p>`).join('')}${r.toyvm.blockers.length ? `<ul>${dosFactList(r.toyvm.blockers)}</ul>` : ''}${r.toyvm.cautions.length ? `<details><summary>Other limits (${r.toyvm.cautions.length})</summary><ul>${dosFactList(r.toyvm.cautions)}</ul></details>` : ''}`
    + `<h3>Win98 emulator + DOSBox.exe</h3>${s ? `<p>${escape(s.summary)}</p><p class="sub">As of ${escape(when(s.asOf))}${s.stale ? ' · a newer run exists; this summary may be stale' : ''}</p><div class="links">${s.basis.map((b) => b.github ? link(b.github, b.path) : b.source ? link(b.source, b.path) : `<span class="sub">${escape(b.path)}${b.present ? '' : ' (missing)'}</span>`).join('')}</div>` : `<p class="sub">${escape(r.dosbox.reason)}</p>`}`
    + `<h3>Payload</h3><p class="sub">${r.payload.present ? `${r.payload.files} files, ${dosBytes(r.payload.bytes)}, read in place; ${escape(r.load?.policy === 'preload-all' ? 'all downloaded before boot (ToyVM cannot fetch on demand)' : r.load?.policy || '')}.${excluded ? ' GOG wrapper files left out: ' + escape(excluded) + '.' : ''}` : escape(r.payload.reason)}</p><div class="links">${r.fileListGithub ? link(r.fileListGithub, 'File manifest (size + sha256)') : ''}</div>`
    + `<h3>Provenance</h3><p class="sub">${p.packages.map((x) => `${escape(x.url)}${x.sha1 ? ' · sha1 ' + escape(x.sha1) : ''}`).join('<br>') || 'No package recorded.'}</p><p class="sub">${escape(p.license)}</p><div class="links">${p.sourcePage ? link(p.sourcePage, 'Source page') : ''}${p.github ? link(p.github, p.manifest) : ''}${r.notes?.source ? link(r.notes.source, 'Investigation notes') : ''}${r.notes?.github ? link(r.notes.github, 'Notes on GitHub') : ''}</div>`
    + `<h3>Evidence</h3>${shots}${r.performance ? `<p>${badge('Measured ' + (r.performance.fps === null ? '' : r.performance.fps.toFixed(1) + ' ') + r.performance.metric, 'good')} ${escape(r.performance.scene)}</p>` : '<p class="sub">No performance measurement recorded.</p>'}`
    + `<div class="panel">${runRows(state.runs.filter((x) => r.latestRun && (x.candidateId === state.runs.find((y) => y.key === r.latestRun.key)?.candidateId)).slice(0, 12))}</div>`
    + `<h3>Linked tasks</h3><div class="panel">${taskRows(state.tasks.filter((t) => r.tasks.some((x) => x.id === t.id)))}</div>`);
}
document.addEventListener('click', (event) => {
  const el = event.target.closest?.('button'); if (!el || !state) return;
  if (el.dataset.dosFilter) { dosFilter = dosFilter === el.dataset.dosFilter ? 'all' : el.dataset.dosFilter; render(); }
  if (el.dataset.dos) dosDetail(el.dataset.dos);
});
