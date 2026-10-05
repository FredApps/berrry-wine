'use strict';

// Every app a list in lib/apps.js can show must have a concrete <option> in
// index.html.
//
// The toolbar <select id="app-select"> is a STATIC option list. initDesktop()
// only REMOVES options that the active app lists do not allow — it never adds
// one — so registry membership alone gets an app a desktop icon and leaves it
// invisible in the selector. That asymmetry is silent: the app launches by
// icon, so nothing fails, and the only symptom is a dropdown that does not
// list it.
//
// Measured the day this was written: warcraft3_demo had been added to
// LOCAL_CANDIDATE_APPS with no <option>, and eight more apps were already in
// that state — pocket_tanks, little_fighter_2, icy_tower, snood and its
// installer, unreal_special_demo, ut2003_demo, ut2004_demo — several of them
// listed alongside their own installers, which did have options.
//
// test-local-proprietary-demo-dropdown.js asserts the same invariant, but only
// against seven hand-listed ids, so by construction it cannot see a newly added
// app. This one reads the lists.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DESKTOP_APPS, LOCAL_CANDIDATE_APPS, DEBUG_ONLY_APPS,
} = require('../lib/apps');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const LISTS = [
  ['DESKTOP_APPS', DESKTOP_APPS],
  ['LOCAL_CANDIDATE_APPS', LOCAL_CANDIDATE_APPS],
  ['DEBUG_ONLY_APPS', DEBUG_ONLY_APPS],
];

let total = 0;
for (const [name, list] of LISTS) {
  assert(Array.isArray(list) && list.length, `${name} is a non-empty app list`);
  const missing = list
    .map(([id]) => id)
    .filter(id => !html.includes(`<option value="${id}">`));
  assert.deepStrictEqual(missing, [],
    `${name}: these apps can be shown but have no <option> in index.html, so ` +
    `they are absent from the selector: ${missing.join(', ')}`);
  total += list.length;
}

// One id, one option. A duplicate is not caught by the check above and shows
// the app twice in the dropdown.
for (const [, list] of LISTS) {
  for (const [id] of list) {
    const n = html.split(`<option value="${id}">`).length - 1;
    assert.strictEqual(n, 1, `${id} has exactly one <option> (found ${n})`);
  }
}

// The three lists are meant to be disjoint: an app in two of them is offered
// twice by initDesktop()'s concat.
const seen = new Map();
for (const [name, list] of LISTS) {
  for (const [id] of list) {
    assert(!seen.has(id),
      `${id} appears in both ${seen.get(id)} and ${name}`);
    seen.set(id, name);
  }
}

console.log(`PASS  every listed app has a selector option (${total} apps across ` +
  `${LISTS.length} lists)`);
