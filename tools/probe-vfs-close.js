'use strict';

// Diagnostic preload, never imported by a shipping host:
// node --require=./tools/probe-vfs-close.js test/run.js ... [--vfs-close-strict]
// Audit the existing close policy by default; the explicit strict arm deletes
// closed file handles. This is an experiment, not complete DuplicateHandle or
// pending-I/O lifetime support. It does not change console/kernel-handle paths.
const { VirtualFS } = require('../lib/filesystem');
const strict = process.argv.includes('--vfs-close-strict');
const closed = new WeakMap();
const counts = { close: 0, readAfterClose: 0, writeAfterClose: 0, seekAfterClose: 0 };

const originalCreate = VirtualFS.prototype.createFile;
VirtualFS.prototype.createFile = function(...args) {
  const handle = originalCreate.apply(this, args);
  if (handle) closed.get(this)?.delete(handle >>> 0);
  return handle;
};

const originalClose = VirtualFS.prototype.closeHandle;
VirtualFS.prototype.closeHandle = function(handle) {
  handle >>>= 0;
  if (this.handles.has(handle)) {
    let handles = closed.get(this);
    if (!handles) closed.set(this, handles = new Set());
    handles.add(handle);
    counts.close++;
    if (strict) {
      this.handles.delete(handle);
      this.readFaults.delete(handle);
      return true;
    }
  }
  return originalClose.call(this, handle);
};

for (const [method, key] of [['readFile', 'readAfterClose'], ['writeFile', 'writeAfterClose'],
  ['setFilePointer', 'seekAfterClose']]) {
  const original = VirtualFS.prototype[method];
  VirtualFS.prototype[method] = function(handle, ...args) {
    if (closed.get(this)?.has(handle >>> 0)) counts[key]++;
    return original.call(this, handle, ...args);
  };
}
process.on('exit', () => console.log('[close-probe]', JSON.stringify({ strict, ...counts })));
