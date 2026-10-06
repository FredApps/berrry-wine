#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  SYSTEM_DATA_FILES, mountSystemDataFiles,
  WIN16_SYSTEM_MODULE_FILES, DIRECTX_SYSTEM_MODULE_FILES,
} = require('../lib/process-boot');
const { clearStore, exportStore } = require('../lib/storage');

const stdole = SYSTEM_DATA_FILES.find(file => /stdole2\.tlb$/i.test(file.vfsPath));
assert(stdole, 'shared process boot must declare stdole2.tlb');
assert.strictEqual(stdole.vfsPath.toLowerCase(), 'c:\\windows\\system\\stdole2.tlb');
// The live site does not publish it, so the browser must not ask for it there.
assert.strictEqual(stdole.localOnly, true, 'stdole2.tlb is a local-only system file');
const shell = fs.readFileSync(path.join(__dirname, '..', 'lib', 'browser-shell.js'), 'utf8');
assert(/deployed && file\.localOnly/.test(shell),
  'browser shell must skip localOnly system files on a deployed site');

const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', stdole.url)));
assert.strictEqual(Buffer.from(bytes.subarray(0, 4)).toString('ascii'), 'MSFT',
  'bundled stdole2 asset must be a raw MSFT type library');

const vfs = { files: new Map() };
// The count also takes in the emulator's own system-module stubs.
assert.strictEqual(mountSystemDataFiles(vfs, [{ ...stdole, bytes }]),
  2 + WIN16_SYSTEM_MODULE_FILES.length + DIRECTX_SYSTEM_MODULE_FILES.length); // stdole2 + OpenGL
assert.strictEqual(vfs.files.get('c:\\windows\\system\\stdole2.tlb').data, bytes);

clearStore();
const registry = exportStore();
const key = Object.keys(registry).find(name =>
  name.toLowerCase() ===
    'reg:hkcr\\typelib\\{00020430-0000-0000-c000-000000000046}\\2.0\\0\\win32');
assert(key, 'default registry must register the standard OLE v2 type library');
const entry = JSON.parse(registry[key]);
assert.strictEqual(entry.values[''].data.toLowerCase(),
  'c:\\windows\\system\\stdole2.tlb');

console.log('PASS  shared boot mounts and registers stdole2.tlb');
