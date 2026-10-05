#!/usr/bin/env node
const assert = require('assert');
const { VirtualFS } = require('../lib/filesystem');
const VfsPersistence = require('../lib/vfs-persistence');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return Array.from(this.values.keys())[index] || null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

async function run() {
  const storage = new MemoryStorage();
  const first = new VirtualFS();
  const persistence = VfsPersistence.attach(first, {
    appId: 'diablo_demo',
    patterns: ['c:\\save\\*.sav'],
    storage,
  });
  assert.strictEqual(persistence.restored, 0);

  const ignored = first.createFile('C:\\TEMP\\scratch.tmp', 0x40000000, 2);
  first.writeFile(ignored, Uint8Array.from([9, 9]), 2);
  const save = first.createFile('C:\\Save\\Game00.sav', 0x40000000, 2);
  first.writeFile(save, Uint8Array.from([1, 2, 3, 4]), 4);
  const savedWriteTime = { lo: 0x89abcdef, hi: 0x01bf53eb };
  assert.strictEqual(first.setFileTimes(save, null, null, savedWriteTime), 0);
  await Promise.resolve();
  assert.strictEqual(storage.length, 1, 'only opted-in save paths reach browser storage');

  const second = new VirtualFS();
  const restored = VfsPersistence.attach(second, {
    appId: 'diablo_demo',
    patterns: ['c:\\save\\*.sav'],
    storage,
  });
  assert.strictEqual(restored.restored, 1, 'a later process restores the saved file');
  assert.deepStrictEqual(Array.from(second.files.get('c:\\save\\game00.sav').data), [1, 2, 3, 4]);
  assert.deepStrictEqual(second.files.get('c:\\save\\game00.sav').lastWriteTime, savedWriteTime,
    'persistent files keep their Win32 last-write timestamp');

  second.deleteFile('c:\\save\\game00.sav');
  restored.flush();
  assert.strictEqual(storage.length, 0, 'deleting a save removes its persisted copy');

  const bounded = new VirtualFS();
  const boundedPersistence = VfsPersistence.attach(bounded, {
    appId: 'diablo_demo',
    patterns: ['c:\\save\\*.sav'],
    maxFileBytes: 3,
    storage,
  });
  const tooLarge = bounded.createFile('c:\\save\\level1.sav', 0x40000000, 2);
  bounded.writeFile(tooLarge, Uint8Array.from([1, 2, 3, 4]), 4);
  await Promise.resolve();
  assert.strictEqual(storage.length, 0, 'oversized files are not written to localStorage');
  assert.strictEqual(boundedPersistence.pendingCount, 1, 'oversized saves remain visibly unsaved');
  assert.strictEqual(boundedPersistence.lastFlush.saved, 0);

  const flakyStorage = new MemoryStorage();
  let failWrites = true;
  let failDeletes = false;
  let attempts = 0;
  flakyStorage.setItem = function (key, value) {
    attempts++;
    if (failWrites && key.includes('retry.sav')) throw new Error('quota exceeded');
    MemoryStorage.prototype.setItem.call(this, key, value);
  };
  flakyStorage.removeItem = function (key) {
    attempts++;
    if (failDeletes) throw new Error('storage unavailable');
    MemoryStorage.prototype.removeItem.call(this, key);
  };
  const retryVfs = new VirtualFS();
  const reports = [];
  const retry = VfsPersistence.attach(retryVfs, {
    appId: 'retry_test', patterns: ['c:\\save\\*.sav'], storage: flakyStorage,
    onFlush: report => reports.push(report),
  });
  const retryHandle = retryVfs.createFile('c:\\save\\retry.sav', 0x40000000, 2);
  retryVfs.writeFile(retryHandle, Uint8Array.from([7, 8]), 2);
  retryVfs.createFile('c:\\save\\other.sav', 0x40000000, 2);
  assert.strictEqual(retry.flush(), 1, 'flush counts durable saves, not attempts');
  assert.deepStrictEqual(retry.lastFlush, { attempted: 2, saved: 1, failed: 1, pending: 1 });
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(attempts, 2, 'a failed flush does not requeue itself or run its stale microtask');
  assert.strictEqual(retry.lastFlush.failed, 1, 'a stale microtask cannot erase the failure report');
  failWrites = false;
  assert.strictEqual(retry.flush(), 1, 'an explicit flush retries without another file mutation');
  assert.strictEqual(retry.pendingCount, 0);
  assert.deepStrictEqual(reports.map(report => report.pending), [1, 0],
    'flush notifications report failure and subsequent recovery without an intervening stale flush');
  const restoredRetry = new VirtualFS();
  VfsPersistence.attach(restoredRetry, {
    appId: 'retry_test', patterns: ['c:\\save\\*.sav'], storage: flakyStorage,
  });
  assert.deepStrictEqual(Array.from(restoredRetry.files.get('c:\\save\\retry.sav').data), [7, 8]);

  failDeletes = true;
  retryVfs.deleteFile('c:\\save\\retry.sav');
  await Promise.resolve();
  assert.strictEqual(retry.pendingCount, 1, 'failed deletion retains its tombstone intent');
  const attemptsAfterDelete = attempts;
  await Promise.resolve();
  assert.strictEqual(attempts, attemptsAfterDelete, 'failed auto-flush has no busy retry loop');
  failDeletes = false;
  retryVfs.createFile('c:\\save\\wake.sav', 0x40000000, 2);
  await Promise.resolve();
  assert.strictEqual(retry.pendingCount, 0, 'the next mutation retries the failed deletion');
  assert.strictEqual(flakyStorage.length, 2, 'the deleted save is gone and other files remain');

  failWrites = true;
  retryVfs.createFile('c:\\save\\retry.sav', 0x40000000, 2);
  assert.strictEqual(retry.detach(), 0, 'detach reports a failed final flush truthfully');
  assert.strictEqual(retry.pendingCount, 1, 'detach keeps failures retryable on the retained handle');
  failWrites = false;
  assert.strictEqual(retry.flush(), 1);

  const observerVfs = new VirtualFS();
  const observer = VfsPersistence.attach(observerVfs, {
    appId: 'observer', patterns: ['c:\\save\\*.sav'], storage: new MemoryStorage(),
    onFlush() { throw new Error('UI observer failed'); },
  });
  observerVfs.createFile('c:\\save\\game.sav', 0x40000000, 2);
  assert.strictEqual(observer.flush(), 1, 'a failing observer cannot turn a durable save into a failure');
  assert.strictEqual(observer.pendingCount, 0);

  const { createBrowserShell, persistenceFlushReporter } = require('../lib/browser-shell');
  const oldDocument = global.document;
  const oldWindow = global.window;
  const status = { textContent: '' };
  const log = { textContent: '' };
  global.document = { getElementById: id => id === 'status' ? status : null };
  global.window = {};
  try {
    const shell = createBrowserShell({ apps: {} });
    const firstWine = { stop() {} };
    const secondWine = { stop() {} };
    let currentWine = firstWine;
    const reportFirst = persistenceFlushReporter(currentWine, 'first', log, shell.runningApps);
    shell.runningApps.push({ wine: firstWine, name: 'first' });
    currentWine = secondWine;
    const reportSecond = persistenceFlushReporter(currentWine, 'second', log, shell.runningApps);
    shell.runningApps.push({ wine: secondWine, name: 'second' });
    reportFirst({ pending: 1 });
    assert(firstWine._vfsPersistenceWarning.startsWith('first:'));
    assert.strictEqual(secondWine._vfsPersistenceWarning, undefined,
      'saving app A after launching B still reports against A');
    reportSecond({ pending: 2 });
    const secondWarning = secondWine._vfsPersistenceWarning;
    reportFirst({ pending: 0 });
    assert.strictEqual(status.textContent, secondWarning, 'recovering A does not clear B warning');
    firstWine._vfsPersistence = { flush: () => reportFirst({ pending: 1 }) };
    shell.stopRunningApp(shell.runningApps[0]);
    assert.strictEqual(shell.runningApps.length, 1);
    assert(status.textContent.startsWith('first:'), 'stopping A preserves its failed final-flush warning');
    assert.strictEqual(secondWine._vfsPersistenceWarning, secondWarning);
    reportFirst({ pending: 0 });
    assert.strictEqual(status.textContent, secondWarning, 'recovery restores the remaining app warning');
    reportSecond({ pending: 0 });
    assert.strictEqual(status.textContent, 'Running 1 app(s)');
    assert(log.textContent.includes('first: pending save files saved'));
  } finally {
    if (oldDocument === undefined) delete global.document; else global.document = oldDocument;
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow;
  }

  await resetToken();

  console.log('PASS  Browser VFS persistence restores only bounded opt-in app files');
}

// A shipped asset an app persists is shadowed by the saved copy forever, so a
// fix to it never reaches anyone who has already played. `resetToken` drops
// the saved copies once. What has to hold: it clears, it does not keep
// clearing (otherwise nobody could ever save anything again), a new token
// clears again, and an app that asks for no reset is untouched.
async function resetToken() {
  const storage = new MemoryStorage();
  const patterns = ['c:\\settings.dat'];
  const write = (vfs, bytes) => {
    const handle = vfs.createFile('C:\\settings.dat', 0x40000000, 2);
    vfs.writeFile(handle, Uint8Array.from(bytes), bytes.length);
  };

  const played = new VirtualFS();
  VfsPersistence.attach(played, { appId: 'blobby_volley', patterns, storage });
  write(played, [1, 1]);                       // their own copy: p2 on the mouse
  await Promise.resolve();
  assert.strictEqual(storage.length, 1);

  const shipped = new VirtualFS();
  write(shipped, [1, 0]);                      // what we now mount
  const first = VfsPersistence.attach(shipped, {
    appId: 'blobby_volley', patterns, storage, resetToken: 'p2-keyboard',
  });
  assert.strictEqual(first.reset.cleared, 1, 'the stale saved copy is dropped');
  assert.strictEqual(first.restored, 0, 'and is not hydrated on the run that drops it');
  assert.deepStrictEqual(Array.from(shipped.files.get('c:\\settings.dat').data), [1, 0],
    'the mounted file survives the reset');

  write(shipped, [1, 0, 7]);                   // they set their preferences again
  await Promise.resolve();

  const later = new VirtualFS();
  const second = VfsPersistence.attach(later, {
    appId: 'blobby_volley', patterns, storage, resetToken: 'p2-keyboard',
  });
  assert.strictEqual(second.reset, null, 'the same token does not reset twice');
  assert.strictEqual(second.restored, 1, 'so what they saved after the reset is kept');
  assert.deepStrictEqual(Array.from(later.files.get('c:\\settings.dat').data), [1, 0, 7]);

  const bumped = new VirtualFS();
  const third = VfsPersistence.attach(bumped, {
    appId: 'blobby_volley', patterns, storage, resetToken: 'something-else',
  });
  assert.strictEqual(third.reset.cleared, 1, 'a new token resets again');
  assert.strictEqual(third.reset.previous, 'p2-keyboard');

  write(bumped, [4]);
  await Promise.resolve();
  const untouched = new VirtualFS();
  const fourth = VfsPersistence.attach(untouched, { appId: 'blobby_volley', patterns, storage });
  assert.strictEqual(fourth.reset, null, 'an app that asks for no reset never clears anything');
  assert.strictEqual(fourth.restored, 1);

  // One app's reset is not another's: the stamp and the files are per appId.
  const other = new VirtualFS();
  VfsPersistence.attach(other, { appId: 'quake2', patterns, storage });
  write(other, [9]);
  await Promise.resolve();
  const mine = new VirtualFS();
  VfsPersistence.attach(mine, {
    appId: 'blobby_volley', patterns, storage, resetToken: 'third-token',
  });
  const survivor = new VirtualFS();
  const kept = VfsPersistence.attach(survivor, { appId: 'quake2', patterns, storage });
  assert.strictEqual(kept.restored, 1, 'resetting one app leaves another app\'s saves alone');
  assert.deepStrictEqual(Array.from(survivor.files.get('c:\\settings.dat').data), [9]);

  console.log('PASS  A persistReset token drops stale saved files exactly once');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
