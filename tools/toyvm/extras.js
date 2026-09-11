'use strict';

// ONE ALLOCATOR FOR THE HANDLER TABLE'S TAIL.
//
// Two things append functions to the interpreter's handler table at runtime:
// the region JIT (tools/toyvm/region-live.js, one handler per lowered loop
// region) and the expression-tree fold (tools/toyvm/tree-fold.js, one handler
// per folded run). Both used to hand `makeVm` their OWN array as `regions`, and
// both then addressed a handler as `vm.regionBase + <index in my array>`.
//
// With one of them on that is correct and with both on it is two bugs at once.
// The ordinals overlap, so a tree substitution dispatches into a region; and
// the module carries only the array of whichever side built it last, so the
// other side's handlers are not in the table at all -- an arena word pointing
// past the end of it. `--tree-fold` and `--region-jit` were therefore refused
// together, which is not a position the fold can ship from: the page runs with
// the region JIT on by default.
//
// The fix is that neither side owns the tail. This object does:
//
//   * `handlers` is THE list every module build passes as `regions`, whoever
//     builds it. A module is always built with the whole tail, so an ordinal
//     handed out earlier still names the same function afterwards.
//   * it is APPEND-ONLY, which is what makes that true. Nothing is ever removed
//     or reordered; a handler whose block was dropped simply stops being
//     dispatched to, and costs a few KB of WAT.
//   * `claim(n)` reserves the next `n` ordinals for a caller that is about to
//     build handlers but has not got their bodies yet -- the region JIT decides
//     on its ordinals while preparing, possibly in a worker, and commits them
//     an install later.
//   * `epoch` counts appends. A build that was prepared against one epoch and
//     installed at another would drop whatever was appended in between, so the
//     preparing side checks it and declines rather than installing a module
//     missing the other side's handlers.
//
// There is no coordination beyond that, and none is needed: installs happen
// between slices, on one thread, never concurrently.
class Extras {
  constructor() {
    this.handlers = [];
    this.epoch = 0;
  }

  // The ordinals `n` handlers WILL have, before their bodies exist. The caller
  // must `commit()` exactly that many, in order, or not at all.
  claim(n) { return { base: this.handlers.length, n, epoch: this.epoch }; }

  // Append bodies, returning the ordinal of the first. When a claim is passed
  // it is checked rather than trusted: a claim whose base no longer matches is
  // a claim somebody built against a table that has since moved.
  commit(bodies, claim = null) {
    if (claim) {
      if (claim.base !== this.handlers.length) {
        throw new Error(`extras: claim at ${claim.base} but the table is ${this.handlers.length} long`);
      }
      if (bodies.length !== claim.n) {
        throw new Error(`extras: claimed ${claim.n} ordinal(s), committing ${bodies.length}`);
      }
    }
    const base = this.handlers.length;
    this.handlers.push(...bodies);
    this.epoch++;
    return base;
  }

  // Is a claim still the next thing in the table? The preparing side asks this
  // before it installs; a false answer means the other side appended in the
  // meantime and the prepared module does not carry those handlers.
  fresh(claim) { return !!claim && claim.base === this.handlers.length && claim.epoch === this.epoch; }

  get length() { return this.handlers.length; }
}

module.exports = { Extras };
