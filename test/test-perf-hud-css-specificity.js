#!/usr/bin/env node

'use strict';

// The FPS HUD lives inside the same page as the guest screen, and index.html
// styles every bare <canvas> as the full-bleed screen surface -- in several
// fullscreen states with `height: 0 !important`, which is a canvas that draws
// nothing. The HUD injects its own rule to opt out of that.
//
// A rule that loses this fight fails SILENTLY: the HUD box is still there,
// still positioned, still painted by JS -- it is just 0px tall inside its own
// border, which reads as "the graph does not render" with nothing in the
// console. It already happened once. The HUD's opt-out enumerated the body
// states to beat, index.html grew `body:not(.no-debug).exclusive-fullscreen`,
// and the graph vanished on every app that asks for the screen (SimGolf) in
// the only session that can turn it on (?debug, which is what makes that
// `:not(.no-debug)` true).
//
// So this checks the cascade itself, statically: every rule in index.html
// that would style the HUD's canvas, against the HUD's own rule, by real CSS
// specificity. It is the enumeration-free property that matters -- the HUD
// must win without naming any body state.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const perfHud = fs.readFileSync(path.join(root, 'lib', 'perf-hud.js'), 'utf8');

// CSS specificity as (ids, classes, elements). :not()/:is() contribute their
// most specific argument, which is why `canvas:not(#touch-cursor)` counts an
// id -- the exact term that made the old guard lose.
function specificity(selector) {
  let s = selector.trim();
  let ids = 0, classes = 0, elements = 0;
  s = s.replace(/:(?:not|is|has)\(([^()]*)\)/g, (_, inner) => {
    const best = inner.split(',').map(specificity).sort(compare).pop();
    if (best) { ids += best[0]; classes += best[1]; elements += best[2]; }
    return ' ';
  });
  ids += (s.match(/#[\w-]+/g) || []).length;
  classes += (s.match(/\.[\w-]+/g) || []).length
    + (s.match(/\[[^\]]*\]/g) || []).length
    + (s.match(/:(?!:)[\w-]+/g) || []).length;
  elements += (s.match(/(?:^|[\s>+~(])([a-zA-Z][\w-]*)/g) || []).length
    + (s.match(/::[\w-]+/g) || []).length;
  return [ids, classes, elements];
}

const compare = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
const show = t => `(${t.join(',')})`;

// Sanity-check the calculator on the two selectors this test exists for,
// before trusting it about anything else.
assert.deepStrictEqual(
  specificity('body:not(.no-debug).exclusive-fullscreen canvas:not(#touch-cursor)'),
  [1, 2, 2], 'specificity(): :not() contributes its argument');
assert.deepStrictEqual(specificity('#perf-hud canvas'), [1, 0, 1],
  'specificity(): plain id + element');
assert.deepStrictEqual(specificity('#perf-hud#perf-hud canvas'), [2, 0, 1],
  'specificity(): a repeated id counts twice');

// Every overlay whose <canvas> is in this page and survives those rules by
// SPECIFICITY, read out of the source rather than restated, so editing the
// rule and not this test cannot pass.
//
// The other attached canvases, and why none of them is here: #touch-cursor is
// exempted by name (`:not(#touch-cursor)`) in the full-bleed rules and lives
// on <body>, outside #screen-wrap; gpu-backend's presentation canvas is never
// attached to the document, so no stylesheet reaches it; and the power-off
// logo is covered by the note below.
const overlays = [
  {
    what: 'lib/perf-hud.js FPS graph',
    id: '#perf-hud',
    selectors: [...perfHud.matchAll(/'(#perf-hud[^']*)'/g)].map(m => m[1]),
  },
];
// lib/shutdown.js's power-off logo is the same shape and its rule is only
// (1,1,1), so several of those full-bleed rules do outrank it -- but it is
// NOT listed here, because specificity is not what protects it: fit() sets
// its width and height as inline !important declarations, which outrank every
// stylesheet rule. Checked, not assumed: test-web-shutdown measures that
// logo's box inside element fullscreen and passes with the (1,1,1) selector.
// Requiring it to win on specificity would be a false requirement.
for (const overlay of overlays) {
  assert.ok(overlay.selectors.length,
    `${overlay.what} no longer injects an id-scoped rule`);
}

// Every selector in index.html's stylesheet that matches a bare canvas and so
// would also capture an overlay's. A rule naming an overlay by id would be
// deliberate and is excluded; #touch-cursor and #screen-canvas-stack name
// other elements these canvases are not.
// Comments come out FIRST: index.html's stylesheet is heavily commented, and
// prose sitting just above a rule is otherwise swept up as part of its
// selector (a 27-word "selector" at specificity (2,0,27) that outranks
// everything and means nothing).
const css = [...indexHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map(m => m[1]).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const competing = [...css.matchAll(/(^|[}\n])([^{}@]+)\{/g)]
  .map(m => m[2])
  .join(',')
  .split(',')
  .map(s => s.trim())
  .filter(s => /(^|[\s>+~])canvas(?![\w-])/.test(s))
  .filter(s => !/#screen-canvas-stack/.test(s))
  .filter(s => !overlays.some(o => s.includes(o.id)));

assert.ok(competing.length >= 2,
  `expected index.html to still style bare canvases, found ${competing.length}`);

let checked = 0;
for (const overlay of overlays) {
  const guards = overlay.selectors.filter(s => /(^|[\s>+~])canvas(?![\w-])/.test(s));
  assert.ok(guards.length, `${overlay.what} no longer guards its own canvas`);

  // Only an UNCONDITIONAL guard counts. A state-gated one
  // (`#screen-wrap:fullscreen #perf-hud canvas`, (2,1,1)) scores higher than
  // the rule that has to carry every OTHER state, so ranking by the best
  // selector would have called the old, broken list healthy. Rank by the
  // weakest rule that is always in force. "Gated" here means it depends on
  // something outside the overlay -- <body>, <html>, a pseudo-class, or a
  // foreign id. A class on the canvas itself (.logo) is not a gate: the
  // element always carries it.
  const unconditional = guards.filter(s => !/\b(?:body|html)\b|:|#(?!\w)/
    .test(s.split(overlay.id).join(' ')));
  assert.ok(unconditional.length,
    `${overlay.what} must guard its canvas with a rule that applies in every`
    + ` page state; found only gated ones: ${guards.join(' | ')}`);

  const best = unconditional.map(specificity).sort(compare).pop();
  for (const selector of competing) {
    const theirs = specificity(selector);
    assert.ok(compare(best, theirs) > 0,
      `${overlay.what}: its canvas rule ${show(best)} does not outrank\n`
      + `  ${selector}\n  ${show(theirs)}\n`
      + 'Add specificity by repeating the overlay id -- do NOT enumerate'
      + ' another body state, that is the list that goes stale.');
    checked++;
  }
  console.log(`      ${overlay.what}: ${show(best)} beats all ${competing.length}`
    + `  [${unconditional.join(', ')}]`);
}

// The regression itself, pinned so the reasoning above cannot rot: the guard
// this replaced really did lose to a rule index.html grew, in the state the
// HUD actually appears in. The FPS toggle lives in the ?debug toolbar, and
// ?debug is precisely what makes `:not(.no-debug)` true -- so the variant its
// old list did cover (no-debug) was the one it can never run in.
for (const [was, offender, why] of [
  ['#perf-hud canvas',
    'body:not(.no-debug).exclusive-fullscreen canvas:not(#touch-cursor)',
    'the FPS graph in a ?debug session on an app that takes the display'],
]) {
  assert.ok(css.includes(offender.replace(/^body[^ ]* /, '')),
    `index.html still has the full-bleed rule behind "${why}"`);
  assert.ok(compare(specificity(was), specificity(offender)) < 0,
    `"${was}" is supposed to LOSE to "${offender}" -- that is the bug this`
    + ' test pins. If this fails the calculator is wrong, not the shell.');
}

console.log(`PASS  ${overlays.length} overlay canvases outrank every full-bleed`
  + ` rule in index.html (${checked} comparisons), none by naming a body state`);
