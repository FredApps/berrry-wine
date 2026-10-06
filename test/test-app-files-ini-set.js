'use strict';
// lib/app-files.js applyIniSet: the registry's `iniSet` edits to a mounted INI
// (Deus Ex's renderer choice). Keys are replaced in place, case-insensitively,
// missing keys and sections are appended, and every other byte survives.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { applyIniSet } = require('../lib/app-files');

const bytes = text => Uint8Array.from(text, c => c.charCodeAt(0));
const text = arr => String.fromCharCode(...arr);

const ini = '[URL]\r\nProtocol=unreal\r\n\r\n[Engine.Engine]\r\n' +
  'GameRenderDevice=SoftDrv.SoftwareRenderDevice\r\nAudioDevice=Galaxy\r\n' +
  'renderdevice=SoftDrv.SoftwareRenderDevice\r\n\r\n[Core.System]\r\nPurgeCacheDays=30\xe9\r\n';
const out = text(applyIniSet(bytes(ini), {
  'Engine.Engine': {
    GameRenderDevice: 'D3DDrv.D3DRenderDevice',
    RenderDevice: 'D3DDrv.D3DRenderDevice',
    WindowedRenderDevice: 'D3DDrv.D3DRenderDevice',
  },
  'D3DDrv.D3DRenderDevice': { UseFullscreen: 'False' },
}));
assert.strictEqual(out,
  '[URL]\r\nProtocol=unreal\r\n\r\n[Engine.Engine]\r\n' +
  'GameRenderDevice=D3DDrv.D3DRenderDevice\r\nAudioDevice=Galaxy\r\n' +
  'RenderDevice=D3DDrv.D3DRenderDevice\r\nWindowedRenderDevice=D3DDrv.D3DRenderDevice\r\n\r\n' +
  '[Core.System]\r\nPurgeCacheDays=30\xe9\r\n\r\n[D3DDrv.D3DRenderDevice]\r\nUseFullscreen=False\r\n');

// An empty edit is the identity, byte for byte (Latin-1 included).
assert.strictEqual(text(applyIniSet(bytes(ini), {})), ini);
// LF-only files stay LF-only.
assert.strictEqual(text(applyIniSet(bytes('[A]\nk=1\n'), { A: { k: '2' } })), '[A]\nk=2\n');

// Both hosts apply it, and the Deus Ex entry uses it.
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
assert(/applyIniSet\(/.test(read('host.js')), 'host.js applies iniSet');
assert(/applyIniSet\(/.test(read('test/run.js')), 'run.js applies iniSet');
const apps = require('../lib/apps');
const deus = (apps.APPS || apps.apps || apps).deus_ex_demo;
assert(deus, 'deus_ex_demo is registered');
const iniEntry = deus.files.find(f => typeof f === 'object' && f.iniSet);
assert(iniEntry && /deusex\.ini$/.test(iniEntry.url), 'DeusEx.ini carries the renderer edit');
assert.strictEqual(iniEntry.iniSet['Engine.Engine'].GameRenderDevice, 'D3DDrv.D3DRenderDevice');
assert(deus.dlls.some(d => /d3ddrv\.dll$/.test(d)), 'D3DDrv.dll is mounted');

console.log('PASS applyIniSet: in-place, case-insensitive key edits; appended keys and sections; bytes preserved');
