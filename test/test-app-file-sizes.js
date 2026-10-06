#!/usr/bin/env node
'use strict';

// lib/apps.js stamps lib/app-file-sizes.generated.js onto its inline files[]
// entries, so the lazy-file policy (lib/app-files.js) can stream the large
// ones -- since 8bcc3055 an unsized entry always stays eager, and the
// hand-written entries had no sizes. Pinned here: a recorded string entry
// becomes {url, size}, a recorded object gains size and keeps every other
// field, an entry that already declares how it loads is left as written, an
// unrecorded entry is untouched, and the generated map only holds files at
// least SMALL_FILE_BYTES (smaller ones change no decision). Caesar III's
// archives are the worked example: they stream once sized.

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sizes = require(path.join(ROOT, 'lib', 'app-file-sizes.generated.js'));
const { SMALL_FILE_BYTES, normalizeLazyFiles } = require(path.join(ROOT, 'lib', 'app-files.js'));

const load = off => {
  if (off) process.env.WA_APP_FILE_SIZES_OFF = '1'; else delete process.env.WA_APP_FILE_SIZES_OFF;
  delete require.cache[require.resolve(path.join(ROOT, 'lib', 'apps.js'))];
  const { APPS } = require(path.join(ROOT, 'lib', 'apps.js'));
  delete process.env.WA_APP_FILE_SIZES_OFF;
  return APPS;
};
const raw = load(true);
const stamped = load(false);

assert(Object.keys(sizes).length > 100, 'the generated map is populated');
for (const [url, size] of Object.entries(sizes)) {
  assert(Number.isSafeInteger(size) && size >= SMALL_FILE_BYTES, `${url}: ${size} is a recorded large size`);
}

let stringsStamped = 0, objectsStamped = 0, declaredKept = 0, unrecordedKept = 0;
for (const [id, app] of Object.entries(raw)) {
  const before = app.files || [];
  const after = stamped[id].files || [];
  assert.strictEqual(after.length, before.length, `${id}: same number of files`);
  before.forEach((item, i) => {
    const url = typeof item === 'string' ? item : item && item.url;
    const out = after[i];
    const size = sizes[url];
    if (!Number.isSafeInteger(size)) {
      assert.deepStrictEqual(out, item, `${id}: an unrecorded entry is untouched`); unrecordedKept++;
      return;
    }
    if (typeof item === 'string') {
      assert.deepStrictEqual(out, { url: item, size }, `${id}: ${item} becomes {url, size}`); stringsStamped++;
    } else if (Number.isSafeInteger(item.size) || item.loadMode !== undefined || item.httpRange !== undefined) {
      assert.deepStrictEqual(out, item, `${id}: a declared entry is left as written`); declaredKept++;
    } else {
      assert.deepStrictEqual(out, { ...item, size }, `${id}: an object gains size only`); objectsStamped++;
    }
  });
}
assert(stringsStamped + objectsStamped > 0, 'some inline entries are stamped');

// The worked example: Caesar III's large archives stream once sized and did
// not before (every file unsized -> eager).
const policyOf = apps => normalizeLazyFiles(apps.caesar3_demo, apps.caesar3_demo.files, { syncAudio: false }).summary;
if (stamped.caesar3_demo && Object.keys(sizes).some(url => url.includes('caesar'))) {
  assert.strictEqual(policyOf(raw).lazyFiles, 0, 'unsized, Caesar III streamed nothing');
  assert(policyOf(stamped).lazyFiles > 0, 'sized, Caesar III streams its archives');
}

console.log(`PASS  generated sizes stamp inline files[] (${stringsStamped} strings, ${objectsStamped} objects; ` +
  `${declaredKept} declared and ${unrecordedKept} unrecorded entries left as written)`);
