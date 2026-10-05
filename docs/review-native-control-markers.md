# Review follow-up: native control marker duplication

Scope: `fable-review.md` P5-3's `$statusbar_native_mark_slot` /
`$tab_native_mark_slot` near-twin finding. Inspected on main after `f4d16032`.

Both setters contained the same bounds check and byte/bit addressing, with
only the backing region different. The corresponding `*_native_is` queries
also repeated window-slot lookup and bit extraction. They now delegate to
one setter and one query helper. The family wrappers still name their own
region directly, retaining the compiler's symbolic ownership checks and all
existing callers. The source change removes 14 net lines.

This does not change native tab/status painting, their special dispatch
interceptors, storage size, slot lifetime, or the division between guest
layout and native rendering. Those are separate correctness questions.

`test/test-native-control-markers.js` passes before and after the refactor.
It covers every window slot, all bit positions and byte boundaries,
non-boolean nonzero marks, independent tab/status state, clearing, unknown
HWNDs, and negative/oversized indices without changing bitmap or adjacent
bytes. The existing MenuHelp test also passes against the refactor.
The complete source closure compiles through the render harness. Fragment
balance and region declaration checks pass; the exact-duplicate census
remains 144 groups / 551 members (these were near-twins, not exact clones).
The property-sheet copy/callback/ownership/lifetime regression and full
canonical/compat build pass as well. The build log is
`/private/tmp/wa-native-markers-build.log`; symbolic owners and automatic test
tier membership pass without edits to their declarations or exception lists.

During selection of this item, the review's later duplicate version-fixture
finding was rechecked: it is already addressed by `65706a4a`. Both
`test-file-version-info.js` and `test-win16-version.js` import
`buildVersionBlob` / `buildVersionPe` from `tools/pe-version.js`. No duplicate
builder work was needed, and no version-API runtime behavior was changed.
