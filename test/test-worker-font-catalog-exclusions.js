'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const { GuestThreadHost } = require('../lib/guest-thread-host');
const Catalog = require('../lib/font-catalog');
const root = path.resolve(__dirname, '..');

(async () => {
  const binary = compileSrcWasm((file, source) => {
    if (file === '13-exports.wat') return source + `
      (global $exclusion_calls (mut i32) (i32.const 0))
      (global $exclusion_fail (mut i32) (i32.const 0))
      (func (export "exclusion_calls") (result i32) (global.get $exclusion_calls))
      (func (export "exclusion_fail") (param i32) (global.set $exclusion_fail (local.get 0)))`;
    if (file === '10c-truetype.wat') {
      const start = source.indexOf('(func (export "font_catalog_exclusion_path")');
      const body = source.indexOf('(if (i32.lt_s (local.get $index)', start);
      assert(start >= 0 && body > start);
      return source.slice(0, body) + `
        (global.set $exclusion_calls (i32.add (global.get $exclusion_calls) (i32.const 1)))
        (if (global.get $exclusion_fail) (then (return (i32.const -1))))
        ` + source.slice(body);
    }
    return source;
  });
  const module_ = await WebAssembly.compile(binary);
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
  const ctx = { getMemory: () => memory.buffer,
    resourceJson: { menus: {}, dialogs: {}, strings: {}, bitmaps: {} }, onExit() {} };
  const imports = createHostImports(ctx); imports.host.memory = memory;
  const shadow = new WebAssembly.Instance(module_, imports).exports; ctx.exports = shadow;
  const sigs = JSON.parse(fs.readFileSync(path.join(root, 'lib/host-import-sigs.generated.json'), 'utf8')).sigs;
  const host = new GuestThreadHost({ memory, module: module_, sigs, hostImports: imports.host,
    workerUrl: path.join(root, 'lib/guest-worker.js'), clockIntervalMs: 0 });
  try {
    await host.start();
    await host.loadPe(new Uint8Array(fs.readFileSync(path.join(__dirname, 'binaries/notepad.exe'))), 'notepad.exe');
    const fields = ['get_eip', 'get_esp', 'get_last_run_blocks', 'font_catalog_ready', 'font_catalog_generation'];
    const before = await host.readExports(fields);
    const seq = host.link._seq;
    const paths = await host.getFontCatalogExclusions();
    assert.strictEqual(host.link._seq, seq + 1, 'one owner-side message, not per-pointer round trips');
    assert(Object.isFrozen(paths)); assert(paths.length > 0);
    assert.strictEqual(shadow.exclusion_calls(), 0, 'query never executes on the shadow instance');
    assert((await host.callExport('exclusion_calls')) > 0);
    assert.deepStrictEqual(paths, Catalog.excludedPaths({ exports: shadow, memory }));
    assert.deepStrictEqual(await host.readExports(fields), before, 'query changes no guest execution/catalog state');
    await host.callExport('exclusion_fail', 1);
    await assert.rejects(host.getFontCatalogExclusions(), /exclusion/);
    assert(paths.length > 0, 'earlier copied snapshot survives later query failure');
    await host.callExport('exclusion_fail', 0);
    assert.deepStrictEqual(await host.getFontCatalogExclusions(), paths);
  } finally { await host.stop(); }
  console.log('PASS real Worker exclusion snapshot: one owned query, no shadow/guest execution, copied policy and error recovery');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
