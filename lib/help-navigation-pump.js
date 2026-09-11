// Deferred native Help work runs between guest invocations, never by replacing
// the application's CPU state or its existing wait with an artificial IO_WAIT.
(function (root) {
  'use strict';
  const callbacks = typeof module !== 'undefined' && module.exports
    ? require('./guest-callback-state') : root.GuestCallbackState;
  async function pump({ exports: ex, call, pending, vfs, alive = () => true,
      callbackOwner, callbackMode }) {
    if (!call) {
      if (!ex || !ex.get_help_navigation_pending) return { pending: false, serviced: false, filled: false };
      call = (name, ...args) => ex[name](...args);
    }
    const result = { pending: false, serviced: false, filled: false };
    if (pending === undefined) pending = await call('get_help_navigation_pending');
    if (!pending) {
      if (!alive() && callbacks && callbackOwner) callbacks.cancel(callbackOwner);
      return result;
    }
    result.pending = true;
    const cancelIfDead = async () => {
      if (alive()) return false;
      if (callbacks && callbackOwner) callbacks.cancel(callbackOwner);
      try { await call('help_navigation_cancel'); }
      catch (error) { if (alive()) throw error; /* terminated Worker owns no live instance */ }
      result.pending = false;
      return true;
    };
    if (await cancelIfDead()) return result;
    // The typed return intentionally leaves the callback CPU parked. Restore
    // only here, after ordinary processing of its final slice has finished.
    // This keeps that slice's sleep accounting away from the original deadline.
    if (callbacks && callbackOwner && (!ex || ex.get_help_macro_native_token)) {
      const token = await call('get_help_macro_native_token');
      if (token) {
        const phase = await call('get_help_macro_native_phase');
        if (phase === 3) {
          if (await cancelIfDead()) return result;
          const finished = await call('help_macro_native_finish', token);
          if (!alive()) callbacks.cancel(callbackOwner);
          else if (finished) callbacks.finish(callbackOwner, token);
          result.serviced = true;
        } else if (phase === 1) {
          const handle = await call('get_help_macro_native_io_handle');
          if (vfs && vfs.pendingRead && (vfs.pendingRead.handle | 0) !== (handle | 0)) return result;
          let ready = await call('help_macro_native_prepare');
          result.serviced = true;
          if (ready === -1 && vfs) {
            const request = vfs.pendingRead;
            const ownHandle = await call('get_help_macro_native_io_handle');
            if (request && ownHandle && (request.handle | 0) === (ownHandle | 0)) {
              try { await vfs.fillPendingRead(request); }
              catch (_) { /* retry observes the latched VFS fault */ }
              finally { if (vfs.pendingRead === request) vfs.pendingRead = null; }
              result.filled = true;
              if (await cancelIfDead()) return result;
              ready = await call('help_macro_native_prepare');
            }
          }
          if (ready > 0 && !(vfs && vfs.pendingRead) && alive() &&
              callbacks.begin(callbackOwner, token, callbackMode)) {
            let entered = false;
            try { entered = !!(await call('help_macro_native_begin', token)); }
            finally {
              if (!alive()) callbacks.cancel(callbackOwner);
              else if (!entered) callbacks.finish(callbackOwner, token);
            }
          }
        }
        result.pending = !!(await call('get_help_navigation_pending'));
        return result;
      }
    }
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
  const api = { pump, cancel: owner => callbacks && callbacks.cancel(owner) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HelpNavigationPump = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
