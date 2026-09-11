// Host half of a native guest callback transaction. Finish at the outer pump,
// after the callback's final slice accounting, before running the original CPU.
(function (root) {
  'use strict';
  const states = new WeakMap();
  const fields = {
    mainCooperative: ['_mainSleepUntil', '_mainWaitStartedAt', '_mainWaitPolls'],
    thread: ['sleepUntil', 'waitStartedAt', 'waitPolls', 'sleepCount'],
  };
  const waitFields = ['waitStartedAt', 'waitPolls'];
  const isOwner = value => value !== null &&
    (typeof value === 'object' || typeof value === 'function');
  const capture = (owner, names) => names.map(name => ({ name,
    present: Object.prototype.hasOwnProperty.call(owner, name), value: owner[name] }));
  function restore(owner, saved) {
    for (const { name, present, value } of saved) {
      if (present) owner[name] = value;
      else delete owner[name];
    }
  }

  // Owners are mutable scheduler records. Tokens are opaque, non-null identities
  // (zero is reserved for no guest operation). Only one callback may own a record.
  function begin(owner, token, mode) {
    if (!isOwner(owner) || token == null || token === 0 || states.has(owner)) return false;
    if (mode !== 'mainWorker' && !Object.prototype.hasOwnProperty.call(fields, mode)) return false;
    let saved;
    if (mode === 'mainWorker') {
      const original = owner._mainWaitState;
      saved = { token, mode, fields: capture(owner, ['_mainWaitState']), original,
        wait: isOwner(original) ? capture(original, waitFields) : null };
      owner._mainWaitState = { waitStartedAt: 0, waitPolls: 0 };
    } else {
      saved = { token, mode, fields: capture(owner, fields[mode]) };
      for (const name of fields[mode]) owner[name] = 0;
    }
    states.set(owner, saved);
    return true;
  }

  function finish(owner, token) {
    const saved = isOwner(owner) && states.get(owner);
    if (!saved || saved.token !== token) return false;
    if (saved.wait) restore(saved.original, saved.wait);
    // Restore absolute values, not a fresh now()+remaining duration. Callback
    // execution counts towards the interrupted wait even with a virtual clock.
    restore(owner, saved.fields);
    states.delete(owner);
    return true;
  }

  // Termination must discard the interrupted state, never revive its old wait.
  function cancel(owner) {
    return isOwner(owner) ? states.delete(owner) : false;
  }

  const api = { begin, finish, cancel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GuestCallbackState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
