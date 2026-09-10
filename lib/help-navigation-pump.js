// Deferred native Help work runs between guest invocations, never by replacing
// the application's CPU state or its existing wait with an artificial IO_WAIT.
(function (root) {
  'use strict';
  async function pump({ exports: ex, call, pending, vfs, alive = () => true }) {
    if (!call) {
      if (!ex || !ex.get_help_navigation_pending) return { pending: false, serviced: false, filled: false };
      call = (name, ...args) => ex[name](...args);
    }
    const result = { pending: false, serviced: false, filled: false };
    if (pending === undefined) pending = await call('get_help_navigation_pending');
    if (!pending) return result;
    result.pending = true;
    const cancelIfDead = async () => {
      if (alive()) return false;
      try { await call('help_navigation_cancel'); }
      catch (error) { if (alive()) throw error; /* terminated Worker owns no live instance */ }
      result.pending = false;
      return true;
    };
    if (await cancelIfDead()) return result;
    // A foreign guest read owns the singleton notification until its ordinary
    // IO_WAIT handler consumes it. Do not steal that read to advance Help.
    const own = async () => (await call('get_help_navigation_io_handle')) | 0;
    if (vfs && vfs.pendingRead && (vfs.pendingRead.handle | 0) !== await own()) return result;
    if (await cancelIfDead()) return result;
    const existing = vfs && vfs.pendingRead;
    let status = existing ? -1 : await call('help_navigation_service');
    result.serviced = !existing;
    if (status === -1 && vfs) {
      const handle = await own();
      const request = vfs.pendingRead;
      if (request && (request.handle | 0) === handle && handle) {
        if (await cancelIfDead()) return result;
        try { await vfs.fillPendingRead(request); }
        catch (_) { /* VFS latches a permanent fault for the service retry. */ }
        finally { if (vfs.pendingRead === request) vfs.pendingRead = null; }
        result.filled = true;
        if (await cancelIfDead()) return result;
        // One fill per host turn. The retry may expose another chunk, which
        // remains parked in Help's private continuation for the next turn.
        if (!vfs.pendingRead || (vfs.pendingRead.handle | 0) === await own()) {
          status = await call('help_navigation_service');
          result.serviced = true;
        }
      }
    }
    result.pending = !!(await call('get_help_navigation_pending'));
    return result;
  }
  const api = { pump };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HelpNavigationPump = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
