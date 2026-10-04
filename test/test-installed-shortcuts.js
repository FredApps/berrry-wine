#!/usr/bin/env node
// Installed-game shortcuts kept on a media row (lib/installed-shortcuts.js).
//
// WHY: a game installed from kept media must get its desktop icon back after
// a reload, but only while the installed program really is in that media's
// saved C:\ journal. These are the rules that decide that -- what is stored,
// how a reinstall is deduplicated, and which stored icons survive the check on
// restore -- so a wrong answer would either lose the icon or show one for a
// program that is gone.

'use strict';

const assert = require('assert');
const S = require('../lib/installed-shortcuts');

const ICON = 'data:image/png;base64,iVBORw0KGgo=';
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('a shortcut record keeps target, folder, args, label, icon and traits', () => {
  const r = S.persistableShortcut({ target: 'C:\\NFS2SE\\NFS2SEN.EXE', cwd: 'C:\\NFS2SE\\', args: '-w',
    label: 'Need For Speed II SE', iconUrl: ICON, traits: { threads: false, junk: 1 }, savedAt: 5 });
  assert.deepStrictEqual(r, { target: 'c:\\nfs2se\\nfs2sen.exe', cwd: 'c:\\nfs2se\\', args: '-w',
    label: 'Need For Speed II SE', iconUrl: ICON, traits: { threads: false }, savedAt: 5 });
});

test('a non-exe or relative target is not stored', () => {
  assert.strictEqual(S.persistableShortcut({ target: 'C:\\GAME\\README.TXT' }), null);
  assert.strictEqual(S.persistableShortcut({ target: 'game.exe' }), null);
  assert.strictEqual(S.persistableShortcut(null), null);
});

test('an oversized or non-image icon is dropped, the shortcut kept', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(S.MAX_ICON_URL);
  assert.strictEqual(S.persistableShortcut({ target: 'c:\\g\\g.exe', iconUrl: big }).iconUrl, null);
  assert.strictEqual(S.persistableShortcut({ target: 'c:\\g\\g.exe', iconUrl: 'javascript:alert(1)' }).iconUrl, null);
});

test('defaults: folder of the exe, label from the file name', () => {
  const r = S.persistableShortcut({ target: 'c:\\games\\doom\\doom.exe' });
  assert.strictEqual(r.cwd, 'c:\\games\\doom\\');
  assert.strictEqual(r.label, 'doom');
  assert.strictEqual(r.args, null);
  // A .lnk WorkingDir is written without the trailing backslash.
  assert.strictEqual(S.persistableShortcut({ target: 'c:\\g\\g.exe', cwd: 'C:\\GAME' }).cwd, 'c:\\game\\');
});

test('a reinstall replaces the old record instead of adding a second icon', () => {
  const merged = S.mergeShortcuts(
    [{ target: 'c:\\a\\a.exe', label: 'Old' }, { target: 'c:\\b\\b.exe', label: 'B' }],
    [{ target: 'C:\\A\\A.EXE', label: 'New' }]);
  assert.deepStrictEqual(merged.map(r => [r.target, r.label]), [['c:\\b\\b.exe', 'B'], ['c:\\a\\a.exe', 'New']]);
});

test('the list is capped', () => {
  const many = Array.from({ length: S.MAX_SHORTCUTS + 5 }, (_, i) => ({ target: `c:\\g${i}\\g.exe` }));
  const merged = S.mergeShortcuts([], many);
  assert.strictEqual(merged.length, S.MAX_SHORTCUTS);
  assert.strictEqual(merged[merged.length - 1].target, `c:\\g${S.MAX_SHORTCUTS + 4}\\g.exe`);
});

test('restore keeps a C: target that is a saved file in the journal', () => {
  const r = S.restorable([{ target: 'c:\\nfs\\nfs.exe' }], [{ path: 'c:\\nfs\\nfs.exe', kind: 'file' }], 'D:');
  assert.deepStrictEqual(r.keep.map(s => s.target), ['c:\\nfs\\nfs.exe']);
  assert.deepStrictEqual(r.drop, []);
});

test('restore drops a C: target that was deleted or never saved', () => {
  const r = S.restorable([{ target: 'c:\\gone\\g.exe' }, { target: 'c:\\never\\n.exe' }],
    [{ path: 'c:\\gone\\g.exe', kind: 'whiteout' }], 'D:');
  assert.deepStrictEqual(r.keep, []);
  assert.deepStrictEqual(r.drop.map(s => s.target), ['c:\\gone\\g.exe', 'c:\\never\\n.exe']);
});

test('a target on the kept disc itself stays', () => {
  const r = S.restorable([{ target: 'd:\\game\\run.exe' }], [], 'D:');
  assert.deepStrictEqual(r.keep.map(s => s.target), ['d:\\game\\run.exe']);
  const noDisc = S.restorable([{ target: 'd:\\game\\run.exe' }], [], null);
  assert.deepStrictEqual(noDisc.keep, [], 'without a mounted disc drive nothing vouches for D:');
});

test('an unreadable journal shows nothing and prunes nothing', () => {
  const r = S.restorable([{ target: 'c:\\a\\a.exe' }], null, 'D:');
  assert.deepStrictEqual(r.keep, []);
  assert.deepStrictEqual(r.drop, []);
  assert.strictEqual(r.unknown.length, 1);
});

test('the restored entry launches the installed exe from the kept media with its journal', async () => {
  const mount = async () => ({ root: 'D:\\' });
  const row = { id: 'm1', name: 'NFS2SE.ISO' };
  const sc = S.persistableShortcut({ target: 'c:\\nfs\\nfs.exe', cwd: 'c:\\nfs\\', args: '-x',
    label: 'NFS', traits: { threads: false } });
  const e = S.entryFor(row, sc, mount);
  assert.strictEqual(e.exe, 'c:\\nfs\\nfs.exe');
  assert.strictEqual(e.badge, 'kept');
  assert.strictEqual(e.mediaId, 'm1', 'badge kept + mediaId is what attaches the durable overlay');
  assert.strictEqual(e.dynamic, true);
  assert.strictEqual(e.workingDirectory, 'c:\\nfs\\');
  assert.strictEqual(e.args, '-x');
  assert.strictEqual(e.threads, false);
  assert.deepStrictEqual(e.mounts, [mount]);
  const vfs = { materialize: async p => `bytes:${p}` };
  assert.strictEqual(await e.exeBytes(vfs), 'bytes:c:\\nfs\\nfs.exe');
});

test('app ids are stable per media and target', () => {
  assert.strictEqual(S.appIdFor('m1', 'C:/Game/Run.EXE'), 'lnk:m1:c:\\game\\run.exe');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n${e.stack}`); }
  }
  if (failed) { console.log(`${failed} of ${cases.length} failed`); process.exit(1); }
  console.log(`PASS  ${cases.length} installed-shortcut cases`);
})();
