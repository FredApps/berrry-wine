'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compileSrcWasm } = require('./compile-src');
const { createHostImports } = require('../lib/host-imports');
const { GuestThreadHost } = require('../lib/guest-thread-host');
const { BUNDLED_BITMAP_FONTS } = require('../lib/font-substitutions');
const root = path.resolve(__dirname, '..');

(async () => {
  const extra = '(global $font_test_calls (mut i32) (i32.const 0)) ' +
    '(func (export "font_test_calls") (result i32) (global.get $font_test_calls))';
  const binary = compileSrcWasm((file, source) => {
    if (file === '13-exports.wat') return source + extra;
    if (file === '10b-gdi-font.wat') {
      const start = source.indexOf('(func (export "stock_font_install")');
      const body = source.indexOf('(local.set $state ', start);
      assert(start >= 0 && body > start);
      return source.slice(0, body) +
        '(global.set $font_test_calls (i32.add (global.get $font_test_calls) (i32.const 1))) ' + source.slice(body);
    }
    return source;
  });
  const module_ = await WebAssembly.compile(binary);
  const sigs = JSON.parse(fs.readFileSync(path.join(root, 'lib/host-import-sigs.generated.json'), 'utf8')).sigs;
  const fonts = BUNDLED_BITMAP_FONTS.map(name =>
    new Uint8Array(fs.readFileSync(path.join(root, 'fonts', name))));
  for (const malformed of [false, true]) {
    const memory = new WebAssembly.Memory({ initial: 8192, maximum: 8192, shared: true });
    const ctx = { getMemory: () => memory.buffer,
      resourceJson: { menus: {}, dialogs: {}, strings: {}, bitmaps: {} }, onExit() {} };
    const imports = createHostImports(ctx); imports.host.memory = memory;
    const shadow = new WebAssembly.Instance(module_, imports).exports; ctx.exports = shadow;
    const host = new GuestThreadHost({ memory, module: module_, sigs, hostImports: imports.host,
      workerUrl: path.join(root, 'lib/guest-worker.js'), clockIntervalMs: 0 });
    try {
      await host.start();
      await host.loadPe(new Uint8Array(fs.readFileSync(path.join(__dirname, 'binaries/notepad.exe'))), 'notepad.exe');
      const fields = ['get_eip', 'get_esp', 'get_last_run_blocks'];
      const initial = await host.readExports(fields);
      const states = () => Promise.all([0, 1, 2, 3, 4].map(i => host.callExport('stock_font_state', i)));
      if (malformed) {
        await assert.rejects(() => host.installStockFonts(fonts.map((b, i) =>
          i === 1 ? new Uint8Array(128).fill(0xa5) : b)), /discard/);
        assert.deepStrictEqual(await states(), [2, 0, 0, 0, 0], 'partial batch must be discarded, never retried');
      } else {
        for (const bad of [[], fonts.slice(0, 4), [...fonts, fonts[0]],
          fonts.map((b, i) => i === 4 ? new Uint8Array() : b),
          fonts.map((b, i) => i === 4 ? new Uint8Array(0xF0001) : b),
          fonts.map((b, i) => i === 4 ? 'bad' : b)]) {
          const before = host.link._seq;
          await assert.rejects(() => host.installStockFonts(bad));
          assert.strictEqual(host.link._seq, before, 'host rejects before sending');
          const reply = await host.link._ask({ t: 'installStockFonts', fonts: bad });
          assert(reply.error, 'Worker independently validates untrusted batch shape');
          assert.deepStrictEqual(await states(), [0, 0, 0, 0, 0]);
          assert.strictEqual(await host.callExport('font_test_calls'), 0);
        }
        assert(await host.installStockFonts(fonts) > 0);
        assert.deepStrictEqual(await states(), [2, 2, 2, 2, 2]);
        assert.strictEqual(await host.callExport('font_test_calls'), 5);
        assert.deepStrictEqual([0, 1, 2, 3, 4].map(i => shadow.stock_font_state(i)), [2, 2, 2, 2, 2]);
        await assert.rejects(() => host.installStockFonts(fonts), /already initialized/);
        assert.strictEqual(await host.callExport('font_test_calls'), 5, 'all states checked before duplicate publication');
      }
      assert.strictEqual(shadow.font_test_calls(), 0, 'shadow never parses fonts');
      assert.deepStrictEqual(await host.readExports(fields), initial, 'font publication runs no guest instructions');
    } finally { await host.stop(); }
  }
  console.log('PASS real Worker fonts: host/Worker bounds, partial failure discard, owner-only parsing, shared readiness, no guest execution');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
