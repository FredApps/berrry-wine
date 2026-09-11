'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const { VirtualFS } = require('../lib/filesystem');
const { GuestThreadHost } = require('../lib/guest-thread-host');
const { fontMounts } = require('../lib/font-substitutions');
const Catalog = require('../lib/font-catalog');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const module_ = await WebAssembly.compile(compileSrcWasm());
  const sigs = require('../lib/host-import-sigs.generated.json').sigs;
  const exe = new Uint8Array(fs.readFileSync(path.join(__dirname, 'binaries/notepad.exe')));
  const font = fontMounts(require('../fonts/substitutions.json')).find(f => f.vfsPath.endsWith('arial.ttf'));
  const fontBytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'fonts', font.file)));
  for (const stale of [false, true]) {
    const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
    const ctx = { getMemory: () => memory.buffer,
      resourceJson: { menus: {}, dialogs: {}, strings: {}, bitmaps: {} }, onExit() {} };
    const imports = createHostImports(ctx); imports.host.memory = memory;
    const shadow = new WebAssembly.Instance(module_, imports).exports; ctx.exports = shadow;
    const host = new GuestThreadHost({ memory, module: module_, sigs, hostImports: imports.host,
      workerUrl: path.join(ROOT, 'lib/guest-worker.js'), clockIntervalMs: 0 });
    const vfs = new VirtualFS(), sourcePath = 'c:\\windows\\fonts\\remote-fixture.ttf';
    vfs.files.set(sourcePath, { data: fontBytes.slice() });
    let live = 0, admitted = false;
    const prepare = vfs.prepareReadLease.bind(vfs);
    vfs.prepareReadLease = async (...args) => {
      const lease = await prepare(...args); live++;
      let released = false;
      return { ...lease, release() { if (!released) { released = true; live--; } lease.release(); } };
    };
    try {
      await host.start(); await host.loadPe(exe, 'notepad.exe');
      const worker = {
        getFontCatalogStartupState: () => host.getFontCatalogStartupState(),
        getFontCatalogExclusions: () => host.getFontCatalogExclusions(),
        async installFontCatalog(...args) {
          assert.strictEqual(live, 1, 'source lease remains owned before remote publication');
          const reply = await host.installFontCatalog(...args);
          assert.strictEqual(live, 1, 'source lease remains owned through real Worker reply');
          if (stale) vfs.files.set(sourcePath, { data: fontBytes.slice() });
          return reply;
        },
      };
      const work = Catalog.installRemote(vfs, { worker });
      if (stale) await assert.rejects(work, /stale|changed|discard/);
      else { const reply = await work; assert.strictEqual(reply.count, 1); admitted = true; }
      assert.strictEqual(live, 0);
      assert.strictEqual(admitted, !stale);
      assert.strictEqual(shadow.font_catalog_ready(), 0);
      const state = await host.readExports(['font_catalog_ready', 'font_catalog_generation']);
      assert.strictEqual(state.font_catalog_ready, 1, 'remote commit completed even if later host validation rejected it');
      assert.strictEqual(state.font_catalog_generation, 1);
      assert.strictEqual(await host.callExport('get_last_run_blocks'), 0, 'no guest execution before admission');
    } finally { await host.stop(); vfs.files.clear(); }
  }
  console.log('PASS real remote catalog leases span publication/reply; stale committed process is rejected and discarded without execution');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
